import { prisma } from '@shared/utils/index.js';
import axios from 'axios';
import type { StravaActivity } from '@shared/types/index.js';

interface StravaWebhookEvent {
  object_type: 'activity' | 'athlete';
  object_id: number;
  aspect_type: 'create' | 'update' | 'delete';
  updates?: {
    title?: string;
    type?: string;
    private?: string;
  };
  owner_id: number;
  subscription_id: number;
  event_time: number;
}

export class StravaWebhookService {
  /**
   * Process a Strava webhook event
   */
  async processEvent(event: StravaWebhookEvent): Promise<void> {
    console.info(
      `[Strava Webhook] Processing ${event.aspect_type} event for ${event.object_type} ${event.object_id}`
    );

    // Only process activity events for now
    if (event.object_type !== 'activity') {
      console.info('[Strava Webhook] Skipping non-activity event');
      return;
    }

    // Handle different event types
    switch (event.aspect_type) {
      case 'create':
        await this.handleActivityCreated(event);
        break;
      case 'update':
        await this.handleActivityUpdated(event);
        break;
      case 'delete':
        await this.handleActivityDeleted(event);
        break;
      default:
        console.info(`[Strava Webhook] Unknown aspect_type: ${String(event.aspect_type)}`);
    }
  }

  /**
   * Handle new activity created
   */
  private async handleActivityCreated(event: StravaWebhookEvent): Promise<void> {
    try {
      // Find the user by Strava ID
      const user = await prisma.user.findUnique({
        where: { stravaId: event.owner_id },
      });

      if (!user) {
        console.info(`[Strava Webhook] User not found for Strava ID ${event.owner_id}`);
        return;
      }

      // Fetch full activity details from Strava
      const activity = await this.fetchActivityFromStrava(event.object_id, user.accessToken);

      if (!activity) {
        console.error('[Strava Webhook] Failed to fetch activity from Strava');
        return;
      }

      // Save activity to database (if not already exists)
      await this.saveActivity(activity, user.id);

      // Update user stats
      await this.updateUserStats(user.id, activity);

      // Update active challenges
      await this.updateChallenges(user.id, activity);

      console.info(`[Strava Webhook] Successfully processed activity ${event.object_id}`);
    } catch (error) {
      console.error('[Strava Webhook] Error handling activity created:', error);
      throw error;
    }
  }

  /**
   * Handle activity updated (title, type, privacy changes)
   */
  private async handleActivityUpdated(event: StravaWebhookEvent): Promise<void> {
    console.info(`[Strava Webhook] Activity ${event.object_id} updated:`, event.updates);
    // For now, we don't need to handle updates
    // Could update activity title/type if needed in the future
  }

  /**
   * Handle activity deleted
   */
  private async handleActivityDeleted(event: StravaWebhookEvent): Promise<void> {
    try {
      const user = await prisma.user.findUnique({
        where: { stravaId: event.owner_id },
      });

      if (!user) {
        return;
      }

      // Remove activity from challenges
      await prisma.challengeActivity.deleteMany({
        where: {
          activityId: BigInt(event.object_id),
          userId: user.id,
        },
      });

      // Recalculate progress for affected challenges
      const affectedChallenges = await prisma.challengeActivity.findMany({
        where: { activityId: BigInt(event.object_id) },
        select: { challengeId: true },
        distinct: ['challengeId'],
      });

      for (const { challengeId } of affectedChallenges) {
        await this.recalculateChallengeProgress(challengeId, user.id);
      }

      console.info(
        `[Strava Webhook] Activity ${event.object_id} deleted and removed from challenges`
      );
    } catch (error) {
      console.error('[Strava Webhook] Error handling activity deleted:', error);
    }
  }

  /**
   * Fetch full activity details from Strava API
   */
  private async fetchActivityFromStrava(
    activityId: number,
    accessToken: string
  ): Promise<StravaActivity | null> {
    try {
      const response = await axios.get<StravaActivity>(
        `https://www.strava.com/api/v3/activities/${activityId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      return response.data;
    } catch (error) {
      console.error('[Strava API] Error fetching activity:', error);
      return null;
    }
  }

  /**
   * Save activity to database
   */
  private async saveActivity(activity: StravaActivity, userId: number): Promise<void> {
    await prisma.activity.upsert({
      where: { id: activity.id },
      create: {
        id: activity.id,
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
        summaryPolyline: activity.map?.summary_polyline,
        timezone: activity.timezone,
        manual: activity.manual,
        trainer: activity.trainer,
      },
      update: {
        // Only update fields that might change
        name: activity.name,
        type: activity.type,
        kudosCount: activity.kudos_count,
      },
    });
  }

  /**
   * Update user stats with new activity
   */
  private async updateUserStats(userId: number, activity: StravaActivity): Promise<void> {
    // This would integrate with your existing stats service
    // For now, we'll skip this as it's handled by your sync logic
    console.info(`[Stats] Would update stats for user ${userId} with activity ${activity.id}`);
  }

  /**
   * Update active challenges with new activity
   */
  private async updateChallenges(userId: number, activity: StravaActivity): Promise<void> {
    const activityDate = new Date(activity.start_date);

    // Find active challenges this user is participating in
    const activeChallenges = await prisma.challenge.findMany({
      where: {
        status: 'active',
        startDate: { lte: activityDate },
        endDate: { gte: activityDate },
        participants: {
          some: {
            userId,
            status: 'accepted',
          },
        },
      },
      include: {
        participants: {
          where: { userId },
        },
      },
    });

    console.info(
      `[Challenges] Found ${activeChallenges.length} active challenges for user ${userId}`
    );

    for (const challenge of activeChallenges) {
      await this.addActivityToChallenge(challenge.id, userId, activity);
    }
  }

  /**
   * Add activity to a challenge and update progress
   */
  private async addActivityToChallenge(
    challengeId: string,
    userId: number,
    activity: StravaActivity
  ): Promise<void> {
    try {
      // Check if activity already added to this challenge
      const existing = await prisma.challengeActivity.findUnique({
        where: {
          challengeId_activityId: {
            challengeId,
            activityId: activity.id,
          },
        },
      });

      if (existing) {
        console.info(`[Challenge] Activity ${activity.id} already in challenge ${challengeId}`);
        return;
      }

      // Add activity to challenge
      await prisma.challengeActivity.create({
        data: {
          challengeId,
          userId,
          activityId: activity.id,
          distance: activity.distance,
          elevation: activity.total_elevation_gain,
          movingTime: activity.moving_time,
          activityType: activity.type,
          recordedAt: new Date(activity.start_date),
        },
      });

      // Update participant progress
      await prisma.challengeParticipant.update({
        where: {
          challengeId_userId: {
            challengeId,
            userId,
          },
        },
        data: {
          totalDistance: { increment: activity.distance },
          totalElevation: { increment: activity.total_elevation_gain },
          activityCount: { increment: 1 },
          lastActivityAt: new Date(activity.start_date),
        },
      });

      // Create event for frontend polling
      await prisma.challengeEvent.create({
        data: {
          challengeId,
          userId,
          type: 'activity_added',
          data: {
            activityId: activity.id.toString(),
            activityName: activity.name,
            distance: activity.distance,
            elevation: activity.total_elevation_gain,
          },
        },
      });

      console.info(`[Challenge] Added activity ${activity.id} to challenge ${challengeId}`);
    } catch (error) {
      console.error(`[Challenge] Error adding activity to challenge:`, error);
    }
  }

  /**
   * Recalculate progress for a specific user in a challenge
   */
  private async recalculateChallengeProgress(challengeId: string, userId: number): Promise<void> {
    const activities = await prisma.challengeActivity.findMany({
      where: { challengeId, userId },
    });

    const totalDistance = activities.reduce((sum, act) => sum + act.distance, 0);
    const totalElevation = activities.reduce((sum, act) => sum + act.elevation, 0);
    const activityCount = activities.length;
    const lastActivity = activities.sort(
      (a, b) => b.recordedAt.getTime() - a.recordedAt.getTime()
    )[0];

    await prisma.challengeParticipant.update({
      where: {
        challengeId_userId: {
          challengeId,
          userId,
        },
      },
      data: {
        totalDistance,
        totalElevation,
        activityCount,
        lastActivityAt: lastActivity?.recordedAt || null,
      },
    });
  }
}
