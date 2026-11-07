// Port of gateway_following/schemas.py and the following models of
// gateway_core/models/substack.py (upstream bc2e875).

import { z } from '@hono/zod-openapi';

export const SubstackFollowingUser = z.object({ id: z.number().int(), handle: z.string() });
export type SubstackFollowingUser = z.infer<typeof SubstackFollowingUser>;

export const SubstackSubscriberLists = z.object({
  subscriberLists: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      groups: z.array(z.object({ users: z.array(SubstackFollowingUser) })),
    }),
  ),
});

export const FollowingUserResponse = z
  .object({ id: z.number().int(), handle: z.string() })
  .openapi('FollowingUserResponse');

export const FollowingResponse = z
  .object({ items: z.array(FollowingUserResponse) })
  .openapi('FollowingResponse');
export type FollowingResponse = z.infer<typeof FollowingResponse>;

export function followingResponse(users: SubstackFollowingUser[]): FollowingResponse {
  return { items: users.map((u) => ({ id: u.id, handle: u.handle })) };
}
