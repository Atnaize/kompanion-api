import { prisma } from '@shared/utils/index.js';
import type { NotificationPreference } from '@prisma/client';
import { NotificationsService, type PushPayload } from '../notifications/index.js';
import { privacyService } from '../privacy/index.js';
import { realtimePublisher } from '../realtime/index.js';
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
    options?: {
      actorId?: number;
      /**
       * When true, write the inbox row but skip the push dispatch. Used for
       * per-context mutes (e.g. challenge chat with chatMutedUntil > now) —
       * the in-app message still lands so the user can see it next time they
       * open the app, but no banner interrupts them.
       */
      silent?: boolean;
    }
  ): Promise<void> {
    // Privacy: suppress when actor and recipient have a block in either direction.
    // Mute is intentionally NOT applied — mute hides activity from feeds, not
    // direct notifications like "X invited you to a challenge".
    if (options?.actorId && options.actorId !== userId) {
      if (await privacyService.isBlockedEitherWay(userId, options.actorId)) {
        return;
      }
    }

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

    // Realtime fan-out: ping the recipient's personal channel so their open app
    // refreshes the inbox + nav badge immediately ("something changed —
    // refetch"). Fired even when `silent`, since silent only suppresses the OS
    // push banner — the in-app row should still appear live. Best-effort: the
    // publisher swallows its own errors and no-ops when realtime is disabled.
    void realtimePublisher.publishToUser(userId);

    if (options?.silent) {
      return;
    }

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
    case 'chat_message':
      return prefs.chatMessages;
    case 'chat_mention':
      // Mentions bypass per-conversation mute upstream (see chat.service
      // dispatchChatNotifications) and are gated only on this dedicated switch.
      return prefs.chatMentions;
    case 'chat_reaction':
      return prefs.chatReactions;
    case 'chat_reply':
      return prefs.chatReplies;
    case 'club_invite':
      // Treated as a friend-style social ping. No dedicated preference yet —
      // when we add `clubActivity` (step 3), gate this on it.
      return prefs.friendRequests;
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
    case 'club_invite':
      return {
        title: 'Club invitation',
        body: `${payload.metadata.inviterName} invited you to "${payload.metadata.clubName}"`,
        data: { type: 'club_invite', clubId: payload.entityId },
      };
    case 'chat_message':
      return {
        title: payload.metadata.scopeName,
        body: `${payload.metadata.senderName}: ${payload.metadata.preview}`,
        // Per-conversation tag so the device collapses the chat to a single
        // banner — the WhatsApp pattern. Subsequent messages replace the prior
        // notification rather than stacking up.
        tag: `conversation:${payload.metadata.conversationId}`,
        data: {
          type: 'chat_message',
          conversationId: payload.metadata.conversationId,
          scopeKind: payload.metadata.scopeKind,
        },
      };
    case 'chat_mention':
      return {
        title: `${payload.metadata.senderName} mentioned you`,
        body: `${payload.metadata.scopeName}: ${payload.metadata.preview}`,
        // Distinct tag from generic chat so a mention pops its own banner
        // instead of being swallowed by the collapsed chat notification.
        tag: `conversation:${payload.metadata.conversationId}:mention`,
        data: {
          type: 'chat_mention',
          conversationId: payload.metadata.conversationId,
          scopeKind: payload.metadata.scopeKind,
        },
      };
    case 'chat_reaction':
      return {
        title: payload.metadata.scopeName,
        body: `${payload.metadata.actorName} reacted ${payload.metadata.emoji} to "${payload.metadata.messagePreview}"`,
        // One banner per message — additional reactions on the same message
        // replace prior banners instead of stacking.
        tag: `message:${payload.entityId}:reactions`,
        data: {
          type: 'chat_reaction',
          conversationId: payload.metadata.conversationId,
          messageId: payload.entityId,
        },
      };
    case 'chat_reply':
      return {
        title: `${payload.metadata.actorName} replied`,
        body: `${payload.metadata.scopeName}: ${payload.metadata.preview}`,
        tag: `message:${payload.entityId}:replies`,
        data: {
          type: 'chat_reply',
          conversationId: payload.metadata.conversationId,
          parentMessageId: payload.entityId,
        },
      };
  }
}

export const notificationEmitter = new NotificationEmitter();
