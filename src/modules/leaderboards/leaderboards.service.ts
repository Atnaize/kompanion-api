import { prisma } from '@shared/utils/index.js';
import { FriendsService } from '../friends/friends.service.js';
import {
  METRIC_REGISTRY,
  startDateForPeriod,
  type LeaderboardPeriod,
  type MetricAggregate,
  type MetricKey,
} from '../stats/metric-registry.js';

export interface LeaderboardRowUser {
  id: number;
  firstname: string;
  lastname: string;
  profile: string;
  profileMedium: string;
}

export interface LeaderboardRow {
  rank: number;
  user: LeaderboardRowUser;
  /** Already formatted (rounded) via the metric descriptor. */
  value: number;
  /** Most recent matching activity, for UI hints and the tie-break audit. */
  latestActivityAt: string | null;
  isViewer: boolean;
}

export interface FriendsLeaderboardResult {
  metric: MetricKey;
  period: LeaderboardPeriod;
  activityType: string | null;
  rows: LeaderboardRow[];
}

const userPublicSelect = {
  id: true,
  firstname: true,
  lastname: true,
  profile: true,
  profileMedium: true,
} as const;

export class LeaderboardsService {
  private friendsService = new FriendsService();

  /**
   * Build the friends leaderboard for the viewer. Always includes the viewer
   * (they see themselves alone if they have no friends). Users with no
   * activities in the window appear with value=0 at the bottom.
   *
   * Tie-break: most recent matching activity wins. Users with no activities in
   * the window are sorted last (no `latestStartDate`).
   */
  async getFriendsLeaderboard(params: {
    viewerId: number;
    metric: MetricKey;
    period: LeaderboardPeriod;
    activityType?: string;
  }): Promise<FriendsLeaderboardResult> {
    const { viewerId, metric, period, activityType } = params;
    const friendIds = await this.friendsService.listFriendIds(viewerId);
    const userIds = Array.from(new Set([viewerId, ...friendIds]));

    const startDate = startDateForPeriod(period);

    const grouped = await prisma.activity.groupBy({
      by: ['userId'],
      where: {
        userId: { in: userIds },
        ...(startDate ? { startDateLocal: { gte: startDate } } : {}),
        ...(activityType ? { type: activityType } : {}),
      },
      _sum: {
        distance: true,
        totalElevationGain: true,
        movingTime: true,
      },
      _count: { _all: true },
      _max: { startDateLocal: true },
    });

    const aggregatesByUser = new Map<number, MetricAggregate>(
      grouped.map((row) => [
        row.userId,
        {
          userId: row.userId,
          sumDistance: row._sum.distance ?? 0,
          sumElevation: row._sum.totalElevationGain ?? 0,
          sumMovingTime: row._sum.movingTime ?? 0,
          count: row._count._all,
          latestStartDate: row._max.startDateLocal ?? null,
        },
      ])
    );

    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: userPublicSelect,
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const descriptor = METRIC_REGISTRY[metric];

    const ranked = userIds
      .map((userId) => {
        const user = userMap.get(userId);
        if (!user) return null;
        const aggregate = aggregatesByUser.get(userId) ?? emptyAggregate(userId);
        return {
          user,
          aggregate,
          value: descriptor.format(descriptor.pick(aggregate)),
        };
      })
      .filter((entry): entry is { user: LeaderboardRowUser; aggregate: MetricAggregate; value: number } => entry !== null)
      .sort((a, b) => {
        if (b.value !== a.value) {
          return descriptor.higherIsBetter ? b.value - a.value : a.value - b.value;
        }
        // Tie-break: most recent activity wins. Users with no activity in the
        // window sort last (null treated as -Infinity).
        const aTs = a.aggregate.latestStartDate?.getTime() ?? -Infinity;
        const bTs = b.aggregate.latestStartDate?.getTime() ?? -Infinity;
        return bTs - aTs;
      });

    const rows: LeaderboardRow[] = ranked.map((entry, index) => ({
      rank: index + 1,
      user: entry.user,
      value: entry.value,
      latestActivityAt: entry.aggregate.latestStartDate?.toISOString() ?? null,
      isViewer: entry.user.id === viewerId,
    }));

    return {
      metric,
      period,
      activityType: activityType ?? null,
      rows,
    };
  }
}

function emptyAggregate(userId: number): MetricAggregate {
  return {
    userId,
    sumDistance: 0,
    sumElevation: 0,
    sumMovingTime: 0,
    count: 0,
    latestStartDate: null,
  };
}
