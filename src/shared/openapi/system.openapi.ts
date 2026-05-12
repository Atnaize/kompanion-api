import { z, registry } from './registry.js';

registry.registerPath({
  method: 'get',
  path: '/health',
  tags: ['System'],
  summary: 'Liveness probe',
  responses: {
    200: {
      description: 'OK',
      content: {
        'application/json': {
          schema: z.object({
            status: z.literal('ok'),
            timestamp: z.string().datetime(),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/debug/config',
  tags: ['System'],
  summary: 'Non-sensitive runtime config',
  responses: {
    200: {
      description: 'OK',
      content: {
        'application/json': {
          schema: z.object({
            nodeEnv: z.string(),
            allowedOrigins: z.array(z.string()),
            isVercel: z.boolean(),
            vercelEnv: z.string(),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/openapi.json',
  tags: ['System'],
  summary: 'Machine-readable OpenAPI 3.1 spec',
  responses: {
    200: {
      description: 'OpenAPI document',
      content: { 'application/json': { schema: z.record(z.unknown()) } },
    },
  },
});
