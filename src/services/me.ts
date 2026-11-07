// Port of the compositions in gateway_me_rest/router.py and gateway_me_mcp/tools.py
// (upstream bc2e875).

import type { BearerCredentials } from '../auth/credentials';
import type { GatewayContext } from '../context';
import type { NotesPageResponse } from '../schemas/notes';
import type { PostsPageResponse } from '../schemas/posts';
import { type ProfileResponse, profileResponse } from '../schemas/profiles';
import { getOwnNotes } from './notes';
import { getPostsForProfile } from './posts';
import { getOwnProfile } from './profiles';

export async function getMe(
  ctx: GatewayContext,
  creds: BearerCredentials,
): Promise<ProfileResponse> {
  return profileResponse(await getOwnProfile(ctx, creds));
}

export async function getMyPosts(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { limit: number; cursor?: string | null },
): Promise<PostsPageResponse> {
  const profile = await getOwnProfile(ctx, creds);
  return getPostsForProfile(ctx, creds, {
    profileId: profile.id,
    limit: args.limit,
    cursor: args.cursor,
  });
}

export async function getMyNotes(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { cursor?: string | null },
): Promise<NotesPageResponse> {
  return getOwnNotes(ctx, creds, args);
}
