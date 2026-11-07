// Port of the read route of gateway_posts_rest/router.py (upstream bc2e875).
// like/unlike/restack arrive in Task 10.

import { createRoute, z } from '@hono/zod-openapi';
import { FullPostResponse } from '../schemas/posts';
import { getPost } from '../services/posts';
import { restRoute } from './credentials';
import { createRouter } from './errors';

const route = createRoute({
  method: 'get',
  path: '/posts/{post_id}',
  tags: ['posts'],
  summary: 'Get Post',
  description: 'Return a single Substack post with its full content.',
  request: {
    headers: z.object({ 'x-gateway-token': z.string().optional() }),
    params: z.object({ post_id: z.coerce.number().int().gt(0) }),
  },
  responses: {
    200: {
      description: 'Successful Response',
      content: { 'application/json': { schema: FullPostResponse } },
    },
  },
});

export const postsRouter = createRouter().openapi(
  route,
  restRoute<typeof route>('api:posts:get', async (c, { creds, ctx }) =>
    c.json(await getPost(ctx, creds, { postId: c.req.valid('param').post_id }), 200),
  ),
);
