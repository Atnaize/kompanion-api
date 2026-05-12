import { z, registry } from '@shared/openapi/registry.js';
import {
  commonErrors,
  Friendship,
  successOf,
  successWithMessage,
  UserPublic,
} from '@shared/openapi/schemas.js';

const tags = ['Friends'];
const auth = [{ bearerAuth: [] as string[] }];

const UserIdParam = z.object({
  userId: z.string().openapi({ param: { name: 'userId', in: 'path' } }),
});

registry.registerPath({
  method: 'get',
  path: '/api/friends/search',
  tags,
  summary: 'Search users by name/username',
  security: auth,
  request: {
    query: z.object({
      q: z.string().min(1),
      limit: z.coerce.number().int().min(1).max(50).optional(),
    }),
  },
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: successOf(z.array(UserPublic.partial())) } },
    },
    ...commonErrors,
  },
});

for (const [path, summary] of [
  ['/api/friends/requests/incoming', 'List incoming friend requests'],
  ['/api/friends/requests/outgoing', 'List outgoing friend requests'],
] as const) {
  registry.registerPath({
    method: 'get',
    path,
    tags,
    summary,
    security: auth,
    responses: {
      200: {
        description: 'OK',
        content: { 'application/json': { schema: successOf(z.array(UserPublic.partial())) } },
      },
      ...commonErrors,
    },
  });
}

registry.registerPath({
  method: 'post',
  path: '/api/friends/requests/{userId}/accept',
  tags,
  summary: 'Accept a friend request',
  security: auth,
  request: { params: UserIdParam },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: successWithMessage() } } },
    ...commonErrors,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/friends/requests/{userId}',
  tags,
  summary: 'Send a friend request',
  security: auth,
  request: { params: UserIdParam },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: successWithMessage() } } },
    ...commonErrors,
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/friends/requests/{userId}',
  tags,
  summary: 'Cancel an outgoing request or decline an incoming one',
  security: auth,
  request: { params: UserIdParam },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: successWithMessage() } } },
    ...commonErrors,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/friends',
  tags,
  summary: 'List the user’s friends',
  security: auth,
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: successOf(z.array(Friendship)) } },
    },
    ...commonErrors,
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/friends/{userId}',
  tags,
  summary: 'Unfriend a user',
  security: auth,
  request: { params: UserIdParam },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: successWithMessage() } } },
    ...commonErrors,
  },
});
