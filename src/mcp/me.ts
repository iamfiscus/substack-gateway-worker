// Port of gateway_me_mcp (upstream bc2e875).

import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { GatewayContext } from '../context';
import { getMe, getMyNotes, getMyPosts } from '../services/me';
import { mcpTool, readAnnotations, TOKEN_NOTE, toolMeta } from './server';

export function registerMeTools(server: McpServer, _ctx: GatewayContext): void {
  mcpTool(
    server,
    'get_me',
    {
      description: `Retrieve the authenticated user's own Substack public profile, including its \`audience\` counts (followers, primary-publication subscribers, rough free-subscriber bucket, recommendations).${TOKEN_NOTE}`,
      inputSchema: z.object({}),
      annotations: readAnnotations('Get My Profile'),
      feature: 'mcp:me:get',
      meta: toolMeta('me', 'GET /user/{slug}/public_profile', ['me', 'profile', 'read']),
    },
    (_args, creds, ctx) => getMe(ctx, creds),
  );
  mcpTool(
    server,
    'get_my_notes',
    {
      description: `Retrieve the authenticated user's own notes, paginated via an optional cursor.${TOKEN_NOTE}`,
      inputSchema: z.object({ cursor: z.string().nullish() }),
      annotations: readAnnotations('Get My Notes'),
      feature: 'mcp:me:notes:list',
      meta: toolMeta('me', 'GET /notes', ['me', 'notes', 'read']),
    },
    (args, creds, ctx) => getMyNotes(ctx, creds, args),
  );
  mcpTool(
    server,
    'get_my_posts',
    {
      description: `Retrieve the authenticated user's own posts, paginated via limit and offset.${TOKEN_NOTE}`,
      inputSchema: z.object({ limit: z.number().int().default(25), cursor: z.string().nullish() }),
      annotations: readAnnotations('Get My Posts'),
      feature: 'mcp:me:posts:list',
      meta: toolMeta('me', 'GET /profile/posts', ['me', 'posts', 'read']),
    },
    (args, creds, ctx) => getMyPosts(ctx, creds, args),
  );
}
