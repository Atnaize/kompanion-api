import { z, registry } from './registry.js';

export const ErrorResponse = registry.register(
  'ErrorResponse',
  z.object({
    success: z.literal(false),
    error: z.string(),
    message: z.string().optional(),
  })
);

export function successOf<T extends z.ZodTypeAny>(data: T) {
  return z.object({
    success: z.literal(true),
    data,
  });
}

export function successWithMessage<T extends z.ZodTypeAny | undefined = undefined>(data?: T) {
  if (data) {
    return z.object({
      success: z.literal(true),
      message: z.string().optional(),
      data,
    });
  }
  return z.object({
    success: z.literal(true),
    message: z.string().optional(),
  });
}

export const UserPublic = registry.register(
  'UserPublic',
  z.object({
    userId: z.number().int(),
    stravaId: z.number().int(),
    username: z.string(),
    firstname: z.string().nullable(),
    lastname: z.string().nullable(),
    profile: z.string().nullable(),
    lastSyncedAt: z.string().datetime().optional(),
    isAdmin: z.boolean(),
  })
);

export const Activity = registry.register(
  'Activity',
  z.object({
    id: z.number().int(),
    stravaId: z.string(),
    userId: z.number().int(),
    name: z.string(),
    type: z.string(),
    sportType: z.string().nullable(),
    distance: z.number(),
    movingTime: z.number().int(),
    elapsedTime: z.number().int(),
    totalElevationGain: z.number(),
    startDate: z.string().datetime(),
    averageSpeed: z.number().nullable(),
    maxSpeed: z.number().nullable(),
  })
);

export const Challenge = registry.register(
  'Challenge',
  z.object({
    id: z.number().int(),
    name: z.string(),
    description: z.string().nullable(),
    type: z.enum(['collaborative', 'competitive']),
    status: z.string(),
    startDate: z.string().datetime(),
    endDate: z.string().datetime(),
    creatorId: z.number().int(),
    targets: z.record(z.unknown()),
    competitiveGoal: z.enum(['most', 'least', 'exact']).nullable().optional(),
  })
);

export const Achievement = registry.register(
  'Achievement',
  z.object({
    id: z.number().int(),
    code: z.string(),
    name: z.string(),
    description: z.string(),
    icon: z.string().nullable(),
    earnedAt: z.string().datetime().nullable(),
    redeemedAt: z.string().datetime().nullable(),
  })
);

export const Friendship = registry.register(
  'Friendship',
  z.object({
    userId: z.number().int(),
    username: z.string(),
    firstname: z.string().nullable(),
    lastname: z.string().nullable(),
    profile: z.string().nullable(),
    since: z.string().datetime(),
  })
);

export const PersonalRecord = registry.register(
  'PersonalRecord',
  z.object({
    id: z.number().int(),
    activityType: z.string(),
    distanceLabel: z.string(),
    timeSeconds: z.number().int(),
    achievedAt: z.string().datetime(),
    activityId: z.number().int().nullable(),
  })
);

export const FeedItem = registry.register(
  'FeedItem',
  z.object({
    type: z.string(),
    createdAt: z.string().datetime(),
    actor: UserPublic.partial().optional(),
    payload: z.record(z.unknown()),
  })
);

export const ErrorContent = {
  'application/json': { schema: ErrorResponse },
};

export const commonErrors = {
  400: { description: 'Bad request', content: ErrorContent },
  401: { description: 'Not authenticated', content: ErrorContent },
  404: { description: 'Not found', content: ErrorContent },
  500: { description: 'Internal server error', content: ErrorContent },
};
