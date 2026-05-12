/**
 * Polymorphic feed event types (M2 abstraction A1).
 *
 * Adding a new event type:
 *   1. Add a string value here.
 *   2. Emit via `feedEventEmitter.record(...)` from the producing code path.
 *   3. Register a renderer on the frontend (`feedRenderers` registry).
 *
 * No schema change required.
 */
export type FeedEventType =
  | 'activity_posted'
  | 'photo_added'
  | 'pr_set'
  | 'achievement_unlocked'
  | 'challenge_joined';

export interface ActivityPostedMetadata {
  name: string;
  type: string; // Run | Ride | Walk | Hike | Swim | …
  distance: number; // meters
  movingTime: number; // seconds
  totalElevationGain: number; // meters
  averageSpeed: number; // m/s
}

export interface PhotoAddedMetadata {
  count: number;
}

export interface PrSetMetadata {
  band: string;
  timeSeconds: number;
}

export interface AchievementUnlockedMetadata {
  name: string;
  rarity: string;
}

export interface ChallengeJoinedMetadata {
  name: string;
}

/**
 * Discriminated union — frontend can narrow on `type` to get a typed metadata.
 */
export type FeedEventPayload =
  | {
      type: 'activity_posted';
      metadata: ActivityPostedMetadata;
      entityType: 'activity';
      entityId: string;
    }
  | { type: 'photo_added'; metadata: PhotoAddedMetadata; entityType: 'activity'; entityId: string }
  | { type: 'pr_set'; metadata: PrSetMetadata; entityType: 'personal_record'; entityId: string }
  | {
      type: 'achievement_unlocked';
      metadata: AchievementUnlockedMetadata;
      entityType: 'achievement';
      entityId: string;
    }
  | {
      type: 'challenge_joined';
      metadata: ChallengeJoinedMetadata;
      entityType: 'challenge';
      entityId: string;
    };
