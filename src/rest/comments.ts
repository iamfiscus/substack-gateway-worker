// Read routes of gateway_comments_rest/router.py (upstream bc2e875).
// create/reply/delete/like/unlike arrive in Task 10.

import { createRoute, z } from '@hono/zod-openapi';
import {
  CommentsResponse,
  PostCommentRepliesResponse,
  PostCommentResponse,
} from '../schemas/comments';
import { getPostComment, getPostComments, listPostCommentReplies } from '../services/comments';
import { restRoute } from './credentials';
import { createRouter } from './errors';

const tokenHeader = z.object({ 'x-gateway-token': z.string().optional() });
const commentIdParam = z.object({ comment_id: z.coerce.number().int().gt(0) });
const ok = (schema: z.ZodType) => ({
  description: 'Successful Response',
  content: { 'application/json': { schema } },
});

const getRoute = createRoute({
  method: 'get',
  path: '/comments/{comment_id}',
  tags: ['comments'],
  summary: 'Get Comment',
  description: 'Return a single Substack comment by its ID (rich comment shape).',
  request: { headers: tokenHeader, params: commentIdParam },
  responses: { 200: ok(PostCommentResponse) },
});

const repliesRoute = createRoute({
  method: 'get',
  path: '/comments/{comment_id}/comments',
  tags: ['comments'],
  summary: 'List Comment Replies',
  request: { headers: tokenHeader, params: commentIdParam },
  responses: { 200: ok(PostCommentRepliesResponse) },
});

const postCommentsRoute = createRoute({
  method: 'get',
  path: '/posts/{post_id}/comments',
  tags: ['comments'],
  summary: 'Get Post Comments',
  description: 'Return comments for the given post.',
  request: { headers: tokenHeader, params: z.object({ post_id: z.coerce.number().int().gt(0) }) },
  responses: { 200: ok(CommentsResponse) },
});

export const commentsRouter = createRouter()
  .openapi(
    getRoute,
    restRoute<typeof getRoute>('api:comments:get', async (c, { creds, ctx }) =>
      c.json(await getPostComment(ctx, creds, { commentId: c.req.valid('param').comment_id }), 200),
    ),
  )
  .openapi(
    repliesRoute,
    restRoute<typeof repliesRoute>('api:comments:replies:list', async (c, { creds, ctx }) =>
      c.json(
        await listPostCommentReplies(ctx, creds, { commentId: c.req.valid('param').comment_id }),
        200,
      ),
    ),
  )
  .openapi(
    postCommentsRoute,
    restRoute<typeof postCommentsRoute>('api:posts:comments:list', async (c, { creds, ctx }) =>
      c.json(await getPostComments(ctx, creds, { postId: c.req.valid('param').post_id }), 200),
    ),
  );
