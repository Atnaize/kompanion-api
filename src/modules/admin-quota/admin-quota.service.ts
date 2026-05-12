import { config } from '@config/env.js';
import { prisma } from '@shared/utils/index.js';
import {
  PersonalRecordsService,
  type StravaApiUsageKind,
} from '../personal-records/personal-records.service.js';

const SPARKLINE_DAYS = 14;

const startOfUtcDay = (d: Date = new Date()): Date => {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

const addDays = (d: Date, days: number): Date => {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
};

const isoDate = (d: Date): string => {
  return d.toISOString().slice(0, 10);
};

export interface QuotaOverview {
  date: string;
  appDailyUsed: number;
  appDailyBudget: number;
  appDailyRemaining: number;
  byKind: Record<StravaApiUsageKind, number>;
  sparkline: Array<{ date: string; total: number }>;
}

export interface QuotaUserRow {
  userId: number;
  username: string | null;
  firstname: string;
  lastname: string;
  prFetch: number;
  webhookFetch: number;
  activitySync: number;
  userDailyCap: number;
  userDailyRemaining: number;
  unprocessedRuns: number;
}

export interface QuotaGrantRow {
  id: number;
  userId: number;
  kind: string;
  amount: number;
  validFrom: string;
  validUntil: string;
  grantedBy: number;
  grantedByName: string;
  note: string | null;
  createdAt: string;
}

export class AdminQuotaService {
  private personalRecordsService = new PersonalRecordsService();

  /**
   * App-wide totals for today + per-kind breakdown + 14-day sparkline.
   */
  async getOverview(): Promise<QuotaOverview> {
    const today = startOfUtcDay();
    const sparkStart = addDays(today, -(SPARKLINE_DAYS - 1));

    const [todayRows, sparkRows] = await Promise.all([
      prisma.stravaApiUsage.findMany({
        where: { date: today },
        select: { kind: true, count: true },
      }),
      prisma.stravaApiUsage.findMany({
        where: { date: { gte: sparkStart, lte: today } },
        select: { date: true, count: true },
      }),
    ]);

    const byKind: Record<StravaApiUsageKind, number> = {
      pr_fetch: 0,
      webhook_fetch: 0,
      activity_sync: 0,
    };
    let appDailyUsed = 0;
    for (const row of todayRows) {
      appDailyUsed += row.count;
      if (row.kind in byKind) {
        byKind[row.kind as StravaApiUsageKind] += row.count;
      }
    }

    const sparkMap = new Map<string, number>();
    for (let i = 0; i < SPARKLINE_DAYS; i++) {
      sparkMap.set(isoDate(addDays(sparkStart, i)), 0);
    }
    for (const row of sparkRows) {
      const key = isoDate(row.date);
      sparkMap.set(key, (sparkMap.get(key) ?? 0) + row.count);
    }
    const sparkline = Array.from(sparkMap.entries()).map(([date, total]) => ({ date, total }));

    const appDailyBudget = config.personalRecords.dailyAppBudget;
    return {
      date: isoDate(today),
      appDailyUsed,
      appDailyBudget,
      appDailyRemaining: Math.max(0, appDailyBudget - appDailyUsed),
      byKind,
      sparkline,
    };
  }

  /**
   * Per-user usage for `date` (defaults to today). `activeOnly` filters out
   * users with zero usage that day, useful for the dashboard view.
   */
  async getUsersForDate(date: Date, activeOnly: boolean): Promise<QuotaUserRow[]> {
    const day = startOfUtcDay(date);

    const usageRows = await prisma.stravaApiUsage.findMany({
      where: { date: day },
      include: {
        user: { select: { username: true, firstname: true, lastname: true } },
      },
    });

    type Agg = {
      userId: number;
      username: string | null;
      firstname: string;
      lastname: string;
      pr_fetch: number;
      webhook_fetch: number;
      activity_sync: number;
    };

    const agg = new Map<number, Agg>();
    for (const row of usageRows) {
      let entry = agg.get(row.userId);
      if (!entry) {
        entry = {
          userId: row.userId,
          username: row.user.username,
          firstname: row.user.firstname,
          lastname: row.user.lastname,
          pr_fetch: 0,
          webhook_fetch: 0,
          activity_sync: 0,
        };
        agg.set(row.userId, entry);
      }
      if (row.kind === 'pr_fetch') entry.pr_fetch += row.count;
      else if (row.kind === 'webhook_fetch') entry.webhook_fetch += row.count;
      else if (row.kind === 'activity_sync') entry.activity_sync += row.count;
    }

    const rows: QuotaUserRow[] = [];
    for (const entry of agg.values()) {
      const cap = await this.personalRecordsService.getEffectiveUserCap(entry.userId, 'pr_fetch');
      const unprocessedRuns = await this.personalRecordsService
        .getUnprocessedRunActivityIds(entry.userId)
        .then((ids) => ids.length);
      rows.push({
        userId: entry.userId,
        username: entry.username,
        firstname: entry.firstname,
        lastname: entry.lastname,
        prFetch: entry.pr_fetch,
        webhookFetch: entry.webhook_fetch,
        activitySync: entry.activity_sync,
        userDailyCap: cap,
        userDailyRemaining: Math.max(0, cap - entry.pr_fetch),
        unprocessedRuns,
      });
    }

    rows.sort((a, b) => b.prFetch + b.webhookFetch - (a.prFetch + a.webhookFetch));

    return activeOnly ? rows.filter((r) => r.prFetch + r.webhookFetch + r.activitySync > 0) : rows;
  }

  /**
   * Users with unprocessed run backlogs, regardless of activity today.
   * Sorted by remaining work desc so admins can see who's still backfilling.
   */
  async getBacklog(): Promise<
    Array<{
      userId: number;
      username: string | null;
      firstname: string;
      lastname: string;
      unprocessedRuns: number;
    }>
  > {
    const users = await prisma.user.findMany({
      select: { id: true, username: true, firstname: true, lastname: true },
    });
    const out: Array<{
      userId: number;
      username: string | null;
      firstname: string;
      lastname: string;
      unprocessedRuns: number;
    }> = [];
    for (const u of users) {
      const ids = await this.personalRecordsService.getUnprocessedRunActivityIds(u.id);
      if (ids.length > 0) {
        out.push({
          userId: u.id,
          username: u.username,
          firstname: u.firstname,
          lastname: u.lastname,
          unprocessedRuns: ids.length,
        });
      }
    }
    out.sort((a, b) => b.unprocessedRuns - a.unprocessedRuns);
    return out;
  }

  async grantQuota(params: {
    userId: number;
    amount: number;
    kind?: StravaApiUsageKind;
    validUntil?: Date;
    note?: string;
    grantedBy: number;
  }): Promise<QuotaGrantRow> {
    const kind = params.kind ?? 'pr_fetch';
    // Default: end of today UTC.
    const validUntil =
      params.validUntil ?? new Date(startOfUtcDay().getTime() + 24 * 60 * 60 * 1000);
    const grant = await prisma.stravaApiGrant.create({
      data: {
        userId: params.userId,
        kind,
        amount: params.amount,
        validUntil,
        grantedBy: params.grantedBy,
        note: params.note ?? null,
      },
      include: {
        admin: { select: { username: true, firstname: true, lastname: true } },
      },
    });
    return formatGrant(grant);
  }

  async revokeGrant(id: number): Promise<void> {
    await prisma.stravaApiGrant.delete({ where: { id } });
  }

  async listGrantsForUser(userId: number): Promise<QuotaGrantRow[]> {
    const grants = await prisma.stravaApiGrant.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        admin: { select: { username: true, firstname: true, lastname: true } },
      },
    });
    return grants.map(formatGrant);
  }
}

type GrantWithAdmin = {
  id: number;
  userId: number;
  kind: string;
  amount: number;
  validFrom: Date;
  validUntil: Date;
  grantedBy: number;
  note: string | null;
  createdAt: Date;
  admin: { username: string | null; firstname: string; lastname: string };
};

function formatGrant(grant: GrantWithAdmin): QuotaGrantRow {
  const adminName =
    grant.admin.username ?? `${grant.admin.firstname} ${grant.admin.lastname}`.trim();
  return {
    id: grant.id,
    userId: grant.userId,
    kind: grant.kind,
    amount: grant.amount,
    validFrom: grant.validFrom.toISOString(),
    validUntil: grant.validUntil.toISOString(),
    grantedBy: grant.grantedBy,
    grantedByName: adminName,
    note: grant.note,
    createdAt: grant.createdAt.toISOString(),
  };
}
