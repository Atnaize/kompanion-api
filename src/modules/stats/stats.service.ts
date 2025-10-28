import { prisma } from '@shared/utils/index.js';
import type { UserStats } from '@shared/types/index.js';

export class StatsService {
  /**
   * Calculate and store user stats from activities
   * Returns fresh calculated stats
   */
  async calculateUserStats(userId: number): Promise<UserStats> {
    // Get all activities for the user
    const activities = await prisma.activity.findMany({
      where: { userId },
      orderBy: { startDate: 'asc' },
    });

    // Calculate totals
    const totalDistance = activities.reduce((sum, a) => sum + a.distance, 0);
    const totalElevation = activities.reduce((sum, a) => sum + a.totalElevationGain, 0);
    const totalTime = activities.reduce((sum, a) => sum + a.movingTime, 0);
    const totalActivities = activities.length;

    // Calculate by activity type
    const byActivityType: UserStats['byActivityType'] = {};

    for (const activity of activities) {
      if (!byActivityType[activity.type]) {
        byActivityType[activity.type] = {
          count: 0,
          distance: 0,
          elevation: 0,
          time: 0,
        };
      }

      byActivityType[activity.type].count += 1;
      byActivityType[activity.type].distance += activity.distance;
      byActivityType[activity.type].elevation += activity.totalElevationGain;
      byActivityType[activity.type].time += activity.movingTime;
    }

    // Calculate streak
    const activityDates = activities.map((a) => a.startDateLocal.toISOString());
    const currentStreak = this.calculateStreak(activityDates);

    // Calculate XP and level
    const distanceKm = totalDistance / 1000;
    const elevationM = totalElevation;
    const activityCount = totalActivities || 1;

    // Distance XP (nonlinear reward)
    const distanceXP = Math.pow(distanceKm, 1.1) * 60;

    // Elevation XP (diminishing returns)
    const elevationXP = Math.pow(elevationM / 100, 0.9) * 25;

    // Consistency bonus
    const consistencyXP = activityCount * 30;

    // Anti-spam penalty
    const avgDistance = distanceKm / activityCount;
    const spamPenalty = Math.min(1, avgDistance / 3);

    const xp = Math.floor((distanceXP + elevationXP + consistencyXP) * spamPenalty);
    const level = Math.floor(Math.pow(xp / 200, 0.4)) + 1;

    // Get existing longest streak
    const existingStats = await prisma.userStats.findUnique({
      where: { userId },
    });

    const longestStreak = Math.max(currentStreak, existingStats?.longestStreak || 0);

    // Upsert user stats
    await prisma.userStats.upsert({
      where: { userId },
      create: {
        userId,
        totalDistance: Math.round(totalDistance),
        totalElevation: Math.round(totalElevation),
        totalActivities,
        totalTime,
        currentStreak,
        longestStreak,
        level,
        xp,
      },
      update: {
        totalDistance: Math.round(totalDistance),
        totalElevation: Math.round(totalElevation),
        totalActivities,
        totalTime,
        currentStreak,
        longestStreak,
        level,
        xp,
      },
    });

    // Upsert activity type stats
    const userStatsRecord = await prisma.userStats.findUniqueOrThrow({
      where: { userId },
    });

    // Delete old activity type stats
    await prisma.activityTypeStats.deleteMany({
      where: { userStatsId: userStatsRecord.id },
    });

    // Create new activity type stats
    for (const [activityType, stats] of Object.entries(byActivityType)) {
      await prisma.activityTypeStats.create({
        data: {
          userStatsId: userStatsRecord.id,
          activityType,
          count: stats.count,
          distance: Math.round(stats.distance),
          elevation: Math.round(stats.elevation),
          time: stats.time,
        },
      });
    }

    return {
      userId,
      totalDistance: Math.round(totalDistance),
      totalElevation: Math.round(totalElevation),
      totalActivities,
      totalTime,
      currentStreak,
      longestStreak,
      level,
      xp,
      byActivityType,
    };
  }

  /**
   * Get cached user stats from database
   * Returns stored stats without recalculation
   */
  async getUserStats(userId: number): Promise<UserStats | null> {
    const stats = await prisma.userStats.findUnique({
      where: { userId },
      include: { activityTypeStats: true },
    });

    if (!stats) {
      return null;
    }

    const byActivityType: UserStats['byActivityType'] = {};
    for (const typeStats of stats.activityTypeStats) {
      byActivityType[typeStats.activityType] = {
        count: typeStats.count,
        distance: typeStats.distance,
        elevation: typeStats.elevation,
        time: typeStats.time,
      };
    }

    return {
      userId: stats.userId,
      totalDistance: stats.totalDistance,
      totalElevation: stats.totalElevation,
      totalActivities: stats.totalActivities,
      totalTime: stats.totalTime,
      currentStreak: stats.currentStreak,
      longestStreak: stats.longestStreak,
      level: stats.level,
      xp: stats.xp,
      byActivityType,
    };
  }

  /**
   * Calculate current activity streak
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
}
