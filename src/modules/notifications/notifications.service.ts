import webpush from 'web-push';
import { config } from '@config/env.js';
import { prisma } from '@shared/utils/index.js';
import type { PushSubscription as WebPushSubscription } from 'web-push';
import type { NotificationPreference } from '@prisma/client';

interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  data?: Record<string, unknown>;
}

export class NotificationsService {
  constructor() {
    webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);
  }

  async subscribe(
    userId: number,
    subscription: WebPushSubscription,
    userAgent?: string
  ): Promise<void> {
    console.info(
      `[Notifications] Subscribing user ${userId} with endpoint: ${subscription.endpoint.substring(0, 50)}...`
    );

    const result = await prisma.pushSubscription.upsert({
      where: {
        userId_endpoint: {
          userId,
          endpoint: subscription.endpoint,
        },
      },
      update: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userAgent,
        lastUsedAt: new Date(),
      },
      create: {
        userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userAgent,
      },
    });

    console.info(`[Notifications] Subscription saved with id: ${result.id}`);
  }

  async unsubscribe(userId: number, endpoint: string): Promise<void> {
    await prisma.pushSubscription.deleteMany({
      where: {
        userId,
        endpoint,
      },
    });
  }

  async getPreferences(userId: number): Promise<NotificationPreference> {
    let preferences = await prisma.notificationPreference.findUnique({
      where: { userId },
    });

    if (!preferences) {
      preferences = await prisma.notificationPreference.create({
        data: { userId },
      });
    }

    return preferences;
  }

  async updatePreferences(
    userId: number,
    updates: {
      challengeInvites?: boolean;
      challengeProgress?: boolean;
      challengeReminders?: boolean;
    }
  ): Promise<NotificationPreference> {
    return await prisma.notificationPreference.upsert({
      where: { userId },
      update: updates,
      create: {
        userId,
        ...updates,
      },
    });
  }

  async sendToUser(userId: number, payload: PushPayload): Promise<void> {
    console.info(`[Notifications] Sending notification to user ${userId}:`, {
      title: payload.title,
      body: payload.body,
    });

    const subscriptions = await prisma.pushSubscription.findMany({
      where: { userId },
    });

    if (subscriptions.length === 0) {
      console.info(`[Notifications] No subscriptions found for user ${userId}`);
      return;
    }

    console.info(
      `[Notifications] Found ${subscriptions.length} subscription(s) for user ${userId}`
    );

    const notificationPayload = JSON.stringify({
      title: payload.title,
      body: payload.body,
      icon: payload.icon || '/pwa-192x192.svg',
      badge: payload.badge || '/pwa-64x64.svg',
      data: payload.data || {},
    });

    console.info(`[Notifications] Payload: ${notificationPayload}`);

    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          const webPushSub: WebPushSubscription = {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          };

          await webpush.sendNotification(webPushSub, notificationPayload);

          await prisma.pushSubscription.update({
            where: { id: sub.id },
            data: { lastUsedAt: new Date() },
          });

          console.info(`[Notifications] Sent to subscription ${sub.id}`);
        } catch (error) {
          console.error(`[Notifications] Failed to send to subscription ${sub.id}`);

          // Log detailed error information
          if (error && typeof error === 'object') {
            const statusCode =
              'statusCode' in error ? (error as { statusCode: number }).statusCode : undefined;
            const message =
              'message' in error ? (error as { message: string }).message : 'Unknown error';
            console.error(
              `[Notifications] Error details: statusCode=${statusCode}, message=${message}`
            );

            // Delete invalid subscriptions (404/410 = subscription no longer exists)
            if (statusCode === 404 || statusCode === 410) {
              await prisma.pushSubscription.delete({
                where: { id: sub.id },
              });
              console.info(`[Notifications] Deleted invalid subscription ${sub.id}`);
            }
          } else {
            console.error(`[Notifications] Error:`, error);
          }

          throw error;
        }
      })
    );

    const failed = results.filter((r) => r.status === 'rejected').length;
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;

    console.info(
      `[Notifications] Sent to user ${userId}: ${succeeded} succeeded, ${failed} failed`
    );
  }

  async notifyChallengeInvite(
    userId: number,
    challengeName: string,
    inviterName: string
  ): Promise<void> {
    const preferences = await this.getPreferences(userId);
    if (!preferences.challengeInvites) {
      return;
    }

    await this.sendToUser(userId, {
      title: 'Challenge Invitation',
      body: `${inviterName} invited you to "${challengeName}"`,
      icon: '/pwa-192x192.svg',
      badge: '/pwa-64x64.svg',
      data: {
        type: 'challenge_invite',
        challengeName,
      },
    });
  }

  async notifyChallengeProgress(
    userId: number,
    challengeName: string,
    milestone: string
  ): Promise<void> {
    const preferences = await this.getPreferences(userId);
    if (!preferences.challengeProgress) {
      return;
    }

    await this.sendToUser(userId, {
      title: 'Challenge Milestone',
      body: `${challengeName}: ${milestone}`,
      icon: '/pwa-192x192.svg',
      badge: '/pwa-64x64.svg',
      data: {
        type: 'challenge_progress',
        challengeName,
        milestone,
      },
    });
  }

  async notifyChallengeStarting(userId: number, challengeName: string): Promise<void> {
    const preferences = await this.getPreferences(userId);
    if (!preferences.challengeReminders) {
      return;
    }

    await this.sendToUser(userId, {
      title: 'Challenge Starting Soon',
      body: `"${challengeName}" starts in 24 hours!`,
      icon: '/pwa-192x192.svg',
      badge: '/pwa-64x64.svg',
      data: {
        type: 'challenge_starting',
        challengeName,
      },
    });
  }

  async notifyChallengeEnding(userId: number, challengeName: string): Promise<void> {
    const preferences = await this.getPreferences(userId);
    if (!preferences.challengeReminders) {
      return;
    }

    await this.sendToUser(userId, {
      title: 'Challenge Ending Soon',
      body: `"${challengeName}" ends in 24 hours!`,
      icon: '/pwa-192x192.svg',
      badge: '/pwa-64x64.svg',
      data: {
        type: 'challenge_ending',
        challengeName,
      },
    });
  }

  /**
   * Notify a user that another participant added activities to a shared challenge
   */
  async notifyChallengeActivityAdded(
    userId: number,
    challengeName: string,
    participantName: string,
    activityCount: number,
    totalDistance: number
  ): Promise<void> {
    const preferences = await this.getPreferences(userId);
    if (!preferences.challengeProgress) {
      console.info(
        `[Notifications] User ${userId} has challengeProgress disabled, skipping activity notification`
      );
      return;
    }

    const distanceKm = (totalDistance / 1000).toFixed(1);
    const activityText = activityCount === 1 ? 'activity' : 'activities';

    await this.sendToUser(userId, {
      title: challengeName,
      body: `${participantName} added ${activityCount} ${activityText} (${distanceKm} km)`,
      icon: '/pwa-192x192.svg',
      badge: '/pwa-64x64.svg',
      data: {
        type: 'challenge_activity',
        challengeName,
        participantName,
        activityCount,
        totalDistance,
      },
    });
  }

  async notifyChallengeCancelled(
    userId: number,
    challengeName: string,
    cancelledByName: string
  ): Promise<void> {
    const preferences = await this.getPreferences(userId);
    if (!preferences.challengeProgress) {
      return;
    }

    await this.sendToUser(userId, {
      title: 'Challenge Cancelled',
      body: `"${challengeName}" was cancelled by ${cancelledByName}`,
      icon: '/pwa-192x192.svg',
      badge: '/pwa-64x64.svg',
      data: {
        type: 'challenge_cancelled',
        challengeName,
      },
    });
  }

  async notifyChallengeCompleted(
    userId: number,
    challengeName: string,
    isSuccess: boolean
  ): Promise<void> {
    const preferences = await this.getPreferences(userId);
    if (!preferences.challengeProgress) {
      return;
    }

    await this.sendToUser(userId, {
      title: isSuccess ? 'Challenge Completed!' : 'Challenge Ended',
      body: `"${challengeName}" has ended. Check your results!`,
      icon: '/pwa-192x192.svg',
      badge: '/pwa-64x64.svg',
      data: {
        type: 'challenge_completed',
        challengeName,
        isSuccess,
      },
    });
  }
}
