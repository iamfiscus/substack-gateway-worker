// Routes of gateway_comments_rest/router.py (upstream bc2e875).

import { createRoute, z } from '@hono/zod-openapi';
import {
  CommentsResponse,
  CreateCommentRequest,
  PostCommentRepliesResponse,
  PostCommentResponse,
} from '../schemas/comments';
import {
  createPostComment,
  deletePostComment,
  getPostComment,
  getPostComments,
  likePostComment,
  listPostCommentReplies,
  replyToPostComment,
  unlikePostComment,
} from '../services/comments';
import { restRoute } from './credentials';
import { createRouter } from './errors';
import { noContent, ok, tokenHeader } from './openapi';

const commentIdParam = z.object({ comment_id: z.coerce.number().int().gt(0) });

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

const commentBody = {
  required: true,
  content: { 'application/json': { schema: CreateCommentRequest } },
} as const;
const postIdParam = z.object({ post_id: z.coerce.number().int().gt(0) });

const createRoute_ = createRoute({
  method: 'post',
  path: '/posts/{post_id}/comments',
  tags: ['comments'],
  summary: 'Create Post Comment',
  request: { headers: tokenHeader, params: postIdParam, body: commentBody },
  responses: { 201: ok(PostCommentResponse) },
});

const replyRoute = createRoute({
  method: 'post',
  path: '/comments/{comment_id}/comments',
  tags: ['comments'],
  summary: 'Reply To Comment',
  request: { headers: tokenHeader, params: commentIdParam, body: commentBody },
  responses: { 201: ok(PostCommentResponse) },
});

const deleteRoute = createRoute({
  method: 'delete',
  path: '/comments/{comment_id}',
  tags: ['comments'],
  summary: 'Delete Comment',
  request: { headers: tokenHeader, params: commentIdParam },
  responses: noContent,
});

const likeRoute = createRoute({
  method: 'post',
  path: '/comments/{comment_id}/reaction',
  tags: ['comments'],
  summary: 'Like Comment',
  request: { headers: tokenHeader, params: commentIdParam },
  responses: noContent,
});

const unlikeRoute = createRoute({
  method: 'delete',
  path: '/comments/{comment_id}/reaction',
  tags: ['comments'],
  summary: 'Unlike Comment',
  request: { headers: tokenHeader, params: commentIdParam },
  responses: noContent,
});

export const commentsRouter = createRouter()
  .openapi(
    createRoute_,
    restRoute<typeof createRoute_>('api:comments:create', async (c, { creds, ctx }) =>
      c.json(
        await createPostComment(ctx, creds, {
          postId: c.req.valid('param').post_id,
          body: c.req.valid('json').body,
        }),
        201,
      ),
    ),
  )
  .openapi(
    replyRoute,
    restRoute<typeof replyRoute>('api:comments:reply', async (c, { creds, ctx }) =>
      c.json(
        await replyToPostComment(ctx, creds, {
          commentId: c.req.valid('param').comment_id,
          body: c.req.valid('json').body,
        }),
        201,
      ),
    ),
  )
  .openapi(
    deleteRoute,
    restRoute<typeof deleteRoute>('api:comments:delete', async (c, { creds, ctx }) => {
      await deletePostComment(ctx, creds, { commentId: c.req.valid('param').comment_id });
      return c.body(null, 204);
    }),
  )
  .openapi(
    likeRoute,
    restRoute<typeof likeRoute>('api:comments:like', async (c, { creds, ctx }) => {
      await likePostComment(ctx, creds, { commentId: c.req.valid('param').comment_id });
      return c.body(null, 204);
    }),
  )
  .openapi(
    unlikeRoute,
    restRoute<typeof unlikeRoute>('api:comments:unlike', async (c, { creds, ctx }) => {
      await unlikePostComment(ctx, creds, { commentId: c.req.valid('param').comment_id });
      return c.body(null, 204);
    }),
  )
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
