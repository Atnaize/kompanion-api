import { z, registry } from '@shared/openapi/registry.js';
import { commonErrors, successOf, successWithMessage } from '@shared/openapi/schemas.js';

const auth = [{ bearerAuth: [] as string[] }];

registry.registerPath({
  method: 'get',
  path: '/api/webhooks/strava',
  tags: ['Webhooks'],
  summary: 'Strava webhook subscription handshake',
  description:
    'Strava calls this with `hub.challenge` when creating a subscription. Public — no auth.',
  request: {
    query: z.object({
      'hub.mode': z.string().optional(),
      'hub.challenge': z.string(),
      'hub.verify_token': z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: 'Echoes hub.challenge',
      content: {
        'application/json': {
          schema: z.object({ 'hub.challenge': z.string() }),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/webhooks/strava',
  tags: ['Webhooks'],
  summary: 'Strava webhook event receiver',
  description:
    'Strava POSTs activity / athlete events here. Public — no auth, validated by `hub.verify_token`.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            object_type: z.enum(['activity', 'athlete']),
            object_id: z.number().int(),
            aspect_type: z.enum(['create', 'update', 'delete']),
            owner_id: z.number().int(),
            subscription_id: z.number().int(),
            event_time: z.number().int(),
            updates: z.record(z.string()).optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: { description: 'OK' },
  },
});

const adminTag = ['Webhooks'];

registry.registerPath({
  method: 'get',
  path: '/api/admin/webhooks/diagnostics',
  tags: adminTag,
  summary: '[Admin] Webhook subsystem diagnostics',
  security: auth,
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
  path: '/api/admin/webhooks/status',
  tags: adminTag,
  summary: '[Admin] Current Strava webhook subscription status',
  security: auth,
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: successOf(z.record(z.unknown())) } },
    },
    ...commonErrors,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/admin/webhooks/subscribe',
  tags: adminTag,
  summary: '[Admin] Create the Strava webhook subscription',
  security: auth,
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: successWithMessage() } } },
    ...commonErrors,
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/admin/webhooks/subscribe/{stravaId}',
  tags: adminTag,
  summary: '[Admin] Delete a webhook subscription',
  security: auth,
  request: {
    params: z.object({
      stravaId: z.string().openapi({ param: { name: 'stravaId', in: 'path' } }),
    }),
  },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: successWithMessage() } } },
    ...commonErrors,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/admin/webhooks/events',
  tags: adminTag,
  summary: '[Admin] List recent webhook events',
  security: auth,
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(500).optional(),
      status: z.enum(['pending', 'processed', 'failed']).optional(),
    }),
  },
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
  path: '/api/admin/webhooks/events/{id}',
  tags: adminTag,
  summary: '[Admin] Get a webhook event',
  security: auth,
  request: {
    params: z.object({ id: z.string().openapi({ param: { name: 'id', in: 'path' } }) }),
  },
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: successOf(z.record(z.unknown())) } },
    },
    ...commonErrors,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/admin/webhooks/events/{id}/retry',
  tags: adminTag,
  summary: '[Admin] Retry a failed webhook event',
  security: auth,
  request: {
    params: z.object({ id: z.string().openapi({ param: { name: 'id', in: 'path' } }) }),
  },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: successWithMessage() } } },
    ...commonErrors,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/admin/webhooks/simulate',
  tags: adminTag,
  summary: '[Admin] Simulate a Strava webhook event (dev/test)',
  security: auth,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            objectType: z.enum(['activity', 'athlete']),
            objectId: z.number().int(),
            aspectType: z.enum(['create', 'update', 'delete']),
            ownerId: z.number().int(),
          }),
        },
      },
    },
  },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: successWithMessage() } } },
    ...commonErrors,
  },
});
