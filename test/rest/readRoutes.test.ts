import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import type { GatewayEnv } from '../../src/config';
import { encodeCredentials, TEST_ENV } from '../bdd/steps/common';
import { createFakeSubstack, sample } from '../support/fakeSubstack';

const OWNER_ENV: GatewayEnv = {
  ...TEST_ENV,
  GATEWAY_API_KEYS: 'ci:abc',
  OWNER_PUBLICATION_URL: 'https://owner.substack.com',
  OWNER_SUBSTACK_SID: 'owner-sid',
  OWNER_CONNECT_SID: 'owner-connect',
};
const KEY = { authorization: 'Bearer abc' };
const TOKEN = encodeCredentials({
  publication_url: 'https://tok.substack.com',
  substack_sid: 's',
  connect_sid: 'c',
});

function app() {
  const fake = createFakeSubstack({
    'GET substack.com/api/v1/handle/options': sample('handle/options'),
    'GET substack.com/api/v1/user/jakubslys/public_profile': sample(
      'user/jakubslys/public_profile',
    ),
    'GET substack.com/api/v1/user-settings': { userSettings: [{ user_id: 254824415 }] },
    'GET owner.substack.com/api/v1/notes': sample('notes'),
    'GET owner.substack.com/api/v1/user/254824415/subscriber-lists': sample(
      'user/254824415/subscriber-lists',
    ),
    'GET owner.substack.com/api/v1/reader/feed/profile/254824415': sample(
      'feed/profile/254824415?types=note',
    ),
    'GET substack.com/api/v1/profile/posts': sample('profile/posts'),
    'GET substack.com/api/v1/posts/by-id/987654': sample('posts/by-id/987654'),
  });
  const a = createApp({ fetcher: fake });
  return (path: string, headers: Record<string, string> = {}, env: GatewayEnv = OWNER_ENV) =>
    a.request(path, { headers }, env);
}

describe('owner feature gate on read routes', () => {
  it.each([
    '/api/v1/me/notes',
    '/api/v1/me/posts',
    '/api/v1/me/following',
    '/api/v1/profiles/jakubslys/posts',
    '/api/v1/profiles/jakubslys/notes',
  ])('%s is allowed for owner credentials by default', async (path) => {
    const res = await app()(path, KEY);
    expect(res.status).toBe(200);
  });

  it.each(['/api/v1/me', '/api/v1/posts/987654'])('%s is allowed for the owner', async (path) => {
    expect((await app()(path, KEY)).status).toBe(200);
  });

  it('does not gate an explicit token', async () => {
    const res = await app()('/api/v1/me/posts', { ...KEY, 'x-gateway-token': TOKEN });
    expect(res.status).toBe(200);
  });
});

describe('query and path validation', () => {
  const tok = { 'x-gateway-token': TOKEN };
  it.each([
    '/api/v1/me/posts?limit=abc',
    '/api/v1/profiles/jakubslys/posts?limit=0',
    '/api/v1/profiles/jakubslys/posts?limit=101',
    '/api/v1/posts/0',
    '/api/v1/posts/abc',
  ])('%s answers 422', async (path) => {
    const res = await app()(path, tok, TEST_ENV);
    expect(res.status).toBe(422);
    expect(Array.isArray(((await res.json()) as { detail: unknown }).detail)).toBe(true);
  });

  it('accepts the maximum limit', async () => {
    expect((await app()('/api/v1/me/posts?limit=100', tok, TEST_ENV)).status).toBe(200);
  });
});
