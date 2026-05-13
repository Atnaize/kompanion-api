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
  | 'challenge_completed'; // a challenge I'm in ended (succeeded or failed)

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
    };
