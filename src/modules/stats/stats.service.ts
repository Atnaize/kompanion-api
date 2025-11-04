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
      },
      update: {
        totalDistance: Math.round(totalDistance),
        totalElevation: Math.round(totalElevation),
        totalActivities,
        totalTime,
        currentStreak,
        longestStreak,
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

  /**
   * Compare stats between two time periods
   */
  async comparePeriods(
    userId: number,
    period: 'week' | 'month' | 'year'
  ): Promise<{
    current: {
      distance: number;
      elevation: number;
      time: number;
      count: number;
    };
    previous: {
      distance: number;
      elevation: number;
      time: number;
      count: number;
    };
    changes: {
      distance: number;
      elevation: number;
      time: number;
      count: number;
    };
  }> {
    const now = new Date();
    let currentStart: Date;
    let previousStart: Date;
    let previousEnd: Date;

    // Determine date ranges based on period
    switch (period) {
      case 'week':
        currentStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        previousStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
        previousEnd = currentStart;
        break;
      case 'month':
        currentStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        previousStart = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
        previousEnd = currentStart;
        break;
      case 'year':
        currentStart = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        previousStart = new Date(now.getTime() - 730 * 24 * 60 * 60 * 1000);
        previousEnd = currentStart;
        break;
    }

    // Get activities for current period
    const currentActivities = await prisma.activity.findMany({
      where: {
        userId,
        startDateLocal: {
          gte: currentStart,
          lte: now,
        },
      },
    });

    // Get activities for previous period
    const previousActivities = await prisma.activity.findMany({
      where: {
        userId,
        startDateLocal: {
          gte: previousStart,
          lt: previousEnd,
        },
      },
    });

    // Calculate stats for current period
    const currentStats = {
      distance: Math.round(currentActivities.reduce((sum, a) => sum + a.distance, 0)),
      elevation: Math.round(currentActivities.reduce((sum, a) => sum + a.totalElevationGain, 0)),
      time: currentActivities.reduce((sum, a) => sum + a.movingTime, 0),
      count: currentActivities.length,
    };

    // Calculate stats for previous period
    const previousStats = {
      distance: Math.round(previousActivities.reduce((sum, a) => sum + a.distance, 0)),
      elevation: Math.round(previousActivities.reduce((sum, a) => sum + a.totalElevationGain, 0)),
      time: previousActivities.reduce((sum, a) => sum + a.movingTime, 0),
      count: previousActivities.length,
    };

    // Calculate percentage changes
    const calculateChange = (current: number, previous: number): number => {
      if (previous === 0) {
        return current > 0 ? 100 : 0;
      }

      return Math.round(((current - previous) / previous) * 100);
    };

    const changes = {
      distance: calculateChange(currentStats.distance, previousStats.distance),
      elevation: calculateChange(currentStats.elevation, previousStats.elevation),
      time: calculateChange(currentStats.time, previousStats.time),
      count: calculateChange(currentStats.count, previousStats.count),
    };

    return {
      current: currentStats,
      previous: previousStats,
      changes,
    };
  }

  /**
   * Compare stats between two custom date ranges
   */
  async compareCustomDateRanges(
    userId: number,
    currentStart: Date,
    currentEnd: Date,
    previousStart: Date,
    previousEnd: Date
  ): Promise<{
    current: {
      distance: number;
      elevation: number;
      time: number;
      count: number;
    };
    previous: {
      distance: number;
      elevation: number;
      time: number;
      count: number;
    };
    changes: {
      distance: number;
      elevation: number;
      time: number;
      count: number;
    };
  }> {
    // Get activities for current period
    const currentActivities = await prisma.activity.findMany({
      where: {
        userId,
        startDateLocal: {
          gte: currentStart,
          lte: currentEnd,
        },
      },
    });

    // Get activities for previous period
    const previousActivities = await prisma.activity.findMany({
      where: {
        userId,
        startDateLocal: {
          gte: previousStart,
          lte: previousEnd,
        },
      },
    });

    // Calculate stats for current period
    const currentStats = {
      distance: Math.round(currentActivities.reduce((sum, a) => sum + a.distance, 0)),
      elevation: Math.round(currentActivities.reduce((sum, a) => sum + a.totalElevationGain, 0)),
      time: currentActivities.reduce((sum, a) => sum + a.movingTime, 0),
      count: currentActivities.length,
    };

    // Calculate stats for previous period
    const previousStats = {
      distance: Math.round(previousActivities.reduce((sum, a) => sum + a.distance, 0)),
      elevation: Math.round(previousActivities.reduce((sum, a) => sum + a.totalElevationGain, 0)),
      time: previousActivities.reduce((sum, a) => sum + a.movingTime, 0),
      count: previousActivities.length,
    };

    // Calculate percentage changes
    const calculateChange = (current: number, previous: number): number => {
      if (previous === 0) {
        return current > 0 ? 100 : 0;
      }

      return Math.round(((current - previous) / previous) * 100);
    };

    const changes = {
      distance: calculateChange(currentStats.distance, previousStats.distance),
      elevation: calculateChange(currentStats.elevation, previousStats.elevation),
      time: calculateChange(currentStats.time, previousStats.time),
      count: calculateChange(currentStats.count, previousStats.count),
    };

    return {
      current: currentStats,
      previous: previousStats,
      changes,
    };
  }

  /**
   * Get heatmap data for activity calendar (last 12 months)
   */
  async getHeatmapData(
    userId: number,
    metric: 'count' | 'distance' = 'count'
  ): Promise<Array<{ date: string; value: number }>> {
    const now = new Date();
    const twelveMonthsAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

    // Get activities for the last 12 months
    const activities = await prisma.activity.findMany({
      where: {
        userId,
        startDateLocal: {
          gte: twelveMonthsAgo,
        },
      },
      orderBy: { startDateLocal: 'asc' },
    });

    // Group activities by day
    const grouped = new Map<string, number>();

    for (const activity of activities) {
      const date = new Date(activity.startDateLocal);
      const key = date.toISOString().split('T')[0]; // YYYY-MM-DD

      const current = grouped.get(key) || 0;
      const value = metric === 'count' ? 1 : activity.distance;

      grouped.set(key, current + value);
    }

    // Convert to array and sort by date
    return Array.from(grouped.entries())
      .map(([date, value]) => ({
        date,
        value: metric === 'count' ? value : Math.round(value),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Get progress data aggregated by time periods
   */
  async getProgressData(
    userId: number,
    options: {
      metric: 'distance' | 'elevation' | 'count' | 'time';
      period: 'week' | 'month' | 'year' | 'all';
      groupBy: 'day' | 'week' | 'month';
    }
  ): Promise<Array<{ date: string; value: number }>> {
    const now = new Date();
    let startDate: Date;

    // Determine start date based on period
    switch (options.period) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'year':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      case 'all':
        startDate = new Date(0); // Beginning of time
        break;
    }

    // Get activities in the period
    const activities = await prisma.activity.findMany({
      where: {
        userId,
        startDateLocal: {
          gte: startDate,
        },
      },
      orderBy: { startDateLocal: 'asc' },
    });

    // Group activities by time period
    const grouped = new Map<string, number>();

    for (const activity of activities) {
      const date = new Date(activity.startDateLocal);
      let key: string;

      switch (options.groupBy) {
        case 'day':
          key = date.toISOString().split('T')[0]; // YYYY-MM-DD
          break;
        case 'week': {
          // Get start of week (Monday)
          const dayOfWeek = date.getDay();
          const diff = date.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
          const weekStart = new Date(date.setDate(diff));
          key = weekStart.toISOString().split('T')[0];
          break;
        }
        case 'month':
          key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
          break;
      }

      // Aggregate the selected metric
      const current = grouped.get(key) || 0;
      let value: number;

      switch (options.metric) {
        case 'distance':
          value = activity.distance;
          break;
        case 'elevation':
          value = activity.totalElevationGain;
          break;
        case 'time':
          value = activity.movingTime;
          break;
        case 'count':
          value = 1;
          break;
      }

      grouped.set(key, current + value);
    }

    // Convert to array and sort by date
    return Array.from(grouped.entries())
      .map(([date, value]) => ({ date, value: Math.round(value) }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
}
