// Challenge types and interfaces

export type ChallengeType = 'collaborative' | 'competitive';
export type ChallengeStatus = 'draft' | 'active' | 'completed' | 'failed' | 'cancelled';
export type ParticipantStatus = 'invited' | 'accepted' | 'declined' | 'left';
export type CompetitiveGoal = 'most' | 'least' | 'exact';
export type ChallengeEventType =
  | 'created'
  | 'started'
  | 'activity_added'
  | 'milestone_reached'
  | 'lead_change'
  | 'completed'
  | 'failed'
  | 'cancelled';

// Challenge target metrics
export interface ChallengeTargets {
  distance?: number; // meters
  elevation?: number; // meters
  activityType?: string; // Run, Ride, etc.
}

// Challenge with all relations
export interface Challenge {
  id: string;
  creatorId: number;
  name: string;
  description: string | null;
  type: ChallengeType;
  status: ChallengeStatus;
  startDate: Date;
  endDate: Date;
  targets: ChallengeTargets;
  competitiveGoal: CompetitiveGoal | null;
  createdAt: Date;
  updatedAt: Date;

  // Relations (optional for queries)
  creator?: {
    id: number;
    firstname: string;
    lastname: string;
    profile: string;
  };
  participants?: ChallengeParticipant[];
  activities?: ChallengeActivity[];
  events?: ChallengeEvent[];
}

export interface ChallengeParticipant {
  id: number;
  challengeId: string;
  userId: number;
  status: ParticipantStatus;
  invitedAt: Date;
  acceptedAt: Date | null;
  totalDistance: number;
  totalElevation: number;
  activityCount: number;
  lastActivityAt: Date | null;

  // Relations
  user?: {
    id: number;
    firstname: string;
    lastname: string;
    profile: string;
  };
}

export interface ChallengeActivity {
  id: string;
  challengeId: string;
  userId: number;
  activityId: bigint;
  distance: number;
  elevation: number;
  movingTime: number;
  activityType: string;
  recordedAt: Date;
  createdAt: Date;
}

export interface ChallengeEvent {
  id: string;
  challengeId: string;
  userId: number | null;
  type: ChallengeEventType;
  data: Record<string, unknown>;
  createdAt: Date;
}

// DTOs for API requests/responses
export interface CreateChallengeDto {
  name: string;
  description?: string;
  type: ChallengeType;
  startDate: Date;
  endDate: Date;
  targets: ChallengeTargets;
  competitiveGoal?: CompetitiveGoal;
  participantIds: number[]; // Users to invite
}

export interface UpdateChallengeDto {
  name?: string;
  description?: string;
  startDate?: Date;
  endDate?: Date;
}

export interface ChallengeProgressDto {
  challengeId: string;
  participants: {
    userId: number;
    user: {
      firstname: string;
      lastname: string;
      profile: string;
    };
    totalDistance: number;
    totalElevation: number;
    activityCount: number;
    lastActivityAt: Date | null;
    ranking?: number; // For competitive challenges
  }[];
  totalProgress?: {
    // For collaborative challenges
    distance: number;
    elevation: number;
    distancePercent: number;
    elevationPercent: number;
  };
}
