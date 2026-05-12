import { z, registry } from '@shared/openapi/registry.js';
import { commonErrors, successOf, UserPublic } from '@shared/openapi/schemas.js';

registry.registerPath({
  method: 'get',
  path: '/api/users/{id}/profile',
  tags: ['Users'],
  summary: 'Public profile for a user',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
    }),
  },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: successOf(UserPublic) } } },
    ...commonErrors,
  },
});
