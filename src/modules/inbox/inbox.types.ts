/**
 * Polymorphic inbox notification registry. Same pattern as FeedEventType:
 *   1. add a value here
 *   2. emit via `notificationEmitter.record(...)`
 *   3. register a renderer on the frontend
 */
export type NotificationType =
  | 'friend_request' // someone sent me a friend request
  | 'friend_accepted' // someone accepted my outgoing friend request
  | 'achievement_unlocked' // I unlocked an achievement (system-driven)
  | 'challenge_invite' // someone invited me to a challenge
  | 'challenge_joined' // someone accepted my challenge invitation
  | 'challenge_progress' // a milestone was reached in a challenge I'm in
  | 'challenge_activity_added' // another participant logged activities in a shared challenge
  | 'challenge_cancelled' // the creator cancelled a challenge I'm in
  | 'challenge_completed' // a challenge I'm in ended (succeeded or failed)
  | 'chat_message' // someone sent a text message in a conversation I'm in
  | 'chat_mention' // someone @'d me in chat (bypasses per-conversation mute)
  | 'chat_reaction' // someone reacted to a message I authored (or contributed to, for digests)
  | 'chat_reply' // someone replied to a message I authored (or contributed to)
  | 'club_invite'; // someone invited me to a club

export interface FriendRequestMetadata {
  actorName: string;
}

export interface FriendAcceptedMetadata {
  actorName: string;
}

export interface AchievementUnlockedNotifMetadata {
  achievementName: string;
  rarity: string;
}

export interface ChallengeInviteMetadata {
  challengeName: string;
  creatorName: string;
}

export interface ChallengeJoinedNotifMetadata {
  challengeName: string;
  joinerName: string;
}

export interface ChallengeProgressMetadata {
  challengeName: string;
  milestone: string;
}

export interface ChallengeActivityAddedMetadata {
  challengeName: string;
  participantName: string;
  activityCount: number;
  totalDistance: number;
}

export interface ChallengeCancelledMetadata {
  challengeName: string;
  cancelledByName: string;
}

export interface ChallengeCompletedMetadata {
  challengeName: string;
  isSuccess: boolean;
}

export interface ClubInviteMetadata {
  clubName: string;
  inviterName: string;
}

// Scope label rendered into the push title ("Morning Riders chat", "Spring 5K
// challenge", "@Bob"). Lets the chat notification types stay scope-agnostic
// while still showing a useful header on the device.
export type ChatScopeKind = 'club' | 'challenge' | 'dm';

export interface ChatMessageMetadata {
  /** Display title — club/challenge name, or sender name for DMs. */
  scopeName: string;
  scopeKind: ChatScopeKind;
  conversationId: string;
  senderName: string;
  /** Truncated body for the push body line. Full message lives in the chat. */
  preview: string;
}

export interface ChatMentionMetadata {
  scopeName: string;
  scopeKind: ChatScopeKind;
  conversationId: string;
  senderName: string;
  preview: string;
}

export interface ChatReactionMetadata {
  scopeName: string;
  scopeKind: ChatScopeKind;
  conversationId: string;
  /** Who reacted. */
  actorName: string;
  emoji: string;
  /** Preview of the message that was reacted to. */
  messagePreview: string;
}

export interface ChatReplyMetadata {
  scopeName: string;
  scopeKind: ChatScopeKind;
  conversationId: string;
  /** Who replied. */
  actorName: string;
  /** Preview of the reply body. */
  preview: string;
}

export type NotificationPayload =
  | {
      type: 'friend_request';
      metadata: FriendRequestMetadata;
      entityType: 'user';
      entityId: string;
    }
  | {
      type: 'friend_accepted';
      metadata: FriendAcceptedMetadata;
      entityType: 'user';
      entityId: string;
    }
  | {
      type: 'achievement_unlocked';
      metadata: AchievementUnlockedNotifMetadata;
      entityType: 'achievement';
      entityId: string;
    }
  | {
      type: 'challenge_invite';
      metadata: ChallengeInviteMetadata;
      entityType: 'challenge';
      entityId: string;
    }
  | {
      type: 'challenge_joined';
      metadata: ChallengeJoinedNotifMetadata;
      entityType: 'challenge';
      entityId: string;
    }
  | {
      type: 'challenge_progress';
      metadata: ChallengeProgressMetadata;
      entityType: 'challenge';
      entityId: string;
    }
  | {
      type: 'challenge_activity_added';
      metadata: ChallengeActivityAddedMetadata;
      entityType: 'challenge';
      entityId: string;
    }
  | {
      type: 'challenge_cancelled';
      metadata: ChallengeCancelledMetadata;
      entityType: 'challenge';
      entityId: string;
    }
  | {
      type: 'challenge_completed';
      metadata: ChallengeCompletedMetadata;
      entityType: 'challenge';
      entityId: string;
    }
  | {
      type: 'club_invite';
      metadata: ClubInviteMetadata;
      entityType: 'club';
      entityId: string;
    }
  | {
      type: 'chat_message';
      metadata: ChatMessageMetadata;
      // entityId is the conversationId so the inbox row can deep-link straight
      // into the chat regardless of scope (challenge vs club vs dm).
      entityType: 'conversation';
      entityId: string;
    }
  | {
      type: 'chat_mention';
      metadata: ChatMentionMetadata;
      entityType: 'conversation';
      entityId: string;
    }
  | {
      type: 'chat_reaction';
      metadata: ChatReactionMetadata;
      // entityId is the messageId (the thing that was reacted to).
      entityType: 'message';
      entityId: string;
    }
  | {
      type: 'chat_reply';
      metadata: ChatReplyMetadata;
      // entityId is the parent messageId (the thing that was replied to).
      entityType: 'message';
      entityId: string;
    };
