import { z, registry } from '@shared/openapi/registry.js';
import { commonErrors, successOf, Activity } from '@shared/openapi/schemas.js';

const tags = ['Activities'];
const auth = [{ bearerAuth: [] as string[] }];

const IdParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: '12345' }),
});

registry.registerPath({
  method: 'get',
  path: '/api/activities',
  tags,
  summary: 'List activities for the authenticated user',
  security: auth,
  request: {
    query: z.object({
      page: z.coerce.number().int().min(1).optional(),
      perPage: z.coerce.number().int().min(1).max(200).optional(),
      type: z.string().optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
    }),
  },
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: successOf(z.array(Activity)) } },
    },
    ...commonErrors,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/activities/sync',
  tags,
  summary: 'Sync recent activities from Strava (batch)',
  security: auth,
  responses: {
    200: {
      description: 'OK',
      content: {
        'application/json': {
          schema: successOf(
            z.object({
              imported: z.number().int(),
              updated: z.number().int(),
              skipped: z.number().int(),
            })
          ),
        },
      },
    },
    ...commonErrors,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/activities/sync/stream',
  tags,
  summary: 'Sync activities from Strava with SSE progress',
  description: 'Server-Sent Events stream emitting `progress`, `activity`, `done`, `error` events.',
  security: auth,
  responses: {
    200: {
      description: 'text/event-stream',
      content: { 'text/event-stream': { schema: z.string() } },
    },
    ...commonErrors,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/activities/test/delete',
  tags,
  summary: 'Test helper — delete activities for the current user',
  description: 'Used by e2e/test seeds. Should not be relied on by clients.',
  security: auth,
  responses: {
    200: { description: 'OK' },
    ...commonErrors,
  },
});

for (const [path, summary] of [
  ['/api/activities/{id}', 'Get one activity by id'],
  ['/api/activities/{id}/streams', 'Get Strava streams (latlng, time, heartrate, …)'],
  ['/api/activities/{id}/laps', 'Get activity laps'],
  ['/api/activities/{id}/kudoers', 'Get athletes who kudoed the activity'],
  ['/api/activities/{id}/comments', 'Get activity comments'],
  ['/api/activities/{id}/photos', 'Get activity photos'],
] as const) {
  registry.registerPath({
    method: 'get',
    path,
    tags,
    summary,
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
}
