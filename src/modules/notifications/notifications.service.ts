import webpush from 'web-push';
import { config } from '@config/env.js';
import { prisma } from '@shared/utils/index.js';
import type { PushSubscription as WebPushSubscription } from 'web-push';

interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  data?: Record<string, unknown>;
}

export class NotificationsService {
  constructor() {
    webpush.setVapidDetails(
      config.vapid.subject,
      config.vapid.publicKey,
      config.vapid.privateKey
    );
  }

  async subscribe(
    userId: number,
    subscription: WebPushSubscription,
    userAgent?: string
  ): Promise<void> {
    await prisma.pushSubscription.upsert({
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
  }

  async unsubscribe(userId: number, endpoint: string): Promise<void> {
    await prisma.pushSubscription.deleteMany({
      where: {
        userId,
        endpoint,
      },
    });
  }

  async getPreferences(userId: number) {
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
      activityWebhooks?: boolean;
      challengeInvites?: boolean;
      challengeProgress?: boolean;
      challengeReminders?: boolean;
    }
  ) {
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
    const subscriptions = await prisma.pushSubscription.findMany({
      where: { userId },
    });

    if (subscriptions.length === 0) {
      console.log(`[Notifications] No subscriptions found for user ${userId}`);
      return;
    }

    const notificationPayload = JSON.stringify({
      title: payload.title,
      body: payload.body,
      icon: payload.icon || '/icon-192.png',
      badge: payload.badge || '/icon-192.png',
      data: payload.data || {},
    });

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

          console.log(`[Notifications] Sent to subscription ${sub.id}`);
        } catch (error) {
          console.error(`[Notifications] Failed to send to subscription ${sub.id}:`, error);

          if (error && typeof error === 'object' && 'statusCode' in error) {
            const statusCode = (error as { statusCode: number }).statusCode;
            if (statusCode === 404 || statusCode === 410) {
              await prisma.pushSubscription.delete({
                where: { id: sub.id },
              });
              console.log(`[Notifications] Deleted invalid subscription ${sub.id}`);
            }
          }

          throw error;
        }
      })
    );

    const failed = results.filter((r) => r.status === 'rejected').length;
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;

    console.log(
      `[Notifications] Sent to user ${userId}: ${succeeded} succeeded, ${failed} failed`
    );
  }

  async notifyActivityWebhook(
    userId: number,
    activityName: string,
    activityType: string
  ): Promise<void> {
    const preferences = await this.getPreferences(userId);
    if (!preferences.activityWebhooks) {
      return;
    }

    await this.sendToUser(userId, {
      title: 'Activity Synced',
      body: `${activityType}: ${activityName}`,
      icon: '/icon-192.png',
      data: {
        type: 'activity_webhook',
        activityType,
      },
    });
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
      icon: '/icon-192.png',
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
      icon: '/icon-192.png',
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
      icon: '/icon-192.png',
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
      icon: '/icon-192.png',
      data: {
        type: 'challenge_ending',
        challengeName,
      },
    });
  }
}
