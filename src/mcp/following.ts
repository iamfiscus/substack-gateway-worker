// Port of gateway_following_mcp (upstream bc2e875).

import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { GatewayContext } from '../context';
import { getMyFollowing } from '../services/following';
import { mcpTool, readAnnotations, TOKEN_NOTE, toolMeta } from './server';

export function registerFollowingTools(server: McpServer, _ctx: GatewayContext): void {
  mcpTool(
    server,
    'get_my_following',
    {
      description: `Retrieve the list of Substack profiles that the authenticated user follows.${TOKEN_NOTE}`,
      inputSchema: z.object({}),
      annotations: readAnnotations('Get My Following'),
      feature: 'mcp:me:following:list',
      meta: toolMeta('me', 'GET /user/{id}/subscriber-lists', ['me', 'following', 'read']),
    },
    (_args, creds, ctx) => getMyFollowing(ctx, creds),
  );
}
