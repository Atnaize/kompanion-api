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
  | 'challenge_joined'; // someone accepted my challenge invitation

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
    };
