import { z, registry } from '@shared/openapi/registry.js';
import { Challenge, commonErrors, successOf, successWithMessage } from '@shared/openapi/schemas.js';

const tags = ['Challenges'];
const auth = [{ bearerAuth: [] as string[] }];

const IdParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
});

const Targets = z.object({
  distance: z.number().positive().optional(),
  elevation: z.number().positive().optional(),
  activityType: z.string().optional(),
});

const CreateChallengeBody = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  type: z.enum(['collaborative', 'competitive']),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  targets: Targets,
  competitiveGoal: z.enum(['most', 'least', 'exact']).optional(),
  invitedUserIds: z.array(z.number().int()).optional(),
});

const UpdateChallengeBody = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  targets: Targets.optional(),
});

registry.registerPath({
  method: 'get',
  path: '/api/challenges/invitations',
  tags,
  summary: 'List pending challenge invitations for the current user',
  security: auth,
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: successOf(z.array(z.record(z.unknown()))) } },
    },
    ...commonErrors,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/challenges/events',
  tags,
  summary: 'Recent challenge events across the user’s challenges',
  security: auth,
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: successOf(z.array(z.record(z.unknown()))) } },
    },
    ...commonErrors,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/challenges/unseen-completed',
  tags,
  summary: 'Completed challenges whose summary the user hasn’t seen yet',
  security: auth,
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: successOf(z.array(Challenge)) } },
    },
    ...commonErrors,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/challenges',
  tags,
  summary: 'Create a challenge',
  security: auth,
  request: {
    body: { content: { 'application/json': { schema: CreateChallengeBody } } },
  },
  responses: {
    201: {
      description: 'Created',
      content: { 'application/json': { schema: successOf(Challenge) } },
    },
    ...commonErrors,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/challenges',
  tags,
  summary: 'List challenges the user is part of',
  security: auth,
  request: {
    query: z.object({
      status: z.enum(['active', 'pending', 'completed', 'cancelled']).optional(),
    }),
  },
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: successOf(z.array(Challenge)) } },
    },
    ...commonErrors,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/challenges/{id}',
  tags,
  summary: 'Get a challenge',
  security: auth,
  request: { params: IdParam },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: successOf(Challenge) } } },
    ...commonErrors,
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/challenges/{id}',
  tags,
  summary: 'Update a challenge (creator only)',
  security: auth,
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: UpdateChallengeBody } } },
  },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: successOf(Challenge) } } },
    ...commonErrors,
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/challenges/{id}',
  tags,
  summary: 'Delete a challenge (creator only)',
  security: auth,
  request: { params: IdParam },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: successWithMessage() } } },
    ...commonErrors,
  },
});

for (const [path, summary] of [
  ['/api/challenges/{id}/cancel', 'Cancel a challenge (creator only)'],
  ['/api/challenges/{id}/summary-seen', 'Mark the completion summary as seen'],
  ['/api/challenges/{id}/invite', 'Invite users to a challenge'],
  ['/api/challenges/{id}/accept', 'Accept a challenge invitation'],
  ['/api/challenges/{id}/decline', 'Decline a challenge invitation'],
  ['/api/challenges/{id}/leave', 'Leave a challenge'],
] as const) {
  registry.registerPath({
    method: 'post',
    path,
    tags,
    summary,
    security: auth,
    request: {
      params: IdParam,
      body: path.endsWith('/invite')
        ? {
            content: {
              'application/json': {
                schema: z.object({ userIds: z.array(z.number().int()).min(1) }),
              },
            },
          }
        : undefined,
    },
    responses: {
      200: { description: 'OK', content: { 'application/json': { schema: successWithMessage() } } },
      ...commonErrors,
    },
  });
}

registry.registerPath({
  method: 'get',
  path: '/api/challenges/{id}/progress',
  tags,
  summary: 'Per-participant progress',
  security: auth,
  request: { params: IdParam },
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: successOf(z.record(z.unknown())) } },
    },
    ...commonErrors,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/challenges/{id}/events',
  tags,
  summary: 'Event timeline for a challenge',
  security: auth,
  request: { params: IdParam },
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: successOf(z.array(z.record(z.unknown()))) } },
    },
    ...commonErrors,
  },
});
