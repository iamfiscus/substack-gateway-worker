// Port of gateway_posts_mcp (upstream bc2e875).

import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { GatewayContext } from '../context';
import { getPost, likePost, restackPost, unlikePost } from '../services/posts';
import { mcpTool, readAnnotations, TOKEN_NOTE, toolMeta, writeAnnotations } from './server';

export function registerPostsTools(server: McpServer, _ctx: GatewayContext): void {
  mcpTool(
    server,
    'get_post',
    {
      description: `Retrieve the full content of a Substack post by its numeric ID.${TOKEN_NOTE}`,
      inputSchema: z.object({ post_id: z.number().int() }),
      annotations: readAnnotations('Get Post'),
      feature: 'mcp:posts:get',
      meta: toolMeta('posts', 'GET /posts/by-id/{post_id}', ['posts', 'read']),
    },
    (args, creds, ctx) => getPost(ctx, creds, { postId: args.post_id }),
  );
  mcpTool(
    server,
    'like_post',
    {
      description: `Add a heart like to a Substack post by its numeric ID.${TOKEN_NOTE}`,
      inputSchema: z.object({ post_id: z.number().int() }),
      annotations: writeAnnotations('Like Post', { idempotent: true }),
      feature: 'mcp:posts:like',
      meta: toolMeta('posts', 'PUT /posts/{post_id}/like', ['posts', 'write']),
    },
    async (args, creds, ctx) => {
      await likePost(ctx, creds, { postId: args.post_id });
      return `Post ${args.post_id} liked successfully.`;
    },
  );
  mcpTool(
    server,
    'unlike_post',
    {
      description: `Remove a heart like from a Substack post by its numeric ID.${TOKEN_NOTE}`,
      inputSchema: z.object({ post_id: z.number().int() }),
      annotations: writeAnnotations('Unlike Post', { destructive: true, idempotent: true }),
      feature: 'mcp:posts:unlike',
      meta: toolMeta('posts', 'DELETE /posts/{post_id}/like', ['posts', 'write', 'delete']),
    },
    async (args, creds, ctx) => {
      await unlikePost(ctx, creds, { postId: args.post_id });
      return `Post ${args.post_id} unliked successfully.`;
    },
  );
  mcpTool(
    server,
    'restack_post',
    {
      description: `Restack a Substack post into the authenticated user's feed by its numeric ID.${TOKEN_NOTE}`,
      inputSchema: z.object({ post_id: z.number().int() }),
      annotations: writeAnnotations('Restack Post', { idempotent: false }),
      feature: 'mcp:posts:restack',
      meta: toolMeta('posts', 'POST /posts/{post_id}/restack', ['posts', 'write']),
    },
    async (args, creds, ctx) => {
      await restackPost(ctx, creds, { postId: args.post_id });
      return `Post ${args.post_id} restacked successfully.`;
    },
  );
}
