// Port of PostsService in gateway_posts/service.py (upstream bc2e875).
// Includes PostReactionsService and PostRestacksService.

import type { BearerCredentials } from '../auth/credentials';
import { type GatewayContext, makeClients } from '../context';
import { parseSubstack } from '../schemas/parse';
import {
  type FullPostResponse,
  fullPostResponse,
  type PostsPageResponse,
  postsPageResponse,
  SubstackPostResponse,
  SubstackProfilePostsPage,
} from '../schemas/posts';

/** GET /profile/posts: posts for a profile id, mapped to the gateway page. */
export async function getPostsForProfile(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { profileId: number; limit: number; cursor?: string | null },
): Promise<PostsPageResponse> {
  const { substack } = makeClients(ctx, creds);
  const query: Record<string, string | number> = {
    profile_user_id: args.profileId,
    limit: args.limit,
  };
  // profile/posts reads `next_cursor`; `cursor` is silently ignored and the
  // first page comes back again.
  if (args.cursor) query.next_cursor = args.cursor;
  const body = await substack.get('profile/posts', { query });
  return postsPageResponse(parseSubstack(SubstackProfilePostsPage, body, 'posts'));
}

/** GET /posts/by-id/{id}: the full post. */
export async function getPost(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { postId: number },
): Promise<FullPostResponse> {
  const body = await makeClients(ctx, creds).substack.get(`posts/by-id/${args.postId}`);
  return fullPostResponse(parseSubstack(SubstackPostResponse, body, 'post').post);
}

const LIKE_REACTION = '❤';
const READER_SURFACE = 'reader';

/** POST /post/{id}/reaction: like a post. */
export async function likePost(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { postId: number },
): Promise<void> {
  await makeClients(ctx, creds).substack.post(`post/${args.postId}/reaction`, {
    json: { reaction: LIKE_REACTION, surface: READER_SURFACE },
  });
}

/** DELETE /post/{id}/reaction: remove the like. */
export async function unlikePost(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { postId: number },
): Promise<void> {
  await makeClients(ctx, creds).substack.delete(`post/${args.postId}/reaction`, { json: {} });
}

/** POST /restack/feed: restack a post. */
export async function restackPost(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { postId: number },
): Promise<void> {
  await makeClients(ctx, creds).substack.post('restack/feed', {
    json: { postId: args.postId, commentId: null },
  });
}
