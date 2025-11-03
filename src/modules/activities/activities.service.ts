import axios from 'axios';
import { config } from '@config/env.js';
import { prisma } from '@shared/utils/index.js';
import { AuthService } from '../auth/auth.service.js';
import type { StravaActivity, StravaDetailedActivity, User } from '@shared/types/index.js';
import { AppError } from '@shared/middleware/index.js';
import { HttpStatus } from '@shared/types/index.js';

export class ActivitiesService {
  private authService = new AuthService();

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

    // Fetch all activities from Strava
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

    // Get existing activity IDs for this user
    const existingActivityIds = await prisma.activity.findMany({
      where: { userId: user.id },
      select: { id: true },
    });

    const existingIds = new Set(existingActivityIds.map((a) => a.id.toString()));

    // Filter to only new activities
    const newActivities = allActivities.filter((a) => !existingIds.has(a.id.toString()));

    // Bulk insert new activities - batch processing for performance
    if (newActivities.length > 0) {
      const batchSize = 100;

      // Process in batches to avoid serverless timeout
      for (let i = 0; i < newActivities.length; i += batchSize) {
        const batch = newActivities.slice(i, i + batchSize);
        const data = batch.map((activity) => this.mapStravaActivityToDb(activity, user.id));

        // Use createMany for bulk insert (much faster than individual creates)
        await prisma.activity.createMany({
          data,
          skipDuplicates: true,
        });
      }

      // Update user's lastSyncedAt after all activities are saved
      await prisma.user.update({
        where: { id: user.id },
        data: { lastSyncedAt: new Date() },
      });
    } else {
      // Just update lastSyncedAt even if no new activities
      await prisma.user.update({
        where: { id: user.id },
        data: { lastSyncedAt: new Date() },
      });
    }

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

    // Fetch with progress tracking
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

        // Emit final count
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

    // Get existing activity IDs
    const existingActivityIds = await prisma.activity.findMany({
      where: { userId: user.id },
      select: { id: true },
    });

    const existingIds = new Set(existingActivityIds.map((a) => a.id.toString()));
    const newActivities = allActivities.filter((a) => !existingIds.has(a.id.toString()));

    // Save with progress tracking - batch processing for performance
    if (newActivities.length > 0) {
      const batchSize = 100;
      let saved = 0;

      // Process in batches to avoid serverless timeout
      for (let i = 0; i < newActivities.length; i += batchSize) {
        const batch = newActivities.slice(i, i + batchSize);
        const data = batch.map((activity) => this.mapStravaActivityToDb(activity, user.id));

        // Use createMany for bulk insert (much faster than individual creates)
        await prisma.activity.createMany({
          data,
          skipDuplicates: true, // Skip if activity already exists
        });

        saved += batch.length;

        onProgress({
          type: 'saving',
          current: saved,
          total: newActivities.length,
          message: `Saving activities... ${saved}/${newActivities.length}`,
        });
      }

      // Update user's lastSyncedAt after all activities are saved
      await prisma.user.update({
        where: { id: user.id },
        data: { lastSyncedAt: new Date() },
      });
    } else {
      // Just update lastSyncedAt even if no new activities
      await prisma.user.update({
        where: { id: user.id },
        data: { lastSyncedAt: new Date() },
      });
    }

    return {
      synced: newActivities.length,
      total: allActivities.length,
      isIncremental,
    };
  }

  async getUserActivities(userId: number): Promise<StravaActivity[]> {
    const activities = await prisma.activity.findMany({
      where: { userId },
      orderBy: { startDate: 'desc' },
    });

    return activities.map((activity) => this.mapDbActivityToStrava(activity));
  }

  async getActivityById(activityId: number, userId: number): Promise<StravaActivity | null> {
    const activity = await prisma.activity.findFirst({
      where: {
        id: BigInt(activityId),
        userId,
      },
    });

    return activity ? this.mapDbActivityToStrava(activity) : null;
  }

  async getDetailedActivityById(
    activityId: number,
    user: User
  ): Promise<StravaDetailedActivity | null> {
    // First check if activity belongs to user
    const dbActivity = await prisma.activity.findFirst({
      where: {
        id: BigInt(activityId),
        userId: user.id,
      },
    });

    if (!dbActivity) {
      return null;
    }

    // Fetch detailed activity from Strava API (includes segment efforts)
    const accessToken = await this.authService.ensureValidToken(user);

    try {
      const response = await axios.get<StravaDetailedActivity>(
        `${config.strava.apiUrl}/activities/${activityId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      return response.data;
    } catch (error) {
      console.error('Fetch detailed activity error:', error);
      // Fall back to basic activity data if detailed fetch fails
      return this.mapDbActivityToStrava(dbActivity);
    }
  }

  /**
   * Map Strava API activity to database model
   */
  private mapStravaActivityToDb(
    activity: StravaActivity,
    userId: number
  ): {
    id: bigint;
    userId: number;
    name: string;
    type: string;
    sportType: string;
    distance: number;
    movingTime: number;
    elapsedTime: number;
    totalElevationGain: number;
    startDate: Date;
    startDateLocal: Date;
    averageSpeed: number;
    maxSpeed: number;
    averageWatts: number | undefined;
    kilojoules: number | undefined;
    averageHeartrate: number | undefined;
    maxHeartrate: number | undefined;
    elevHigh: number | undefined;
    elevLow: number | undefined;
    kudosCount: number;
    achievementCount: number;
    prCount: number;
    summaryPolyline: string | null;
    timezone: string;
    manual: boolean;
    trainer: boolean;
  } {
    return {
      id: BigInt(activity.id),
      userId,
      name: activity.name,
      type: activity.type,
      sportType: activity.sport_type,
      distance: activity.distance,
      movingTime: activity.moving_time,
      elapsedTime: activity.elapsed_time,
      totalElevationGain: activity.total_elevation_gain,
      startDate: new Date(activity.start_date),
      startDateLocal: new Date(activity.start_date_local),
      averageSpeed: activity.average_speed,
      maxSpeed: activity.max_speed,
      averageWatts: activity.average_watts,
      kilojoules: activity.kilojoules,
      averageHeartrate: activity.average_heartrate,
      maxHeartrate: activity.max_heartrate,
      elevHigh: activity.elev_high,
      elevLow: activity.elev_low,
      kudosCount: activity.kudos_count,
      achievementCount: activity.achievement_count,
      prCount: activity.pr_count,
      summaryPolyline: activity.map?.summary_polyline || null,
      timezone: activity.timezone,
      manual: activity.manual,
      trainer: activity.trainer,
    };
  }

  /**
   * Map database activity to Strava API format
   */
  private mapDbActivityToStrava(activity: {
    id: bigint;
    userId: number;
    name: string;
    type: string;
    sportType: string;
    distance: number;
    movingTime: number;
    elapsedTime: number;
    totalElevationGain: number;
    startDate: Date;
    startDateLocal: Date;
    averageSpeed: number;
    maxSpeed: number;
    averageWatts: number | null;
    kilojoules: number | null;
    averageHeartrate: number | null;
    maxHeartrate: number | null;
    elevHigh: number | null;
    elevLow: number | null;
    kudosCount: number;
    achievementCount: number;
    prCount: number;
    summaryPolyline: string | null;
    timezone: string;
    manual: boolean;
    trainer: boolean;
    createdAt: Date;
  }): StravaActivity {
    return {
      id: Number(activity.id),
      resource_state: 2,
      external_id: '',
      upload_id: 0,
      athlete: {
        id: activity.userId,
        resource_state: 1,
      },
      name: activity.name,
      distance: activity.distance,
      moving_time: activity.movingTime,
      elapsed_time: activity.elapsedTime,
      total_elevation_gain: activity.totalElevationGain,
      type: activity.type as StravaActivity['type'],
      sport_type: activity.sportType,
      start_date: activity.startDate.toISOString(),
      start_date_local: activity.startDateLocal.toISOString(),
      timezone: activity.timezone,
      utc_offset: 0,
      achievement_count: activity.achievementCount,
      kudos_count: activity.kudosCount,
      comment_count: 0,
      athlete_count: 1,
      photo_count: 0,
      map: {
        id: '',
        summary_polyline: activity.summaryPolyline || '',
        resource_state: 2,
      },
      trainer: activity.trainer,
      commute: false,
      manual: activity.manual,
      private: false,
      visibility: 'everyone',
      flagged: false,
      gear_id: '',
      average_speed: activity.averageSpeed,
      max_speed: activity.maxSpeed,
      average_watts: activity.averageWatts || undefined,
      kilojoules: activity.kilojoules || undefined,
      device_watts: false,
      has_heartrate: !!activity.averageHeartrate,
      average_heartrate: activity.averageHeartrate || undefined,
      max_heartrate: activity.maxHeartrate || undefined,
      heartrate_opt_out: false,
      display_hide_heartrate_option: false,
      elev_high: activity.elevHigh || undefined,
      elev_low: activity.elevLow || undefined,
      pr_count: activity.prCount,
      total_photo_count: 0,
      has_kudoed: false,
    };
  }
}
