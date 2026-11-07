// Read tools of gateway_comments_mcp (upstream bc2e875).
// The write tools arrive in Task 10.

import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { GatewayContext } from '../context';
import { getPostComment, getPostComments, listPostCommentReplies } from '../services/comments';
import { mcpTool, readAnnotations, TOKEN_NOTE, toolMeta } from './server';

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
}
