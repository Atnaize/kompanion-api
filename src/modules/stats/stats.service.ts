import { ActivitiesService } from '../activities/activities.service.js';
import type { UserStats } from '@shared/types/index.js';

export class StatsService {
  private activitiesService = new ActivitiesService();

  async calculateUserStats(userId: number): Promise<UserStats> {
    const activities = await this.activitiesService.getUserActivities(userId);

    const byActivityType: UserStats['byActivityType'] = {};
    let totalDistance = 0;
    let totalElevation = 0;
    let totalTime = 0;

    for (const activity of activities) {
      totalDistance += activity.distance;
      totalElevation += activity.total_elevation_gain;
      totalTime += activity.moving_time;

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
      byActivityType[activity.type].elevation += activity.total_elevation_gain;
      byActivityType[activity.type].time += activity.moving_time;
    }

    const currentStreak = this.calculateStreak(activities.map((a) => a.start_date_local).sort());

    // --- Improved XP System ---
    // Rewards distance & elevation nonlinearly and reduces spam benefit.
    const distanceKm = totalDistance / 1000;
    const elevationM = totalElevation;
    const activityCount = activities.length || 1;

    // Distance: rewarding but not linear (1.1 exponent gives a bonus to long efforts)
    const distanceXP = Math.pow(distanceKm, 1.1) * 60;

    // Elevation: valuable but secondary (rewarded per 100m, 0.9 exponent = diminishing returns)
    const elevationXP = Math.pow(elevationM / 100, 0.9) * 25;

    // Consistency: small bonus per activity (grinds matter a little)
    const consistencyXP = activityCount * 30;

    // Anti-spam: penalize if average distance < 3 km
    const avgDistance = distanceKm / activityCount;
    const spamPenalty = Math.min(1, avgDistance / 3);

    // Total XP
    const xp = Math.floor((distanceXP + elevationXP + consistencyXP) * spamPenalty);
    // --- LEVEL SYSTEM ---
    // Fast early progression, exponential slowdown
    const level = Math.floor(Math.pow(xp / 200, 0.4)) + 1;

    return {
      userId,
      totalDistance: Math.round(totalDistance),
      totalElevation: Math.round(totalElevation),
      totalActivities: activities.length,
      totalTime,
      currentStreak,
      longestStreak: currentStreak,
      level,
      xp,
      byActivityType,
    };
  }

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

    if (daysDiff > 1) {
      return 0;
    }

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
    }

    return streak;
  }
}
