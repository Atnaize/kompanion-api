import { z, registry } from '@shared/openapi/registry.js';
import { commonErrors, successOf, successWithMessage } from '@shared/openapi/schemas.js';

const tags = ['Admin: Quota'];
const auth = [{ bearerAuth: [] as string[] }];

const QuotaGrant = registry.register(
  'QuotaGrant',
  z.object({
    id: z.number().int(),
    reason: z.string(),
    callsGranted: z.number().int(),
    callsUsed: z.number().int(),
    expiresAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
  })
);

registry.registerPath({
  method: 'get',
  path: '/api/admin/quota/overview',
  tags,
  summary: '[Admin] Overall Strava API quota usage overview',
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
  path: '/api/admin/quota/users',
  tags,
  summary: '[Admin] Per-user quota usage',
  security: auth,
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
  path: '/api/admin/quota/backlog',
  tags,
  summary: '[Admin] Queued/backlogged sync jobs',
  security: auth,
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
  path: '/api/admin/quota/grants',
  tags,
  summary: '[Admin] List quota grants',
  security: auth,
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: successOf(z.array(QuotaGrant)) } },
    },
    ...commonErrors,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/admin/quota/grants',
  tags,
  summary: '[Admin] Create a quota grant',
  security: auth,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            reason: z.string().min(1).max(200),
            callsGranted: z.number().int().positive(),
            expiresAt: z.string().datetime().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Created',
      content: { 'application/json': { schema: successOf(QuotaGrant) } },
    },
    ...commonErrors,
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/admin/quota/grants/{id}',
  tags,
  summary: '[Admin] Revoke a quota grant',
  security: auth,
  request: {
    params: z.object({ id: z.string().openapi({ param: { name: 'id', in: 'path' } }) }),
  },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: successWithMessage() } } },
    ...commonErrors,
  },
});
