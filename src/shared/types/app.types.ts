/**
 * Application-specific types
 */

export interface User {
  id: number;
  stravaId: number;
  username: string;
  firstname: string;
  lastname: string;
  profile: string;
  profileMedium: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: number;
  lastSyncedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserSession {
  userId: number;
  stravaId: number;
  username: string;
  firstname: string;
  lastname: string;
  profile: string;
  lastSyncedAt?: string;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  requirement: {
    type: 'distance' | 'elevation' | 'activities' | 'speed' | 'streak';
    value: number;
    activityType?: string;
  };
  unlockedAt?: string;
  isSecret?: boolean;
}

export interface Quest {
  id: string;
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  type: 'weekly' | 'monthly' | 'special';
  objectives: QuestObjective[];
  rewards: {
    xp: number;
    achievements?: string[];
  };
  status: 'active' | 'completed' | 'expired';
}

export interface QuestObjective {
  id: string;
  description: string;
  type: 'distance' | 'elevation' | 'activities' | 'time';
  target: number;
  current: number;
  activityType?: string;
  completed: boolean;
}

export interface UserStats {
  userId: number;
  totalDistance: number;
  totalElevation: number;
  totalActivities: number;
  totalTime: number;
  currentStreak: number;
  longestStreak: number;
  level: number;
  xp: number;
  byActivityType: {
    [key: string]: {
      count: number;
      distance: number;
      elevation: number;
      time: number;
    };
  };
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export enum HttpStatus {
  OK = 200,
  CREATED = 201,
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  INTERNAL_SERVER_ERROR = 500,
}
