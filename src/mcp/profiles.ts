// Port of gateway_profiles_mcp (upstream bc2e875). Public tools: no `token`
// argument, anonymous clients.

import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { GatewayContext } from '../context';
import { getProfile, getProfileNotes, getProfilePosts } from '../services/profiles';
import { mcpTool, readAnnotations, toolMeta } from './server';

export function registerProfilesTools(server: McpServer, _ctx: GatewayContext): void {
  mcpTool(
    server,
    'get_profile',
    {
      description:
        'Retrieve a public Substack profile by its handle/slug, including its `audience` counts (followers, primary-publication subscribers, rough free-subscriber bucket, recommendations); counts Substack does not expose are null.',
      inputSchema: z.object({ slug: z.string() }),
      annotations: readAnnotations('Get Profile'),
      feature: 'mcp:profiles:get',
      anonymous: true,
      meta: toolMeta('profiles', 'GET /user/{slug}/public_profile', ['profiles', 'read']),
    },
    (args, creds, ctx) => getProfile(ctx, creds, args),
  );
  mcpTool(
    server,
    'get_profile_posts',
    {
      description:
        'Retrieve a paginated list of posts for a Substack profile identified by handle/slug.',
      inputSchema: z.object({
        slug: z.string(),
        limit: z.number().int().default(25),
        cursor: z.string().nullish(),
      }),
      annotations: readAnnotations('Get Profile Posts'),
      feature: 'mcp:profiles:posts:list',
      anonymous: true,
      meta: toolMeta('profiles', 'GET /profile/posts', ['profiles', 'posts', 'read']),
    },
    (args, creds, ctx) => getProfilePosts(ctx, creds, args),
  );
  mcpTool(
    server,
    'get_profile_notes',
    {
      description:
        'Retrieve a paginated list of notes for a Substack profile identified by handle/slug.',
      inputSchema: z.object({ slug: z.string(), cursor: z.string().nullish() }),
      annotations: readAnnotations('Get Profile Notes'),
      feature: 'mcp:profiles:notes:list',
      anonymous: true,
      meta: toolMeta('profiles', 'GET /reader/feed/profile/{id}', ['profiles', 'notes', 'read']),
    },
    (args, creds, ctx) => getProfileNotes(ctx, creds, args),
  );
}
