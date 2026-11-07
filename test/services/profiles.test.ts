import { expect, it } from 'vitest';
import { ownerFeatures } from '../../src/auth/features';
import { loadConfig } from '../../src/config';
import { type GatewayContext, NullValueCache, type ValueCache } from '../../src/context';
import { createLogger } from '../../src/log';
import { getProfile, getProfilePosts } from '../../src/services/profiles';
import { createFakeSubstack, sample } from '../support/fakeSubstack';

const creds = {
  publication_url: 'https://example.substack.com',
  substack_sid: 's',
  connect_sid: 'c',
};

function ctxWith(valueCache: ValueCache, routes: Record<string, unknown>) {
  const env = { SUBSTACK_BASE_URL: 'https://substack.com' };
  const config = loadConfig(env);
  const fake = createFakeSubstack(routes);
  const ctx: GatewayContext = {
    env,
    config,
    fetcher: fake,
    valueCache,
    statsCache: null,
    resolver: null,
    requestId: 'r',
    authInfo: null,
    ownerFeatures: ownerFeatures({}),
    log: createLogger('error'),
  };
  return { ctx, fake };
}

it('looks profiles up through the value cache, keyed by slug alone', async () => {
  const keys: string[] = [];
  const cache: ValueCache = {
    getOrCall: (key, factory) => {
      keys.push(key);
      return factory();
    },
  };
  const { ctx } = ctxWith(cache, {
    'GET substack.com/api/v1/user/jakubslys/public_profile': sample(
      'user/jakubslys/public_profile',
    ),
    'GET substack.com/api/v1/profile/posts': sample('profile/posts'),
  });
  await getProfile(ctx, creds, { slug: 'jakubslys' });
  await getProfilePosts(ctx, creds, { slug: 'jakubslys', limit: 25 });
  expect(keys).toEqual([
    'gateway_profiles:public_profile:jakubslys',
    'gateway_profiles:public_profile:jakubslys',
  ]);
});

it('a cached profile skips Substack entirely', async () => {
  const cached = {
    id: 7,
    name: 'N',
    handle: 'h',
    followerCount: null,
    subscriberCountNumber: null,
    subscriberCountString: null,
    rough_num_free_subscribers_int: null,
    rough_num_free_subscribers: null,
    primaryPublicationRecommendationCount: null,
  };
  const cache: ValueCache = { getOrCall: async <T>() => cached as T };
  const { ctx, fake } = ctxWith(cache, {});
  const out = await getProfile(ctx, creds, { slug: 'h' });
  expect(out.id).toBe(7);
  expect(fake.calls).toHaveLength(0);
});

it('wraps an invalid audience count to null instead of failing', async () => {
  const { ctx } = ctxWith(new NullValueCache(), {
    'GET substack.com/api/v1/user/x/public_profile': {
      id: 1,
      name: 'X',
      handle: 'x',
      followerCount: 'many',
      subscriberCountNumber: 5,
    },
  });
  const out = await getProfile(ctx, creds, { slug: 'x' });
  expect(out.audience).toEqual({
    followers: null,
    subscribers: 5,
    subscribers_label: null,
    free_subscribers_rough: null,
    free_subscribers_rough_label: null,
    recommendations: null,
  });
});

it.each(['.', '..', ''])('slug %j is a 404 without calling Substack', async (slug) => {
  const { ctx, fake } = ctxWith(new NullValueCache(), {});
  await expect(getProfile(ctx, creds, { slug })).rejects.toMatchObject({ status: 404 });
  expect(fake.calls).toHaveLength(0);
});
