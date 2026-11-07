// Tools of gateway_comments_mcp (upstream bc2e875).

import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { GatewayContext } from '../context';
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
import { mcpTool, readAnnotations, TOKEN_NOTE, toolMeta, writeAnnotations } from './server';

export function registerCommentsTools(server: McpServer, _ctx: GatewayContext): void {
  mcpTool(
    server,
    'get_post_comments',
    {
      description: `Retrieve all comments for a Substack post by its numeric ID.${TOKEN_NOTE}`,
      inputSchema: z.object({ post_id: z.number().int() }),
      annotations: readAnnotations('Get Post Comments'),
      feature: 'mcp:posts:comments:list',
      meta: toolMeta('posts', 'GET /post/{post_id}/comments', ['comments', 'posts', 'read']),
    },
    (args, creds, ctx) => getPostComments(ctx, creds, { postId: args.post_id }),
  );
  mcpTool(
    server,
    'create_post_comment',
    {
      description: `Create a top-level comment on a Substack post.${TOKEN_NOTE}`,
      inputSchema: z.object({ post_id: z.number().int(), body: z.string() }),
      annotations: writeAnnotations('Create Post Comment', { idempotent: false }),
      feature: 'mcp:comments:create',
      meta: toolMeta('comments', 'POST /post/{post_id}/comment', ['comments', 'write']),
    },
    (args, creds, ctx) => createPostComment(ctx, creds, { postId: args.post_id, body: args.body }),
  );
  mcpTool(
    server,
    'reply_to_post_comment',
    {
      description: `Reply to an existing Substack post comment.${TOKEN_NOTE}`,
      inputSchema: z.object({ comment_id: z.number().int(), body: z.string() }),
      annotations: writeAnnotations('Reply To Post Comment', { idempotent: false }),
      feature: 'mcp:comments:reply',
      meta: toolMeta('comments', 'POST /post/{post_id}/comment', ['comments', 'write']),
    },
    (args, creds, ctx) =>
      replyToPostComment(ctx, creds, { commentId: args.comment_id, body: args.body }),
  );
  mcpTool(
    server,
    'get_post_comment',
    {
      description: `Fetch a single Substack post comment by its numeric ID.${TOKEN_NOTE}`,
      inputSchema: z.object({ comment_id: z.number().int() }),
      annotations: readAnnotations('Get Post Comment'),
      feature: 'mcp:comments:get',
      meta: toolMeta('comments', 'GET /reader/comment/{id}', ['comments', 'read']),
    },
    (args, creds, ctx) => getPostComment(ctx, creds, { commentId: args.comment_id }),
  );
  mcpTool(
    server,
    'delete_post_comment',
    {
      description: `Delete a Substack post comment by its numeric ID.${TOKEN_NOTE}`,
      inputSchema: z.object({ comment_id: z.number().int() }),
      annotations: writeAnnotations('Delete Post Comment', { destructive: true, idempotent: true }),
      feature: 'mcp:comments:delete',
      textResult: true,
      meta: toolMeta('comments', 'DELETE /comment/{id}', ['comments', 'write', 'delete']),
    },
    async (args, creds, ctx) => {
      await deletePostComment(ctx, creds, { commentId: args.comment_id });
      return `Comment ${args.comment_id} deleted successfully.`;
    },
  );
  mcpTool(
    server,
    'list_post_comment_replies',
    {
      description: `List the direct replies to a Substack post comment.${TOKEN_NOTE}`,
      inputSchema: z.object({ comment_id: z.number().int() }),
      annotations: readAnnotations('List Post Comment Replies'),
      feature: 'mcp:comments:replies:list',
      meta: toolMeta('comments', 'GET /reader/comment/{id}/replies', ['comments', 'read']),
    },
    (args, creds, ctx) => listPostCommentReplies(ctx, creds, { commentId: args.comment_id }),
  );
  mcpTool(
    server,
    'like_post_comment',
    {
      description: `Add a like reaction to a Substack post comment.${TOKEN_NOTE}`,
      inputSchema: z.object({ comment_id: z.number().int() }),
      annotations: writeAnnotations('Like Post Comment', { idempotent: true }),
      feature: 'mcp:comments:like',
      textResult: true,
      meta: toolMeta('comments', 'POST /comment/{id}/reaction', ['comments', 'write']),
    },
    async (args, creds, ctx) => {
      await likePostComment(ctx, creds, { commentId: args.comment_id });
      return `Comment ${args.comment_id} liked successfully.`;
    },
  );
  mcpTool(
    server,
    'unlike_post_comment',
    {
      description: `Remove your like reaction from a Substack post comment.${TOKEN_NOTE}`,
      inputSchema: z.object({ comment_id: z.number().int() }),
      // Upstream marks this one destructive (the other unlike tools are not); kept verbatim.
      annotations: writeAnnotations('Unlike Post Comment', { destructive: true, idempotent: true }),
      feature: 'mcp:comments:unlike',
      textResult: true,
      meta: toolMeta('comments', 'DELETE /comment/{id}/reaction', ['comments', 'write']),
    },
    async (args, creds, ctx) => {
      await unlikePostComment(ctx, creds, { commentId: args.comment_id });
      return `Comment ${args.comment_id} unliked successfully.`;
    },
  );
}
