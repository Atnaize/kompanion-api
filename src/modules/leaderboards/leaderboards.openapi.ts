import { z, registry } from '@shared/openapi/registry.js';
import { commonErrors, successOf } from '@shared/openapi/schemas.js';
import { LEADERBOARD_PERIODS, METRIC_KEYS } from '../stats/metric-registry.js';

registry.registerPath({
  method: 'get',
  path: '/api/leaderboards/friends',
  tags: ['Leaderboards'],
  summary: 'Friends leaderboard ranked by metric over a period',
  security: [{ bearerAuth: [] as string[] }],
  request: {
    query: z.object({
      metric: z.enum(METRIC_KEYS as unknown as [string, ...string[]]),
      period: z.enum(LEADERBOARD_PERIODS as unknown as [string, ...string[]]).optional(),
      activityType: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: 'OK',
      content: {
        'application/json': {
          schema: successOf(
            z.object({
              metric: z.string(),
              period: z.string(),
              activityType: z.string().nullable(),
              rows: z.array(
                z.object({
                  rank: z.number().int(),
                  user: z.object({
                    id: z.number().int(),
                    firstname: z.string(),
                    lastname: z.string(),
                    profile: z.string(),
                    profileMedium: z.string(),
                  }),
                  value: z.number(),
                  latestActivityAt: z.string().nullable(),
                  isViewer: z.boolean(),
                })
              ),
            })
          ),
        },
      },
    },
    ...commonErrors,
  },
});
