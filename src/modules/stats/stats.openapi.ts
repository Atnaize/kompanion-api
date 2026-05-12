import { z, registry } from '@shared/openapi/registry.js';
import { commonErrors, successOf } from '@shared/openapi/schemas.js';

const tags = ['Stats'];
const auth = [{ bearerAuth: [] as string[] }];

const PeriodQuery = z.object({
  period: z.enum(['week', 'month', 'quarter', 'year', 'all']).optional(),
  activityType: z.string().optional(),
});

registry.registerPath({
  method: 'get',
  path: '/api/stats',
  tags,
  summary: 'Aggregated stats for the authenticated user',
  security: auth,
  request: { query: PeriodQuery },
  responses: {
    200: {
      description: 'OK',
      content: {
        'application/json': {
          schema: successOf(
            z.object({
              totalDistance: z.number(),
              totalElevation: z.number(),
              totalTime: z.number().int(),
              activityCount: z.number().int(),
              averageSpeed: z.number(),
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
  path: '/api/stats/progress',
  tags,
  summary: 'Progress data series (for chart)',
  security: auth,
  request: { query: PeriodQuery.extend({ bucket: z.enum(['day', 'week', 'month']).optional() }) },
  responses: {
    200: {
      description: 'OK',
      content: {
        'application/json': {
          schema: successOf(
            z.array(
              z.object({
                bucket: z.string(),
                distance: z.number(),
                elevation: z.number(),
                time: z.number().int(),
                count: z.number().int(),
              })
            )
          ),
        },
      },
    },
    ...commonErrors,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/stats/compare',
  tags,
  summary: 'Compare two adjacent periods',
  security: auth,
  request: { query: PeriodQuery },
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
  path: '/api/stats/compare-custom',
  tags,
  summary: 'Compare two arbitrary date ranges',
  security: auth,
  request: {
    query: z.object({
      aStart: z.string().datetime(),
      aEnd: z.string().datetime(),
      bStart: z.string().datetime(),
      bEnd: z.string().datetime(),
      activityType: z.string().optional(),
    }),
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
  method: 'get',
  path: '/api/stats/heatmap',
  tags,
  summary: 'Per-day activity heatmap data',
  security: auth,
  request: {
    query: z.object({
      year: z.coerce.number().int().optional(),
      activityType: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: 'OK',
      content: {
        'application/json': {
          schema: successOf(
            z.array(
              z.object({
                date: z.string(),
                count: z.number().int(),
                distance: z.number(),
              })
            )
          ),
        },
      },
    },
    ...commonErrors,
  },
});
