import { prisma } from '@shared/utils/index.js';
import type { NotificationPreference } from '@prisma/client';
import { NotificationsService, type PushPayload } from '../notifications/index.js';
import type { NotificationPayload } from './inbox.types.js';

/**
 * Single chokepoint for inserting Notification rows (A1 pattern, mirrors
 * `feedEventEmitter`). Every code path that needs to drop something in the
 * user's inbox goes through here — that gives us one place to add cross-cutting
 * concerns later (push fan-out, debounce, batching).
 *
 * Push fan-out: after the DB row is created, dispatch a web-push to the
 * recipient's subscribed devices, gated by their `NotificationPreference`.
 * Failures are logged but never propagate — the in-app notification is the
 * source of truth.
 */
class NotificationEmitter {
  private notificationsService = new NotificationsService();

  /**
   * Insert a single notification.
   *
   * `userId` is the RECIPIENT (the person who'll see this in their inbox).
   * `actorId` is OPTIONAL and identifies who caused the event (omit for
   * system-driven notifications like achievement unlocks).
   */
  async record(
    userId: number,
    payload: NotificationPayload,
    options?: { actorId?: number }
  ): Promise<void> {
    await prisma.notification.create({
      data: {
        userId,
        type: payload.type,
        actorId: options?.actorId ?? null,
        entityType: payload.entityType,
        entityId: payload.entityId,
        metadata: payload.metadata as unknown as object,
      },
    });

    await this.dispatchPush(userId, payload).catch((err) =>
      console.error(`[Push] dispatch failed for ${payload.type}:`, err)
    );
  }

  private async dispatchPush(userId: number, payload: NotificationPayload): Promise<void> {
    const prefs = await prisma.notificationPreference.findUnique({ where: { userId } });
    if (!isPushEnabled(prefs, payload.type)) {
      return;
    }
    const pushPayload = buildPushPayload(payload);
    await this.notificationsService.sendToUser(userId, pushPayload);
  }
}

/**
 * Default to enabled when no preference row exists — matches
 * `NotificationsService.getPreferences()` which auto-creates with all flags `true`.
 */
function isPushEnabled(
  prefs: NotificationPreference | null,
  type: NotificationPayload['type']
): boolean {
  if (!prefs) {
    return true;
  }
  switch (type) {
    case 'friend_request':
      return prefs.friendRequests;
    case 'friend_accepted':
      return prefs.friendAccepted;
    case 'achievement_unlocked':
      return prefs.achievementUnlocked;
    case 'challenge_invite':
      return prefs.challengeInvites;
    case 'challenge_joined':
    case 'challenge_progress':
    case 'challenge_activity_added':
    case 'challenge_cancelled':
    case 'challenge_completed':
      return prefs.challengeUpdates;
  }
}

function buildPushPayload(payload: NotificationPayload): PushPayload {
  switch (payload.type) {
    case 'friend_request':
      return {
        title: 'New friend request',
        body: `${payload.metadata.actorName} sent you a friend request`,
        data: { type: 'friend_request', userId: payload.entityId },
      };
    case 'friend_accepted':
      return {
        title: 'Friend request accepted',
        body: `${payload.metadata.actorName} accepted your friend request`,
        data: { type: 'friend_accepted', userId: payload.entityId },
      };
    case 'achievement_unlocked':
      return {
        title: 'Achievement unlocked',
        body: payload.metadata.achievementName,
        data: { type: 'achievement_unlocked', achievementId: payload.entityId },
      };
    case 'challenge_invite':
      return {
        title: 'Challenge invitation',
        body: `${payload.metadata.creatorName} invited you to "${payload.metadata.challengeName}"`,
        data: { type: 'challenge_invite', challengeId: payload.entityId },
      };
    case 'challenge_joined':
      return {
        title: payload.metadata.challengeName,
        body: `${payload.metadata.joinerName} joined your challenge`,
        data: { type: 'challenge_joined', challengeId: payload.entityId },
      };
    case 'challenge_progress':
      return {
        title: payload.metadata.challengeName,
        body: payload.metadata.milestone,
        data: { type: 'challenge_progress', challengeId: payload.entityId },
      };
    case 'challenge_activity_added': {
      const { challengeName, participantName, activityCount, totalDistance } = payload.metadata;
      const distanceKm = (totalDistance / 1000).toFixed(1);
      const activityText = activityCount === 1 ? 'activity' : 'activities';
      return {
        title: challengeName,
        body: `${participantName} added ${activityCount} ${activityText} (${distanceKm} km)`,
        data: { type: 'challenge_activity_added', challengeId: payload.entityId },
      };
    }
    case 'challenge_cancelled':
      return {
        title: 'Challenge cancelled',
        body: `"${payload.metadata.challengeName}" was cancelled by ${payload.metadata.cancelledByName}`,
        data: { type: 'challenge_cancelled', challengeId: payload.entityId },
      };
    case 'challenge_completed':
      return {
        title: payload.metadata.isSuccess ? 'Challenge completed!' : 'Challenge ended',
        body: `"${payload.metadata.challengeName}" has ended. Check your results!`,
        data: {
          type: 'challenge_completed',
          challengeId: payload.entityId,
          isSuccess: payload.metadata.isSuccess,
        },
      };
  }
}

export const notificationEmitter = new NotificationEmitter();
