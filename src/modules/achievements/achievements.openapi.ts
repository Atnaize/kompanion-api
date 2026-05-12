import { z, registry } from '@shared/openapi/registry.js';
import {
  Achievement,
  commonErrors,
  successOf,
  successWithMessage,
} from '@shared/openapi/schemas.js';

const tags = ['Achievements'];
const auth = [{ bearerAuth: [] as string[] }];

registry.registerPath({
  method: 'get',
  path: '/api/achievements',
  tags,
  summary: 'List achievements (earned + locked)',
  security: auth,
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: successOf(z.array(Achievement)) } },
    },
    ...commonErrors,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/achievements/{achievementId}/redeem',
  tags,
  summary: 'Redeem an earned achievement',
  security: auth,
  request: {
    params: z.object({
      achievementId: z.string().openapi({ param: { name: 'achievementId', in: 'path' } }),
    }),
  },
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: successWithMessage(Achievement) } },
    },
    ...commonErrors,
  },
});
