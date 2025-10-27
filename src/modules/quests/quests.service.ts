import { ActivitiesService } from '../activities/activities.service.js';
import type { Quest } from '@shared/types/index.js';

export class QuestsService {
  private activitiesService = new ActivitiesService();

  async getUserQuests(userId: number): Promise<Quest[]> {
    const activities = await this.activitiesService.getUserActivities(userId);

    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 7);

    const weekActivities = activities.filter((activity) => {
      const activityDate = new Date(activity.start_date_local);
      return activityDate >= startOfWeek && activityDate < endOfWeek;
    });

    const weekDistance = weekActivities.reduce((sum, a) => sum + a.distance, 0);
    const weekElevation = weekActivities.reduce((sum, a) => sum + a.total_elevation_gain, 0);
    const weekCount = weekActivities.length;

    const quests: Quest[] = [
      {
        id: 'weekly_distance',
        name: 'Distance Warrior',
        description: 'Cover 50km this week',
        startDate: startOfWeek.toISOString(),
        endDate: endOfWeek.toISOString(),
        type: 'weekly',
        objectives: [
          {
            id: 'distance_50k',
            description: 'Cover 50km',
            type: 'distance',
            target: 50000,
            current: Math.round(weekDistance),
            completed: weekDistance >= 50000,
          },
        ],
        rewards: { xp: 500 },
        status: weekDistance >= 50000 ? 'completed' : 'active',
      },
      {
        id: 'weekly_elevation',
        name: 'Elevation Master',
        description: 'Climb 500m this week',
        startDate: startOfWeek.toISOString(),
        endDate: endOfWeek.toISOString(),
        type: 'weekly',
        objectives: [
          {
            id: 'elevation_500m',
            description: 'Climb 500m',
            type: 'elevation',
            target: 500,
            current: Math.round(weekElevation),
            completed: weekElevation >= 500,
          },
        ],
        rewards: { xp: 400 },
        status: weekElevation >= 500 ? 'completed' : 'active',
      },
      {
        id: 'weekly_activities',
        name: 'Consistency Champion',
        description: 'Complete 5 activities this week',
        startDate: startOfWeek.toISOString(),
        endDate: endOfWeek.toISOString(),
        type: 'weekly',
        objectives: [
          {
            id: 'activities_5',
            description: 'Complete 5 activities',
            type: 'activities',
            target: 5,
            current: weekCount,
            completed: weekCount >= 5,
          },
        ],
        rewards: { xp: 300 },
        status: weekCount >= 5 ? 'completed' : 'active',
      },
    ];

    return quests;
  }
}
