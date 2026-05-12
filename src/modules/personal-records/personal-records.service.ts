import axios from 'axios';
import { config } from '@config/env.js';
import {
  parseRateLimitHeaders,
  prisma,
  StravaRateLimitError,
  throwIfRateLimited,
} from '@shared/utils/index.js';
import { AuthService } from '../auth/auth.service.js';
import type { StravaBestEffort, StravaDetailedActivity, User } from '@shared/types/index.js';

// Bands we persist (metric-only subset of Strava's best_efforts set).
// Keyed by Strava's `name` field so we can filter incoming data directly.
const BANDS: Array<{ stravaName: string; band: string; meters: number }> = [
  { stravaName: '400m', band: '400m', meters: 400 },
  { stravaName: '1K', band: '1km', meters: 1000 },
  { stravaName: '5K', band: '5km', meters: 5000 },
  { stravaName: '10K', band: '10km', meters: 10000 },
  { stravaName: '15K', band: '15km', meters: 15000 },
  { stravaName: 'Half-Marathon', band: 'half_marathon', meters: 21097 },
  { stravaName: 'Marathon', band: 'marathon', meters: 42195 },
];

const STRAVA_TO_BAND = new Map(BANDS.map((b) => [b.stravaName, b]));

export const PR_BANDS = BANDS.map((b) => ({ band: b.band, meters: b.meters }));

export type StravaApiUsageKind = 'pr_fetch' | 'webhook_fetch' | 'activity_sync';

export type PausedReason = 'user_daily_cap' | 'app_daily_cap' | 'strava_rate_limit';

export interface ProcessingStatus {
  processed: number;
  total: number;
  userDailyUsed: number;
  userDailyCap: number;
  userDailyRemaining: number;
  appDailyUsed: number;
  appDailyBudget: number;
  appDailyRemaining: number;
}

export interface BacklogProgressEvent {
  type: 'processing' | 'paused' | 'complete' | 'error';
  current?: number;
  total?: number;
  processed?: number;
  reason?: PausedReason;
  message?: string;
}

export interface PersonalRecordWithActivity {
  band: string;
  distanceMeters: number;
  bestTimeSeconds: number;
  achievedAt: Date;
  activity: {
    id: string;
    name: string;
  };
}

const startOfUtcDay = (d: Date = new Date()): Date => {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

export class PersonalRecordsService {
  private authService = new AuthService();

  // ─── Strava fetches ────────────────────────────────────────────────────────

  /**
   * Fetch best_efforts for a single activity. Records usage under `kind`
   * AFTER a successful response, so 429s and network errors don't burn the
   * budget. Throws StravaRateLimitError on 429 so callers can react.
   */
  async fetchBestEffortsForActivity(
    activityId: bigint,
    user: User,
    kind: StravaApiUsageKind = 'pr_fetch'
  ): Promise<StravaBestEffort[] | null> {
    const accessToken = await this.authService.ensureValidToken(user);

    try {
      const response = await axios.get<StravaDetailedActivity>(
        `${config.strava.apiUrl}/activities/${activityId}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
      await this.recordUsage(user.id, kind);
      const usage = parseRateLimitHeaders(response.headers);
      if (usage) {
        console.info(
          `[PR] Fetched activity ${activityId} (${kind}) (Strava: ${usage.used15min}/${usage.limit15min} 15min)`
        );
      }
      return response.data.best_efforts ?? [];
    } catch (error) {
      throwIfRateLimited(error);
      console.error(
        `[PR] Failed to fetch detailed activity ${activityId}:`,
        error instanceof Error ? error.message : error
      );
      return null;
    }
  }

  /**
   * Process a single activity: fetch its best_efforts from Strava and upsert
   * the matching band rows. Idempotent — re-running on the same activity just
   * overwrites identical values via the @@unique constraint.
   *
   * After a successful fetch (even one that yields 0 matching bands) we stamp
   * Activity.bestEffortsFetchedAt so this activity never gets refetched. A
   * failed fetch (null return) leaves the column untouched so the next pass
   * retries.
   */
  async processActivity(
    activityId: bigint,
    userId: number,
    user: User,
    kind: StravaApiUsageKind = 'pr_fetch'
  ): Promise<number> {
    const bestEfforts = await this.fetchBestEffortsForActivity(activityId, user, kind);

    if (!bestEfforts) {
      return 0;
    }

    const rows = bestEfforts
      .map((effort) => {
        const meta = STRAVA_TO_BAND.get(effort.name);
        if (!meta) {
          return null;
        }
        return {
          userId,
          distanceBand: meta.band,
          distanceMeters: meta.meters,
          bestTimeSeconds: effort.moving_time,
          activityId,
          achievedAt: new Date(effort.start_date),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    for (const row of rows) {
      await prisma.personalRecord.upsert({
        where: {
          userId_distanceBand_activityId: {
            userId: row.userId,
            distanceBand: row.distanceBand,
            activityId: row.activityId,
          },
        },
        create: row,
        update: {
          bestTimeSeconds: row.bestTimeSeconds,
          distanceMeters: row.distanceMeters,
          achievedAt: row.achievedAt,
        },
      });
    }

    await prisma.activity.update({
      where: { id: activityId },
      data: { bestEffortsFetchedAt: new Date() },
    });

    return rows.length;
  }

  // ─── Backlog ───────────────────────────────────────────────────────────────

  /**
   * Return IDs of run activities that still need processing — runs we've
   * never successfully fetched best_efforts for. Recent-first so the user
   * sees their latest PRs land first.
   */
  async getUnprocessedRunActivityIds(userId: number): Promise<bigint[]> {
    const rows = await prisma.activity.findMany({
      where: {
        userId,
        type: 'Run',
        manual: false,
        trainer: false,
        distance: { gte: 400 },
        bestEffortsFetchedAt: null,
      },
      select: { id: true },
      orderBy: { startDate: 'desc' },
    });
    return rows.map((r) => r.id);
  }

  /**
   * Total number of PR-eligible run activities for the user. Used as the
   * "Y" in the "X of Y" progress UI.
   */
  async countEligibleRunActivities(userId: number): Promise<number> {
    return prisma.activity.count({
      where: {
        userId,
        type: 'Run',
        manual: false,
        trainer: false,
        distance: { gte: 400 },
      },
    });
  }

  /**
   * Count of run activities we've successfully fetched best_efforts for —
   * whether or not any bands matched. The "X" in the "X of Y" progress UI.
   */
  async countProcessedRunActivities(userId: number): Promise<number> {
    return prisma.activity.count({
      where: {
        userId,
        type: 'Run',
        manual: false,
        trainer: false,
        distance: { gte: 400 },
        bestEffortsFetchedAt: { not: null },
      },
    });
  }

  /**
   * Drain the unprocessed backlog, emitting progress as it goes. Stops on
   * budget exhaustion (user or app cap) or Strava rate limit — caller can
   * resume on next invocation since the queue is rebuilt each time.
   */
  async processBacklogWithProgress(
    user: User,
    onProgress: (event: BacklogProgressEvent) => void
  ): Promise<void> {
    const todo = await this.getUnprocessedRunActivityIds(user.id);
    const total = todo.length;

    if (total === 0) {
      onProgress({ type: 'complete', current: 0, total: 0 });
      return;
    }

    console.info(`[PR] Processing ${total} run(s) for personal records (user ${user.id})`);

    for (let i = 0; i < todo.length; i++) {
      const budget = await this.checkBudget(user.id, 'pr_fetch');
      if (budget.paused) {
        onProgress({
          type: 'paused',
          current: i,
          total,
          reason: budget.reason,
          message: budget.message,
        });
        return;
      }

      try {
        await this.processActivity(todo[i], user.id, user, 'pr_fetch');
        onProgress({ type: 'processing', current: i + 1, total });
      } catch (error) {
        if (error instanceof StravaRateLimitError) {
          console.warn(`[PR] Rate limit reached after ${i} activities — pausing. ${error.message}`);
          onProgress({
            type: 'paused',
            current: i,
            total,
            reason: 'strava_rate_limit',
            message: error.message,
          });
          return;
        }
        console.error(`[PR] Unexpected error processing activity ${todo[i]}:`, error);
        onProgress({
          type: 'error',
          current: i,
          total,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
        return;
      }

      if (i < todo.length - 1 && config.personalRecords.processingDelayMs > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, config.personalRecords.processingDelayMs)
        );
      }
    }

    onProgress({ type: 'complete', current: total, total });
  }

  // ─── Budgets & usage ───────────────────────────────────────────────────────

  /**
   * Effective per-user daily cap = base config cap + sum of active grants for
   * the same kind. Only `pr_fetch` is gated per-user today.
   */
  async getEffectiveUserCap(userId: number, kind: StravaApiUsageKind): Promise<number> {
    if (kind !== 'pr_fetch') {
      // webhook_fetch and activity_sync bypass per-user gating; return a
      // sentinel large value so callers can treat them uniformly if they want.
      return Number.MAX_SAFE_INTEGER;
    }
    const base = config.personalRecords.dailyUserCap;
    const now = new Date();
    const grants = await prisma.stravaApiGrant.findMany({
      where: {
        userId,
        kind,
        validFrom: { lte: now },
        validUntil: { gt: now },
      },
      select: { amount: true },
    });
    return base + grants.reduce((sum, g) => sum + g.amount, 0);
  }

  /**
   * App-wide usage across all users + kinds for `date` (defaults to today).
   * Computed via SUM aggregate over the per-user rows — there's no separate
   * global counter.
   */
  async getAppDailyUsed(date: Date = startOfUtcDay()): Promise<number> {
    const result = await prisma.stravaApiUsage.aggregate({
      where: { date },
      _sum: { count: true },
    });
    return result._sum.count ?? 0;
  }

  /**
   * Check whether the next fetch is allowed under both budgets. Returns the
   * pause reason if not — caller emits a `paused` event and stops.
   */
  async checkBudget(
    userId: number,
    kind: StravaApiUsageKind
  ): Promise<{ paused: false } | { paused: true; reason: PausedReason; message: string }> {
    const today = startOfUtcDay();
    const appBudget = config.personalRecords.dailyAppBudget;

    // App-wide cap applies to every kind.
    const appUsed = await this.getAppDailyUsed(today);
    if (appUsed >= appBudget) {
      return {
        paused: true,
        reason: 'app_daily_cap',
        message: `App daily budget reached (${appUsed}/${appBudget}).`,
      };
    }

    if (kind === 'pr_fetch') {
      const userRow = await prisma.stravaApiUsage.findUnique({
        where: { userId_date_kind: { userId, date: today, kind } },
      });
      const userUsed = userRow?.count ?? 0;
      const userCap = await this.getEffectiveUserCap(userId, kind);
      if (userUsed >= userCap) {
        return {
          paused: true,
          reason: 'user_daily_cap',
          message: `Daily user cap reached (${userUsed}/${userCap}).`,
        };
      }
    }

    return { paused: false };
  }

  /**
   * Atomically increment the (user, today, kind) counter. Called AFTER a
   * successful Strava call so we never burn budget on failed responses.
   */
  async recordUsage(userId: number, kind: StravaApiUsageKind): Promise<void> {
    const today = startOfUtcDay();
    await prisma.stravaApiUsage.upsert({
      where: { userId_date_kind: { userId, date: today, kind } },
      create: { userId, date: today, kind, count: 1 },
      update: { count: { increment: 1 } },
    });
  }

  /**
   * Snapshot for the PR page UI. Bundles the backlog counts with both budget
   * states so the frontend can render the right banner without follow-up
   * calls.
   */
  async getProcessingStatus(userId: number): Promise<ProcessingStatus> {
    const today = startOfUtcDay();
    const [processed, total, userRow, appUsed, userCap] = await Promise.all([
      this.countProcessedRunActivities(userId),
      this.countEligibleRunActivities(userId),
      prisma.stravaApiUsage.findUnique({
        where: { userId_date_kind: { userId, date: today, kind: 'pr_fetch' } },
      }),
      this.getAppDailyUsed(today),
      this.getEffectiveUserCap(userId, 'pr_fetch'),
    ]);

    const userDailyUsed = userRow?.count ?? 0;
    const appDailyBudget = config.personalRecords.dailyAppBudget;

    return {
      processed,
      total,
      userDailyUsed,
      userDailyCap: userCap,
      userDailyRemaining: Math.max(0, userCap - userDailyUsed),
      appDailyUsed: appUsed,
      appDailyBudget,
      appDailyRemaining: Math.max(0, appDailyBudget - appUsed),
    };
  }

  // ─── Read API ──────────────────────────────────────────────────────────────

  /**
   * Return all records for a user, grouped by band, top-N per band sorted by
   * best time. Each record includes the activity id + name for linking.
   */
  async getRecordsGroupedByBand(
    userId: number,
    topN = 3
  ): Promise<Record<string, PersonalRecordWithActivity[]>> {
    const records = await prisma.personalRecord.findMany({
      where: { userId },
      include: {
        activity: {
          select: { id: true, name: true },
        },
      },
      orderBy: [{ distanceBand: 'asc' }, { bestTimeSeconds: 'asc' }],
    });

    const grouped: Record<string, PersonalRecordWithActivity[]> = {};
    for (const { band } of PR_BANDS) {
      grouped[band] = [];
    }

    for (const record of records) {
      const bucket = grouped[record.distanceBand];
      if (!bucket || bucket.length >= topN) {
        continue;
      }
      bucket.push({
        band: record.distanceBand,
        distanceMeters: record.distanceMeters,
        bestTimeSeconds: record.bestTimeSeconds,
        achievedAt: record.achievedAt,
        activity: {
          id: record.activity.id.toString(),
          name: record.activity.name,
        },
      });
    }

    return grouped;
  }
}
