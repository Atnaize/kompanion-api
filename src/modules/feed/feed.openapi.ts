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
    ...commonErrors,
  },
});
