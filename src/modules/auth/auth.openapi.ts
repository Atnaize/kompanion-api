import { z, registry } from '@shared/openapi/registry.js';
import {
  commonErrors,
  successOf,
  successWithMessage,
  UserPublic,
} from '@shared/openapi/schemas.js';

const tags = ['Auth'];
const auth = [{ bearerAuth: [] as string[] }];

registry.registerPath({
  method: 'get',
  path: '/api/auth/login',
  tags,
  summary: 'Start Strava OAuth flow',
  description: 'Returns the Strava authorization URL the client should redirect to.',
  request: {
    query: z.object({
      redirect_uri: z
        .string()
        .url()
        .optional()
        .openapi({ description: 'Must be in the configured allowed origins list.' }),
    }),
  },
  responses: {
    200: {
      description: 'OK',
      content: {
        'application/json': {
          schema: successOf(z.object({ authUrl: z.string().url() })),
        },
      },
    },
    ...commonErrors,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/auth/callback',
  tags,
  summary: 'Strava OAuth callback',
  description:
    'Exchanges the OAuth `code` for tokens, then **302 redirects** to the originating frontend with `accessToken` and `refreshToken` query params.',
  request: {
    query: z.object({
      code: z.string(),
      state: z.string().url().optional(),
    }),
  },
  responses: {
    302: { description: 'Redirect to frontend with tokens' },
    ...commonErrors,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/auth/me',
  tags,
  summary: 'Current authenticated user',
  security: auth,
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: successOf(UserPublic) } } },
    ...commonErrors,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/auth/debug',
  tags,
  summary: 'Strava token diagnostic info',
  security: auth,
  responses: {
    200: {
      description: 'OK',
      content: {
        'application/json': {
          schema: successOf(
            z.object({
              userId: z.number().int(),
              stravaId: z.number().int(),
              tokenExpiresAt: z.number().int(),
              tokenExpiresAtDate: z.string().datetime(),
              currentTime: z.number().int(),
              currentTimeDate: z.string().datetime(),
              expiresIn: z.number().int(),
              expiresInMinutes: z.number().int(),
              isExpired: z.boolean(),
              isExpiringSoon: z.boolean(),
            })
          ),
        },
      },
    },
    ...commonErrors,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/auth/refresh',
  tags,
  summary: 'Rotate refresh token, mint new access token',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({ refreshToken: z.string() }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'OK',
      content: {
        'application/json': {
          schema: successOf(
            z.object({
              accessToken: z.string(),
              refreshToken: z.string(),
            })
          ),
        },
      },
    },
    ...commonErrors,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/auth/refresh-strava',
  tags,
  summary: 'Force-refresh the upstream Strava access token',
  security: auth,
  responses: {
    200: {
      description: 'OK',
      content: {
        'application/json': {
          schema: successWithMessage(
            z.object({
              expiresAt: z.number().int(),
              expiresAtDate: z.string().datetime(),
            })
          ),
        },
      },
    },
    ...commonErrors,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/auth/logout',
  tags,
  summary: 'Revoke refresh token (if provided)',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({ refreshToken: z.string().optional() }),
        },
      },
    },
  },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: successWithMessage() } } },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/auth/account',
  tags,
  summary: 'Delete the authenticated user account',
  security: auth,
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: successWithMessage() } } },
    ...commonErrors,
  },
});
