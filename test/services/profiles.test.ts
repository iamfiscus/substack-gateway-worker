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

it('with a value cache installed, fetches anonymously and shares one result across callers', async () => {
  const store = new Map<string, Promise<unknown>>();
  const cache: ValueCache = {
    getOrCall: <T>(key: string, factory: () => Promise<T>) => {
      if (!store.has(key)) store.set(key, factory());
      return store.get(key) as Promise<T>;
    },
  };
  const { ctx, fake } = ctxWith(cache, {
    'GET substack.com/api/v1/user/jakubslys/public_profile': sample(
      'user/jakubslys/public_profile',
    ),
  });
  const alice = { publication_url: 'https://a.substack.com', substack_sid: 'A', connect_sid: 'a' };
  const bob = { publication_url: 'https://b.substack.com', substack_sid: 'B', connect_sid: 'b' };
  const one = await getProfile(ctx, alice, { slug: 'jakubslys' });
  const two = await getProfile(ctx, bob, { slug: 'jakubslys' });
  expect(two).toEqual(one);
  expect(fake.calls).toHaveLength(1);
  // Anonymous: the empty-cookie form the MCP profile tools send, never a caller's session.
  const cookie = fake.calls[0]?.headers.get('cookie') ?? '';
  expect(cookie).toBe('substack.sid=; connect.sid=');
  expect(cookie).not.toMatch(/sid=[ABab]/);
});

it('with a value cache installed, a caller auth error is never what gets cached', async () => {
  const { ctx, fake } = ctxWith(
    { getOrCall: (_k, f) => f() },
    { 'GET substack.com/api/v1/user/x/public_profile': { id: 1, name: 'X', handle: 'x' } },
  );
  await getProfile(ctx, { ...creds, substack_sid: 'expired' }, { slug: 'x' });
  expect(fake.calls[0]?.headers.get('cookie')).not.toContain('expired');
});

it('with the NullValueCache, uses the caller credentials as upstream does', async () => {
  const { ctx, fake } = ctxWith(new NullValueCache(), {
    'GET substack.com/api/v1/user/x/public_profile': { id: 1, name: 'X', handle: 'x' },
  });
  await getProfile(ctx, creds, { slug: 'x' });
  expect(fake.calls[0]?.headers.get('cookie')).toBe('substack.sid=s; connect.sid=c');
});
