// Port of gateway_following/service.py (upstream bc2e875).

import type { BearerCredentials } from '../auth/credentials';
import { type GatewayContext, makeClients } from '../context';
import {
  type FollowingResponse,
  followingResponse,
  type SubstackFollowingUser,
  SubstackSubscriberLists,
} from '../schemas/following';
import { parseSubstack } from '../schemas/parse';

/** GET /user/{id}/subscriber-lists?lists=following (publication host). */
export async function getMyFollowing(
  ctx: GatewayContext,
  creds: BearerCredentials,
): Promise<FollowingResponse> {
  const { substack, publication } = makeClients(ctx, creds);
  const userId = await substack.getOwnUserId();
  const body = await publication.get(`user/${userId}/subscriber-lists`, {
    query: { lists: 'following' },
  });
  const data = parseSubstack(SubstackSubscriberLists, body, 'subscriber-lists');
  const users: SubstackFollowingUser[] = data.subscriberLists.flatMap((sl) =>
    sl.groups.flatMap((g) => g.users),
  );
  return followingResponse(users);
}
