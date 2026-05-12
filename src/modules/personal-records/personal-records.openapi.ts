import { z, registry } from '@shared/openapi/registry.js';
import { commonErrors, PersonalRecord, successOf } from '@shared/openapi/schemas.js';

const tags = ['Personal Records'];
const auth = [{ bearerAuth: [] as string[] }];

registry.registerPath({
  method: 'get',
  path: '/api/personal-records',
  tags,
  summary: 'List the user’s personal records',
  security: auth,
  request: { query: z.object({ activityType: z.string().optional() }) },
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: successOf(z.array(PersonalRecord)) } },
    },
    ...commonErrors,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/personal-records/status',
  tags,
  summary: 'Status of background PR processing for the user',
  security: auth,
  responses: {
    200: {
      description: 'OK',
      content: {
        'application/json': {
          schema: successOf(
            z.object({
              processed: z.number().int(),
              total: z.number().int(),
              isRunning: z.boolean(),
              lastRunAt: z.string().datetime().nullable(),
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
  path: '/api/personal-records/process/stream',
  tags,
  summary: 'Process PRs with SSE progress',
  description: 'Server-Sent Events stream emitting per-activity progress events.',
  security: auth,
  responses: {
    200: {
      description: 'text/event-stream',
      content: { 'text/event-stream': { schema: z.string() } },
    },
    ...commonErrors,
  },
});
