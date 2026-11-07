// Port of gateway_stats post_stats.py (upstream bc2e875): per-post analytics
// tabs, each an aggregate snapshot keyed by post id (plus page/cursor).

import { z } from 'zod';
import type { BearerCredentials } from '../auth/credentials';
import type { GatewayContext } from '../context';
import { makeClients } from '../context';
import { parseSubstack } from '../schemas/parse';
import { cachedSnapshot } from './stats';

const DETAIL = 'post_management/detail';
const Body = z.record(z.string(), z.unknown());

function snapshot(
  ctx: GatewayContext,
  creds: BearerCredentials,
  key: string,
  path: string,
  what: string,
  query?: Record<string, string | number>,
) {
  return cachedSnapshot(ctx.statsCache, creds.publication_url, key, async () => {
    const body = await makeClients(ctx, creds).publication.get(path, query ? { query } : undefined);
    return parseSubstack(Body, body, what);
  });
}

/** Likes, comment summary, and commenters for a post. */
export function getPostEngagement(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { postId: number },
) {
  const { postId } = args;
  return snapshot(
    ctx,
    creds,
    `post:${postId}:engagement`,
    `${DETAIL}/${postId}/engagement`,
    'post engagement',
  );
}

/** Referrers, devices, and category breakdown of a post's views. */
export function getPostTraffic(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { postId: number },
) {
  const { postId } = args;
  return snapshot(
    ctx,
    creds,
    `post:${postId}:traffic`,
    `${DETAIL}/${postId}/traffic`,
    'post traffic',
  );
}

/** Per-recipient email delivery / open / click rows (paginated). */
export function getPostRecipients(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { postId: number; limit?: number; offset?: number },
) {
  const { postId } = args;
  const limit = args.limit ?? 20;
  const offset = args.offset ?? 0;
  return snapshot(
    ctx,
    creds,
    `post:${postId}:recipients:${limit}:${offset}`,
    `${DETAIL}/${postId}/recipients`,
    'post recipients',
    { limit, offset },
  );
}

/** Subscriber growth attributed to a post. */
export function getPostGrowth(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { postId: number },
) {
  const { postId } = args;
  return snapshot(ctx, creds, `post:${postId}:growth`, `${DETAIL}/${postId}/growth`, 'post growth');
}

/** Comment / discussion thread for a post (cursor-paginated). */
export function getPostDiscussion(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { postId: number; cursor?: string | null },
) {
  const { postId, cursor } = args;
  return snapshot(
    ctx,
    creds,
    `post:${postId}:discussion:${cursor || 'start'}`,
    `${DETAIL}/${postId}/discussion`,
    'post discussion',
    cursor ? { cursor } : undefined,
  );
}
