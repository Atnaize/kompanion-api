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
  isAdmin: boolean;
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
  isAdmin: boolean;
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
  progress?: {
    currentValue: number;
    targetValue: number;
    percentage: number;
  };
}

export interface UserStats {
  userId: number;
  totalDistance: number;
  totalElevation: number;
  totalActivities: number;
  totalTime: number;
  currentStreak: number;
  longestStreak: number;
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
  TOO_MANY_REQUESTS = 429,
  INTERNAL_SERVER_ERROR = 500,
}
