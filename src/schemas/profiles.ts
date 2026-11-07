// Port of gateway_profiles/schemas.py and SubstackPublicProfile of
// gateway_core/models/substack.py (upstream bc2e875).

import { z } from '@hono/zod-openapi';

/** Audience counts: an unexpected or missing value falls back to null, never fails the profile. */
const intOrNull = z.number().int().nullable().catch(null);
const stringOrNull = z.string().nullable().catch(null);

export const SubstackPublicProfile = z.object({
  id: z.number().int(),
  name: z.string(),
  handle: z.string(),
  previous_name: z.string().nullish(),
  photo_url: z.string().nullish(),
  bio: z.string().nullish(),
  profile_set_up_at: z.string().nullish(),
  reader_installed_at: z.string().nullish(),
  tos_accepted_at: z.string().nullish(),
  profile_disabled: z.boolean().nullish(),
  followerCount: intOrNull,
  subscriberCountNumber: intOrNull,
  subscriberCountString: stringOrNull,
  rough_num_free_subscribers_int: intOrNull,
  rough_num_free_subscribers: stringOrNull,
  primaryPublicationRecommendationCount: intOrNull,
});
export type SubstackPublicProfile = z.infer<typeof SubstackPublicProfile>;

export const ProfileAudience = z
  .object({
    followers: z.number().int().nullable(),
    subscribers: z.number().int().nullable(),
    subscribers_label: z.string().nullable(),
    free_subscribers_rough: z.number().int().nullable(),
    free_subscribers_rough_label: z.string().nullable(),
    recommendations: z.number().int().nullable(),
  })
  .openapi('ProfileAudience');

export const ProfileResponse = z
  .object({
    id: z.number().int(),
    handle: z.string(),
    name: z.string(),
    url: z.string(),
    avatar_url: z.string(),
    bio: z.string().nullable(),
    audience: ProfileAudience,
  })
  .openapi('ProfileResponse');
export type ProfileResponse = z.infer<typeof ProfileResponse>;

export function profileResponse(profile: SubstackPublicProfile): ProfileResponse {
  return {
    id: profile.id,
    handle: profile.handle,
    name: profile.name,
    url: `https://substack.com/@${profile.handle}`,
    avatar_url: profile.photo_url || '',
    bio: profile.bio ?? null,
    audience: {
      followers: profile.followerCount,
      subscribers: profile.subscriberCountNumber,
      subscribers_label: profile.subscriberCountString,
      free_subscribers_rough: profile.rough_num_free_subscribers_int,
      free_subscribers_rough_label: profile.rough_num_free_subscribers,
      recommendations: profile.primaryPublicationRecommendationCount,
    },
  };
}
