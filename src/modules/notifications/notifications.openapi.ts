import { z, registry } from '@shared/openapi/registry.js';
import { commonErrors, successOf, successWithMessage } from '@shared/openapi/schemas.js';

const tags = ['Notifications'];
const auth = [{ bearerAuth: [] as string[] }];

const PushSubscription = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string(),
  }),
  expirationTime: z.number().int().nullable().optional(),
});

const Preferences = z.object({
  achievementEarned: z.boolean().optional(),
  challengeInvite: z.boolean().optional(),
  challengeCompleted: z.boolean().optional(),
  friendRequest: z.boolean().optional(),
  newPersonalRecord: z.boolean().optional(),
});

registry.registerPath({
  method: 'post',
  path: '/api/notifications/subscribe',
  tags,
  summary: 'Register a web push subscription',
  security: auth,
  request: { body: { content: { 'application/json': { schema: PushSubscription } } } },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: successWithMessage() } } },
    ...commonErrors,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/notifications/unsubscribe',
  tags,
  summary: 'Remove a web push subscription',
  security: auth,
  request: {
    body: {
      content: { 'application/json': { schema: z.object({ endpoint: z.string().url() }) } },
    },
  },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: successWithMessage() } } },
    ...commonErrors,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/notifications/preferences',
  tags,
  summary: 'Get notification preferences',
  security: auth,
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: successOf(Preferences) } } },
    ...commonErrors,
  },
});

registry.registerPath({
  method: 'put',
  path: '/api/notifications/preferences',
  tags,
  summary: 'Update notification preferences',
  security: auth,
  request: { body: { content: { 'application/json': { schema: Preferences } } } },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: successOf(Preferences) } } },
    ...commonErrors,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/notifications/vapid-public-key',
  tags,
  summary: 'Public VAPID key for web push',
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: successOf(z.object({ publicKey: z.string() })) } },
    },
    ...commonErrors,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/notifications/test',
  tags,
  summary: 'Send a test push notification to the current user',
  security: auth,
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: successWithMessage() } } },
    ...commonErrors,
  },
});
