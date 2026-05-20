import { prisma } from '@shared/utils/index.js';
import type { UserStats } from '@shared/types/index.js';

/**
 * Compute the stored `percentage` column from current/target values.
 *
 * The DB row stores all three (currentValue, targetValue, percentage) for
 * cheap reads, but `percentage` is purely derived — funnel every write
 * through `upsertProgress` below so it cannot drift.
 */
export function computePercentage(currentValue: number, targetValue: number): number {
  if (targetValue <= 0) return 0;
  return Math.min(100, Math.max(0, Math.floor((currentValue / targetValue) * 100)));
}

interface ProgressInput {
  userId: number;
  achievementId: string;
  currentValue: number;
  targetValue: number;
}

export async function upsertProgress(input: ProgressInput): Promise<void> {
  const percentage = computePercentage(input.currentValue, input.targetValue);
  await prisma.achievementProgress.upsert({
    where: {
      userId_achievementId: { userId: input.userId, achievementId: input.achievementId },
    },
    create: { ...input, percentage },
    update: { currentValue: input.currentValue, targetValue: input.targetValue, percentage },
  });
}

export class AchievementProgressService {
  /**
   * Get stats based on activities within an optional window.
   *
   * Default window (no args): everything since `User.achievementStartDate`
   * (falls back to `createdAt`). Used for lifetime achievements.
   *
   * Bounded window (`since` / `until` set): stats restricted to that range.
   * Used for time-windowed (seasonal) achievements — without it, a
   * high-mileage user would auto-unlock "Summer 500K" on day 1 of summer
   * just because their lifetime distance already exceeds the target.
   *
   * Also populates `maxSpeedByActivityType` over the same window, used by
   * `speed`-type achievement checks.
   */
  async getAchievementStats(userId: number, since?: Date, until?: Date): Promise<UserStats> {
    let startDate: Date;
    if (since !== undefined) {
      startDate = since;
    } else {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { achievementStartDate: true, createdAt: true },
      });
      startDate = user.achievementStartDate || user.createdAt;
    }

    const dateFilter: { gte: Date; lte?: Date } = { gte: startDate };
    if (until !== undefined) {
      dateFilter.lte = until;
    }

    const activities = await prisma.activity.findMany({
      where: {
        userId,
        startDateLocal: dateFilter,
      },
      orderBy: { startDate: 'asc' },
    });

    // Calculate stats from filtered activities
    const totalDistance = activities.reduce((sum, a) => sum + a.distance, 0);
    const totalElevation = activities.reduce((sum, a) => sum + a.totalElevationGain, 0);
    const totalTime = activities.reduce((sum, a) => sum + a.movingTime, 0);
    const totalActivities = activities.length;

    // Calculate by activity type
    const byActivityType: UserStats['byActivityType'] = {};
    const maxSpeedByActivityType: Record<string, number> = {};

    for (const activity of activities) {
      if (!byActivityType[activity.type]) {
        byActivityType[activity.type] = {
          count: 0,
          distance: 0,
          elevation: 0,
          time: 0,
        };
        maxSpeedByActivityType[activity.type] = 0;
      }

      byActivityType[activity.type].count += 1;
      byActivityType[activity.type].distance += activity.distance;
      byActivityType[activity.type].elevation += activity.totalElevationGain;
      byActivityType[activity.type].time += activity.movingTime;

      if (activity.averageSpeed > maxSpeedByActivityType[activity.type]) {
        maxSpeedByActivityType[activity.type] = activity.averageSpeed;
      }
    }

    // Calculate current streak
    const activityDates = activities.map((a) => a.startDateLocal.toISOString());
    const currentStreak = this.calculateStreak(activityDates);

    return {
      userId,
      totalDistance: Math.round(totalDistance),
      totalElevation: Math.round(totalElevation),
      totalActivities,
      totalTime,
      currentStreak,
      longestStreak: 0, // Not needed for achievements
      byActivityType,
      maxSpeedByActivityType,
    };
  }

  /**
   * Pick the right stats window for a given achievement.
   *
   * Seasonal achievements (with `validFrom`/`validUntil`) compute their own
   * window-restricted stats. Lifetime achievements share a single default
   * stats object — pass it in via `defaultStats` to avoid re-querying the
   * full activity history per achievement.
   */
  async statsForAchievement(
    userId: number,
    achievement: { validFrom: Date | null; validUntil: Date | null },
    defaultStats: UserStats
  ): Promise<UserStats> {
    if (!achievement.validFrom && !achievement.validUntil) {
      return defaultStats;
    }
    return this.getAchievementStats(
      userId,
      achievement.validFrom ?? undefined,
      achievement.validUntil ?? undefined
    );
  }

  /**
   * Update progress for all achievements.
   *
   * Lifetime achievements share the default stats (activities since
   * `achievementStartDate`). Seasonal achievements get their own
   * window-restricted stats so the progress bar reflects in-window progress,
   * not lifetime totals (otherwise a seasonal would always show 100%
   * immediately for any user who's already past the lifetime target).
   */
  async updateAllProgress(userId: number): Promise<void> {
    const defaultStats = await this.getAchievementStats(userId);
    const windowCache = new Map<string, UserStats>();

    const achievements = await prisma.achievement.findMany();

    for (const achievement of achievements) {
      // Skip if already unlocked
      const unlocked = await prisma.userAchievement.findUnique({
        where: { userId_achievementId: { userId, achievementId: achievement.id } },
      });

      if (unlocked) {
        continue;
      }

      let stats: UserStats;
      if (achievement.validFrom || achievement.validUntil) {
        const key = `${achievement.validFrom?.getTime() ?? 'n'}_${achievement.validUntil?.getTime() ?? 'n'}`;
        let cached = windowCache.get(key);
        if (!cached) {
          cached = await this.getAchievementStats(
            userId,
            achievement.validFrom ?? undefined,
            achievement.validUntil ?? undefined
          );
          windowCache.set(key, cached);
        }
        stats = cached;
      } else {
        stats = defaultStats;
      }

      const currentValue = this.getCurrentValue(achievement, stats);
      const targetValue = achievement.requirementValue;

      await upsertProgress({
        userId,
        achievementId: achievement.id,
        currentValue,
        targetValue,
      });
    }
  }

  /**
   * Calculate current activity streak from sorted dates
   */
  private calculateStreak(sortedDates: string[]): number {
    if (sortedDates.length === 0) {
      return 0;
    }

    let streak = 1;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const latestDate = new Date(sortedDates[sortedDates.length - 1]);
    latestDate.setHours(0, 0, 0, 0);

    const daysDiff = Math.floor((today.getTime() - latestDate.getTime()) / (1000 * 60 * 60 * 24));

    // Streak broken if more than 1 day gap
    if (daysDiff > 1) {
      return 0;
    }

    // Count consecutive days backwards
    for (let i = sortedDates.length - 1; i > 0; i--) {
      const currentDate = new Date(sortedDates[i]);
      const previousDate = new Date(sortedDates[i - 1]);

      currentDate.setHours(0, 0, 0, 0);
      previousDate.setHours(0, 0, 0, 0);

      const diff = Math.floor(
        (currentDate.getTime() - previousDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (diff === 1) {
        streak++;
      } else if (diff > 1) {
        break;
      }
      // diff === 0 means same day, don't increment streak
    }

    return streak;
  }

  /**
   * Get current progress value based on achievement type
   */
  private getCurrentValue(
    achievement: { requirementType: string; activityType: string | null },
    stats: UserStats
  ): number {
    switch (achievement.requirementType) {
      case 'activities':
        return achievement.activityType
          ? stats.byActivityType[achievement.activityType]?.count || 0
          : stats.totalActivities;
      case 'distance':
        return achievement.activityType
          ? stats.byActivityType[achievement.activityType]?.distance || 0
          : stats.totalDistance;
      case 'elevation':
        return achievement.activityType
          ? stats.byActivityType[achievement.activityType]?.elevation || 0
          : stats.totalElevation;
      case 'streak':
        return stats.currentStreak;
      case 'speed':
        // Only meaningful with an activity type — m/s comparison across types
        // (running vs. cycling) would always be won by cycling.
        return achievement.activityType
          ? (stats.maxSpeedByActivityType?.[achievement.activityType] ?? 0)
          : 0;
      case 'variety':
        return Object.keys(stats.byActivityType).length;
      default:
        return 0;
    }
  }
}
