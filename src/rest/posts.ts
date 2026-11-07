// Routes of gateway_posts_rest/router.py (upstream bc2e875).

import { createRoute, z } from '@hono/zod-openapi';
import { FullPostResponse } from '../schemas/posts';
import { getPost, likePost, restackPost, unlikePost } from '../services/posts';
import { restRoute } from './credentials';
import { createRouter } from './errors';

const request = {
  headers: z.object({ 'x-gateway-token': z.string().optional() }),
  params: z.object({ post_id: z.coerce.number().int().gt(0) }),
};
const noContent = { 204: { description: 'Successful Response' } } as const;

const route = createRoute({
  method: 'get',
  path: '/posts/{post_id}',
  tags: ['posts'],
  summary: 'Get Post',
  description: 'Return a single Substack post with its full content.',
  request,
  responses: {
    200: {
      description: 'Successful Response',
      content: { 'application/json': { schema: FullPostResponse } },
    },
  },
});

const likeRoute = createRoute({
  method: 'put',
  path: '/posts/{post_id}/like',
  tags: ['posts'],
  summary: 'Like Post',
  description: 'Add a like to a Substack post.',
  request,
  responses: noContent,
});

const unlikeRoute = createRoute({
  method: 'delete',
  path: '/posts/{post_id}/like',
  tags: ['posts'],
  summary: 'Unlike Post',
  description: 'Remove a like from a Substack post.',
  request,
  responses: noContent,
});

const restackRoute = createRoute({
  method: 'post',
  path: '/posts/{post_id}/restack',
  tags: ['posts'],
  summary: 'Restack Post',
  description: 'Restack a Substack post.',
  request,
  responses: noContent,
});

export const postsRouter = createRouter()
  .openapi(
    route,
    restRoute<typeof route>('api:posts:get', async (c, { creds, ctx }) =>
      c.json(await getPost(ctx, creds, { postId: c.req.valid('param').post_id }), 200),
    ),
  )
  .openapi(
    likeRoute,
    restRoute<typeof likeRoute>('api:posts:like', async (c, { creds, ctx }) => {
      await likePost(ctx, creds, { postId: c.req.valid('param').post_id });
      return c.body(null, 204);
    }),
  )
  .openapi(
    unlikeRoute,
    restRoute<typeof unlikeRoute>('api:posts:unlike', async (c, { creds, ctx }) => {
      await unlikePost(ctx, creds, { postId: c.req.valid('param').post_id });
      return c.body(null, 204);
    }),
  )
  .openapi(
    restackRoute,
    restRoute<typeof restackRoute>('api:posts:restack', async (c, { creds, ctx }) => {
      await restackPost(ctx, creds, { postId: c.req.valid('param').post_id });
      return c.body(null, 204);
    }),
  );
