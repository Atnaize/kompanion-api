import { StatsService } from '../stats/stats.service.js';
import type { Achievement, UserStats } from '@shared/types/index.js';

export class AchievementsService {
  private statsService = new StatsService();

  private readonly ACHIEVEMENTS: Omit<Achievement, 'unlockedAt'>[] = [
    {
      id: 'first_steps',
      name: 'First Steps',
      description: 'Complete your first activity',
      icon: '👟',
      rarity: 'common',
      requirement: { type: 'activities', value: 1 },
    },
    {
      id: 'getting_started',
      name: 'Getting Started',
      description: 'Complete 10 activities',
      icon: '🎯',
      rarity: 'common',
      requirement: { type: 'activities', value: 10 },
    },
    {
      id: 'dedicated',
      name: 'Dedicated',
      description: 'Complete 50 activities',
      icon: '💪',
      rarity: 'rare',
      requirement: { type: 'activities', value: 50 },
    },
    {
      id: 'marathon_runner',
      name: 'Marathon Runner',
      description: 'Run a total distance of 42.2km',
      icon: '🏃',
      rarity: 'rare',
      requirement: { type: 'distance', value: 42200, activityType: 'Run' },
    },
    {
      id: 'century_cyclist',
      name: 'Century Cyclist',
      description: 'Ride 100km in total',
      icon: '🚴',
      rarity: 'rare',
      requirement: { type: 'distance', value: 100000, activityType: 'Ride' },
    },
    {
      id: 'climbing_goat',
      name: 'Climbing Goat',
      description: 'Climb 1000m in elevation',
      icon: '⛰️',
      rarity: 'epic',
      requirement: { type: 'elevation', value: 1000 },
    },
    {
      id: 'everest',
      name: 'Everest',
      description: 'Climb 8848m in total elevation',
      icon: '🏔️',
      rarity: 'legendary',
      requirement: { type: 'elevation', value: 8848 },
    },
    {
      id: 'streak_week',
      name: 'Week Warrior',
      description: 'Maintain a 7-day streak',
      icon: '🔥',
      rarity: 'rare',
      requirement: { type: 'streak', value: 7 },
    },
    {
      id: 'streak_month',
      name: 'Month Master',
      description: 'Maintain a 30-day streak',
      icon: '🔥',
      rarity: 'epic',
      requirement: { type: 'streak', value: 30 },
    },
    {
      id: 'speed_demon',
      name: 'Speed Demon',
      description: 'Reach an average speed of 30 km/h',
      icon: '⚡',
      rarity: 'epic',
      requirement: { type: 'speed', value: 8.33 },
    },
  ];

  async getUserAchievements(userId: number): Promise<Achievement[]> {
    const stats = await this.statsService.calculateUserStats(userId);

    return this.ACHIEVEMENTS.map((achievement) => {
      const unlocked = this.isAchievementUnlocked(achievement, stats);

      return {
        ...achievement,
        unlockedAt: unlocked ? new Date().toISOString() : undefined,
      };
    });
  }

  private isAchievementUnlocked(
    achievement: Omit<Achievement, 'unlockedAt'>,
    stats: UserStats
  ): boolean {
    const { requirement } = achievement;

    switch (requirement.type) {
      case 'activities':
        return stats.totalActivities >= requirement.value;

      case 'distance':
        if (requirement.activityType) {
          const activityStats = stats.byActivityType[requirement.activityType];
          return activityStats ? activityStats.distance >= requirement.value : false;
        }
        return stats.totalDistance >= requirement.value;

      case 'elevation':
        if (requirement.activityType) {
          const activityStats = stats.byActivityType[requirement.activityType];
          return activityStats ? activityStats.elevation >= requirement.value : false;
        }
        return stats.totalElevation >= requirement.value;

      case 'streak':
        return stats.currentStreak >= requirement.value;

      case 'speed':
        return false;

      default:
        return false;
    }
  }
}
