// Port of gateway_following_rest/router.py (upstream bc2e875).

import { createRoute, z } from '@hono/zod-openapi';
import { FollowingResponse } from '../schemas/following';
import { getMyFollowing } from '../services/following';
import { restRoute } from './credentials';
import { createRouter } from './errors';

const route = createRoute({
  method: 'get',
  path: '/me/following',
  tags: ['following'],
  summary: 'Get Me Following',
  description: 'Return the list of users the authenticated user follows.',
  request: { headers: z.object({ 'x-gateway-token': z.string().optional() }) },
  responses: {
    200: {
      description: 'Successful Response',
      content: { 'application/json': { schema: FollowingResponse } },
    },
  },
});

export const followingRouter = createRouter().openapi(
  route,
  restRoute<typeof route>('api:me:following:list', async (c, { creds, ctx }) =>
    c.json(await getMyFollowing(ctx, creds), 200),
  ),
);
