// Port of gateway_profiles/service.py plus the profile compositions of
// gateway_profiles_rest/router.py and gateway_me_rest/router.py (upstream bc2e875).

import type { BearerCredentials } from '../auth/credentials';
import { SubstackAPIError } from '../clients/errors';
import { anonymousCredentials, type GatewayContext, makeClients, NullValueCache } from '../context';
import type { NotesPageResponse } from '../schemas/notes';
import { parseSubstack } from '../schemas/parse';
import type { PostsPageResponse } from '../schemas/posts';
import { type ProfileResponse, profileResponse, SubstackPublicProfile } from '../schemas/profiles';
import { getNotesForProfile } from './notes';
import { getPostsForProfile } from './posts';

/**
 * Resolve a slug to its public profile, through the installed cache. The key is
 * the slug alone, so a cached profile is shared across requests and callers.
 * With a real cache installed the fetch is anonymous (empty cookies, as the MCP
 * profile tools do), so the shared value never depends on one caller's session
 * and one caller's auth error is never handed to another. With the default
 * NullValueCache the caller's credentials are used, as upstream does.
 */
export async function getProfileBySlug(
  ctx: GatewayContext,
  creds: BearerCredentials,
  slug: string,
): Promise<SubstackPublicProfile> {
  // "." and ".." would be normalised away by URL parsing and hit another endpoint.
  if (slug === '' || slug === '.' || slug === '..') {
    throw new SubstackAPIError(404, 'Substack returned 404: HTTP 404');
  }
  const cached = !(ctx.valueCache instanceof NullValueCache);
  const { substack } = makeClients(ctx, cached ? anonymousCredentials(ctx) : creds);
  return ctx.valueCache.getOrCall(`gateway_profiles:public_profile:${slug}`, async () => {
    // encodeURIComponent: a slug is one path segment, never a path or a query.
    const body = await substack.get(`user/${encodeURIComponent(slug)}/public_profile`);
    return parseSubstack(SubstackPublicProfile, body, 'profile');
  });
}

/** The authenticated user's own public profile (handle → profile). */
export async function getOwnProfile(
  ctx: GatewayContext,
  creds: BearerCredentials,
): Promise<SubstackPublicProfile> {
  const slug = await makeClients(ctx, creds).substack.getOwnSlug();
  return getProfileBySlug(ctx, creds, slug);
}

export async function getProfile(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { slug: string },
): Promise<ProfileResponse> {
  return profileResponse(await getProfileBySlug(ctx, creds, args.slug));
}

export async function getProfilePosts(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { slug: string; limit: number; cursor?: string | null },
): Promise<PostsPageResponse> {
  const profile = await getProfileBySlug(ctx, creds, args.slug);
  return getPostsForProfile(ctx, creds, {
    profileId: profile.id,
    limit: args.limit,
    cursor: args.cursor,
  });
}

export async function getProfileNotes(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { slug: string; cursor?: string | null },
): Promise<NotesPageResponse> {
  const profile = await getProfileBySlug(ctx, creds, args.slug);
  return getNotesForProfile(ctx, creds, { profileId: profile.id, cursor: args.cursor });
}
