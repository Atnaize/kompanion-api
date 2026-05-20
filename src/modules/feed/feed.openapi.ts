import { z, registry } from '@shared/openapi/registry.js';
import { commonErrors, FeedItem, successOf } from '@shared/openapi/schemas.js';

registry.registerPath({
  method: 'get',
  path: '/api/feed',
  tags: ['Feed'],
  summary: 'Social activity feed for the authenticated user',
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
      since: z
        .string()
        .datetime()
        .optional()
        .describe('Only return events newer than this ISO 8601 timestamp (incremental polling).'),
    }),
    headers: z.object({
      'if-none-match': z
        .string()
        .optional()
        .describe(
          'Conditional GET. Send the ETag from a previous response to get 304 when nothing has changed.'
        ),
    }),
  },
  responses: {
    200: {
      description: 'OK',
      content: {
        'application/json': {
          schema: successOf(
            z.object({
              items: z.array(FeedItem),
              nextCursor: z.string().nullable(),
            })
          ),
        },
      },
    },
    304: {
      description:
        'Not Modified — ETag matched If-None-Match. Only emitted on top-of-feed requests (no cursor).',
    },
    ...commonErrors,
  },
});
