import axios from 'axios';
import { config } from '@config/env.js';
import { parseRateLimitHeaders, prisma, throwIfRateLimited } from '@shared/utils/index.js';
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

export class PersonalRecordsService {
  private authService = new AuthService();

  async fetchBestEffortsForActivity(
    activityId: bigint,
    user: User
  ): Promise<StravaBestEffort[] | null> {
    const accessToken = await this.authService.ensureValidToken(user);

    try {
      const response = await axios.get<StravaDetailedActivity>(
        `${config.strava.apiUrl}/activities/${activityId}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
      const usage = parseRateLimitHeaders(response.headers);
      if (usage) {
        console.info(
          `[PR] Fetched activity ${activityId} (Strava: ${usage.used15min}/${usage.limit15min} 15min)`
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
   */
  async processActivity(activityId: bigint, userId: number, user: User): Promise<number> {
    const bestEfforts = await this.fetchBestEffortsForActivity(activityId, user);

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

    if (rows.length === 0) {
      return 0;
    }

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

    return rows.length;
  }

  /**
   * Return IDs of run activities that still need processing — runs that have
   * no PersonalRecord row yet. Used by the sync flow to resume after failure.
   */
  async getUnprocessedRunActivityIds(userId: number): Promise<bigint[]> {
    const processed = await prisma.personalRecord.findMany({
      where: { userId },
      distinct: ['activityId'],
      select: { activityId: true },
    });
    const processedIds = new Set(processed.map((p) => p.activityId.toString()));

    const candidates = await prisma.activity.findMany({
      where: {
        userId,
        type: 'Run',
        manual: false,
        trainer: false,
        distance: { gte: 400 },
      },
      select: { id: true },
      orderBy: { startDate: 'desc' },
    });

    return candidates.filter((a) => !processedIds.has(a.id.toString())).map((a) => a.id);
  }

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
