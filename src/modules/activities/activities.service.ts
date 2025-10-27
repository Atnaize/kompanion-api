import axios from 'axios';
import { config } from '@config/env.js';
import { JsonStorage } from '@shared/utils/index.js';
import { AuthService } from '../auth/auth.service.js';
import type { StravaActivity, User } from '@shared/types/index.js';
import { AppError } from '@shared/middleware/index.js';
import { HttpStatus } from '@shared/types/index.js';

interface StoredActivity extends StravaActivity {
  userId: number;
  syncedAt: string;
}

export class ActivitiesService {
  private activityStorage = new JsonStorage<StoredActivity>('activities.json');
  private authService = new AuthService();
  private userStorage = new JsonStorage<User>('users.json');

  async fetchActivities(
    user: User,
    page = 1,
    perPage = 30,
    after?: number
  ): Promise<StravaActivity[]> {
    const accessToken = await this.authService.ensureValidToken(user);

    try {
      const params: Record<string, string | number> = {
        page,
        per_page: perPage,
      };

      if (after) {
        params.after = after;
      }

      const response = await axios.get<StravaActivity[]>(
        `${config.strava.apiUrl}/athlete/activities`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          params,
        }
      );

      return response.data;
    } catch (error) {
      console.error('Fetch activities error:', error);
      throw new AppError(HttpStatus.BAD_REQUEST, 'Failed to fetch activities from Strava');
    }
  }

  async syncActivities(
    user: User
  ): Promise<{ synced: number; total: number; isIncremental: boolean }> {
    const isIncremental = !!user.lastSyncedAt;
    const after = user.lastSyncedAt
      ? Math.floor(new Date(user.lastSyncedAt).getTime() / 1000)
      : undefined;

    let allActivities: StravaActivity[] = [];
    let page = 1;
    const perPage = 100;
    let hasMore = true;

    while (hasMore) {
      const activities = await this.fetchActivities(user, page, perPage, after);

      if (activities.length === 0) {
        hasMore = false;
      } else {
        allActivities = [...allActivities, ...activities];

        if (activities.length < perPage) {
          hasMore = false;
        } else {
          page++;
        }
      }
    }

    const storedActivities: StoredActivity[] = allActivities.map((activity) => ({
      ...activity,
      userId: user.id,
      syncedAt: new Date().toISOString(),
    }));

    const existingActivities = await this.activityStorage.read();
    const userActivities = existingActivities.filter((a) => a.userId === user.id);

    const newActivities = storedActivities.filter(
      (newActivity) => !userActivities.some((existing) => existing.id === newActivity.id)
    );

    for (const activity of newActivities) {
      await this.activityStorage.create(activity);
    }

    await this.userStorage.update(user.id, {
      ...user,
      lastSyncedAt: new Date().toISOString(),
    });

    return {
      synced: newActivities.length,
      total: allActivities.length,
      isIncremental,
    };
  }

  async syncActivitiesWithProgress(
    user: User,
    onProgress: (data: {
      type: 'fetching' | 'saving' | 'complete' | 'error';
      current?: number;
      total?: number;
      message?: string;
    }) => void
  ): Promise<{ synced: number; total: number; isIncremental: boolean }> {
    const isIncremental = !!user.lastSyncedAt;
    const after = user.lastSyncedAt
      ? Math.floor(new Date(user.lastSyncedAt).getTime() / 1000)
      : undefined;

    let allActivities: StravaActivity[] = [];
    let page = 1;
    const perPage = 100;
    let hasMore = true;
    let lastEmittedCount = 0;
    const emitInterval = 20;

    while (hasMore) {
      const activities = await this.fetchActivities(user, page, perPage, after);

      if (activities.length === 0) {
        hasMore = false;
      } else {
        allActivities = [...allActivities, ...activities];

        // Emit progress every 20 activities
        while (lastEmittedCount + emitInterval <= allActivities.length) {
          lastEmittedCount += emitInterval;
          onProgress({
            type: 'fetching',
            current: lastEmittedCount,
            message: `Fetching from Strava... ${lastEmittedCount} activities found`,
          });
        }

        // Emit final count if not at a milestone
        if (allActivities.length > lastEmittedCount) {
          onProgress({
            type: 'fetching',
            current: allActivities.length,
            message: `Fetching from Strava... ${allActivities.length} activities found`,
          });
          lastEmittedCount = allActivities.length;
        }

        if (activities.length < perPage) {
          hasMore = false;
        } else {
          page++;
        }
      }
    }

    const storedActivities: StoredActivity[] = allActivities.map((activity) => ({
      ...activity,
      userId: user.id,
      syncedAt: new Date().toISOString(),
    }));

    const existingActivities = await this.activityStorage.read();
    const userActivities = existingActivities.filter((a) => a.userId === user.id);

    const newActivities = storedActivities.filter(
      (newActivity) => !userActivities.some((existing) => existing.id === newActivity.id)
    );

    let saved = 0;
    for (const activity of newActivities) {
      await this.activityStorage.create(activity);
      saved++;

      if (saved % 10 === 0 || saved === newActivities.length) {
        onProgress({
          type: 'saving',
          current: saved,
          total: newActivities.length,
          message: `Saving activities... ${saved}/${newActivities.length}`,
        });
      }
    }

    await this.userStorage.update(user.id, {
      ...user,
      lastSyncedAt: new Date().toISOString(),
    });

    return {
      synced: newActivities.length,
      total: allActivities.length,
      isIncremental,
    };
  }

  async getUserActivities(userId: number): Promise<StoredActivity[]> {
    const allActivities = await this.activityStorage.read();
    return allActivities.filter((activity) => activity.userId === userId);
  }

  async getActivityById(activityId: number, userId: number): Promise<StoredActivity | null> {
    const activity = await this.activityStorage.findById(activityId);

    if (!activity || activity.userId !== userId) {
      return null;
    }

    return activity;
  }
}
