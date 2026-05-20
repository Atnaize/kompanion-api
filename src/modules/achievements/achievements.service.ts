import { prisma } from '@shared/utils/index.js';
import { AchievementProgressService } from './achievement-progress.service.js';
import { feedEventEmitter } from '../feed/index.js';
import { notificationEmitter } from '../inbox/index.js';
import type { Achievement, UserStats } from '@shared/types/index.js';
import type { Achievement as PrismaAchievement } from '@prisma/client';

export class AchievementsService {
  private achievementProgressService = new AchievementProgressService();

  /**
   * Get all achievements for a user with their status
   * Returns: locked, redeemable, or unlocked
   */
  async getUserAchievements(
    userId: number
  ): Promise<Array<Achievement & { isRedeemable: boolean }>> {
    const now = new Date();

    // Get all achievements from database (seeded data)
    // Filter to only show achievements that are currently valid
    const allAchievements = await prisma.achievement.findMany({
      where: {
        AND: [
          {
            OR: [{ validFrom: null }, { validFrom: { lte: now } }],
          },
          {
            OR: [{ validUntil: null }, { validUntil: { gte: now } }],
          },
        ],
      },
      orderBy: [{ rarity: 'asc' }, { requirementValue: 'asc' }],
    });

    // Get user's unlocked achievements
    const unlockedAchievements = await prisma.userAchievement.findMany({
      where: { userId },
      select: {
        achievementId: true,
        unlockedAt: true,
      },
    });

    // Get progress for locked achievements
    const progressRecords = await prisma.achievementProgress.findMany({
      where: { userId },
    });

    const unlockedMap = new Map(
      unlockedAchievements.map((ua) => [ua.achievementId, ua.unlockedAt])
    );

    const progressMap = new Map(progressRecords.map((p) => [p.achievementId, p]));

    // Lifetime stats — shared by all non-seasonal achievements.
    const defaultStats = await this.achievementProgressService.getAchievementStats(userId);

    // Seasonal achievements need window-restricted stats (otherwise a
    // high-mileage user instantly satisfies "Summer 500K" on day 1). Cache
    // by `(validFrom, validUntil)` so achievements sharing a window only
    // re-query the DB once.
    const windowCache = new Map<string, UserStats>();
    const statsForEach = await Promise.all(
      allAchievements.map((a) => this.pickStats(userId, a, defaultStats, windowCache))
    );

    // Map to Achievement type with status
    return allAchievements.map((achievement, idx) => {
      const isUnlocked = unlockedMap.has(achievement.id);
      const meetsRequirements = this.isAchievementUnlocked(achievement, statsForEach[idx]);
      const isRedeemable = !isUnlocked && meetsRequirements;
      const isSecret = achievement.isSecret && !isUnlocked;

      // Get progress data (but not for secret achievements)
      const progress = !isSecret ? progressMap.get(achievement.id) : undefined;

      return {
        id: achievement.id,
        name: isSecret ? 'Secret Achievement' : achievement.name,
        description: isSecret ? 'Complete secret challenges to unlock' : achievement.description,
        icon: isSecret ? '❓' : achievement.icon,
        rarity: achievement.rarity as Achievement['rarity'],
        requirement: {
          type: achievement.requirementType as Achievement['requirement']['type'],
          value: achievement.requirementValue,
          activityType: achievement.activityType || undefined,
        },
        unlockedAt: isUnlocked ? unlockedMap.get(achievement.id)!.toISOString() : undefined,
        isRedeemable,
        isSecret: achievement.isSecret,
        // Include progress data (only for non-secret, locked achievements)
        progress: progress
          ? {
              currentValue: progress.currentValue,
              targetValue: progress.targetValue,
              percentage: progress.percentage,
            }
          : undefined,
      };
    });
  }

  /**
   * Get only redeemable achievements (not yet unlocked but requirements met)
   */
  async getRedeemableAchievements(userId: number): Promise<Achievement[]> {
    // `getUserAchievements` already computed `isRedeemable` per achievement
    // using the right (window-aware) stats — just filter on that flag rather
    // than re-running the requirement check here with the wrong stats.
    const allAchievements = await this.getUserAchievements(userId);
    return allAchievements.filter((a) => a.isRedeemable);
  }

  /**
   * Redeem (unlock) an achievement manually
   * Returns the newly unlocked achievement
   */
  async redeemAchievement(userId: number, achievementId: string): Promise<Achievement> {
    const now = new Date();

    // Check if achievement exists
    const achievement = await prisma.achievement.findUnique({
      where: { id: achievementId },
    });

    if (!achievement) {
      throw new Error('Achievement not found');
    }

    // Check if achievement is currently valid (within time window)
    const isValidFrom = !achievement.validFrom || now >= achievement.validFrom;
    const isValidUntil = !achievement.validUntil || now <= achievement.validUntil;

    if (!isValidFrom || !isValidUntil) {
      throw new Error('Achievement is not currently available');
    }

    // Check if already unlocked
    const existing = await prisma.userAchievement.findUnique({
      where: {
        userId_achievementId: {
          userId,
          achievementId,
        },
      },
    });

    if (existing) {
      throw new Error('Achievement already unlocked');
    }

    // For seasonals, requirements are computed against the in-window stats —
    // otherwise an old account with a high lifetime total could redeem a
    // seasonal target without ever moving during the window.
    const userStats =
      achievement.validFrom || achievement.validUntil
        ? await this.achievementProgressService.getAchievementStats(
            userId,
            achievement.validFrom ?? undefined,
            achievement.validUntil ?? undefined
          )
        : await this.achievementProgressService.getAchievementStats(userId);

    if (!this.isAchievementUnlocked(achievement, userStats)) {
      throw new Error('Achievement requirements not met');
    }

    // Grant achievement
    const userAchievement = await prisma.userAchievement.create({
      data: {
        userId,
        achievementId,
      },
    });

    // Feed + inbox emission (best-effort).
    await feedEventEmitter
      .record(userId, {
        type: 'achievement_unlocked',
        entityType: 'achievement',
        entityId: achievement.id,
        metadata: { name: achievement.name, rarity: achievement.rarity },
      })
      .catch((err) => console.error('[Feed] achievement_unlocked emit failed:', err));

    await notificationEmitter
      .record(userId, {
        type: 'achievement_unlocked',
        entityType: 'achievement',
        entityId: achievement.id,
        metadata: { achievementName: achievement.name, rarity: achievement.rarity },
      })
      .catch((err) => console.error('[Inbox] achievement_unlocked emit failed:', err));

    return {
      id: achievement.id,
      name: achievement.name,
      description: achievement.description,
      icon: achievement.icon,
      rarity: achievement.rarity as Achievement['rarity'],
      requirement: {
        type: achievement.requirementType as Achievement['requirement']['type'],
        value: achievement.requirementValue,
        activityType: achievement.activityType || undefined,
      },
      unlockedAt: userAchievement.unlockedAt.toISOString(),
      isSecret: achievement.isSecret,
    };
  }

  /**
   * Get only unlocked achievements for a user
   */
  async getUnlockedAchievements(userId: number): Promise<Achievement[]> {
    const unlocked = await prisma.userAchievement.findMany({
      where: { userId },
      include: { achievement: true },
      orderBy: { unlockedAt: 'desc' },
    });

    return unlocked.map((ua) => ({
      id: ua.achievement.id,
      name: ua.achievement.name,
      description: ua.achievement.description,
      icon: ua.achievement.icon,
      rarity: ua.achievement.rarity as Achievement['rarity'],
      requirement: {
        type: ua.achievement.requirementType as Achievement['requirement']['type'],
        value: ua.achievement.requirementValue,
        activityType: ua.achievement.activityType || undefined,
      },
      unlockedAt: ua.unlockedAt.toISOString(),
    }));
  }

  /**
   * Check if achievement requirements are met
   */
  private isAchievementUnlocked(
    achievement: {
      requirementType: string;
      requirementValue: number;
      activityType: string | null;
    },
    stats: UserStats
  ): boolean {
    switch (achievement.requirementType) {
      case 'activities':
        return stats.totalActivities >= achievement.requirementValue;

      case 'distance':
        if (achievement.activityType) {
          const activityStats = stats.byActivityType[achievement.activityType];
          return activityStats ? activityStats.distance >= achievement.requirementValue : false;
        }
        return stats.totalDistance >= achievement.requirementValue;

      case 'elevation':
        if (achievement.activityType) {
          const activityStats = stats.byActivityType[achievement.activityType];
          return activityStats ? activityStats.elevation >= achievement.requirementValue : false;
        }
        return stats.totalElevation >= achievement.requirementValue;

      case 'streak':
        return stats.currentStreak >= achievement.requirementValue;

      case 'speed':
        // Speed achievements require an activity type — comparing m/s across
        // disciplines (a 4 m/s run vs. a 10 m/s ride) is meaningless.
        if (!achievement.activityType) return false;
        return (
          (stats.maxSpeedByActivityType?.[achievement.activityType] ?? 0) >=
          achievement.requirementValue
        );

      case 'variety':
        // Count of distinct activity types the user has logged in this window.
        return Object.keys(stats.byActivityType).length >= achievement.requirementValue;

      default:
        return false;
    }
  }

  /**
   * Resolve the right stats window for one achievement, caching window
   * queries so multiple seasonals sharing the same window only hit the DB
   * once. Lifetime achievements all share the pre-computed `defaultStats`.
   */
  private async pickStats(
    userId: number,
    achievement: Pick<PrismaAchievement, 'validFrom' | 'validUntil'>,
    defaultStats: UserStats,
    cache: Map<string, UserStats>
  ): Promise<UserStats> {
    if (!achievement.validFrom && !achievement.validUntil) {
      return defaultStats;
    }
    const key = `${achievement.validFrom?.getTime() ?? 'n'}_${achievement.validUntil?.getTime() ?? 'n'}`;
    let stats = cache.get(key);
    if (!stats) {
      stats = await this.achievementProgressService.getAchievementStats(
        userId,
        achievement.validFrom ?? undefined,
        achievement.validUntil ?? undefined
      );
      cache.set(key, stats);
    }
    return stats;
  }
}
