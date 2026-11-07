// Port of the read tool of gateway_posts_mcp (upstream bc2e875).
// like_post, unlike_post and restack_post arrive in Task 10.

import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { GatewayContext } from '../context';
import { getPost } from '../services/posts';
import { mcpTool, readAnnotations, TOKEN_NOTE, toolMeta } from './server';

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
}
