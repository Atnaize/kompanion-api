import { prisma } from '@shared/utils/index.js';
import type { UserStats } from '@shared/types/index.js';

export class AchievementProgressService {
  /**
   * Update progress for all achievements after stats are calculated
   */
  async updateAllProgress(userId: number, stats: UserStats): Promise<void> {
    const achievements = await prisma.achievement.findMany();

    for (const achievement of achievements) {
      // Skip if already unlocked
      const unlocked = await prisma.userAchievement.findUnique({
        where: { userId_achievementId: { userId, achievementId: achievement.id } },
      });

      if (unlocked) {
        continue;
      }

      const currentValue = this.getCurrentValue(achievement, stats);
      const targetValue = achievement.requirementValue;
      const percentage = Math.min(100, Math.floor((currentValue / targetValue) * 100));

      // Upsert progress
      await prisma.achievementProgress.upsert({
        where: { userId_achievementId: { userId, achievementId: achievement.id } },
        create: { userId, achievementId: achievement.id, currentValue, targetValue, percentage },
        update: { currentValue, percentage },
      });
    }
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
      default:
        return 0;
    }
  }
}
