import { describe, expect, it } from 'vitest';
import { SecretCredentialResolver } from '../../src/auth/resolver';

const AUTH = { token: 'ci', clientId: 'ci', scopes: [] };
const ENV = {
  OWNER_PUBLICATION_URL: 'https://ex.substack.com',
  OWNER_SUBSTACK_SID: 's%3Aa',
  OWNER_CONNECT_SID: 's%3Ab',
};

describe('SecretCredentialResolver', () => {
  it('returns null for null auth', async () => {
    expect(await new SecretCredentialResolver(ENV).resolve(null)).toBeNull();
  });

  it('returns owner credentials', async () => {
    expect(await new SecretCredentialResolver(ENV).resolve(AUTH)).toEqual({
      publication_url: 'https://ex.substack.com',
      substack_sid: 's%3Aa',
      connect_sid: 's%3Ab',
    });
  });

  it('rejects an invalid publication url', async () => {
    const r = new SecretCredentialResolver({ ...ENV, OWNER_PUBLICATION_URL: 'ftp://x' });
    await expect(r.resolve(AUTH)).rejects.toThrow(
      'Resolved credentials must contain a valid HTTP or HTTPS publication_url',
    );
  });

  it('rejects missing fields', async () => {
    const r = new SecretCredentialResolver({});
    await expect(r.resolve(AUTH)).rejects.toThrow(
      'Resolved credentials must contain publication_url',
    );
    const r2 = new SecretCredentialResolver({ ...ENV, OWNER_SUBSTACK_SID: undefined });
    await expect(r2.resolve(AUTH)).rejects.toThrow(
      'Resolved credentials must contain substack_sid',
    );
  });

  it('allows owner mode without connect.sid (Substack no longer always sets it)', async () => {
    for (const OWNER_CONNECT_SID of [undefined, '', '  \n']) {
      expect(
        await new SecretCredentialResolver({ ...ENV, OWNER_CONNECT_SID }).resolve(AUTH),
      ).toEqual({
        publication_url: 'https://ex.substack.com',
        substack_sid: 's%3Aa',
        connect_sid: '',
      });
    }
  });

  it('rejects a blank substack.sid (an empty secret upload)', async () => {
    for (const OWNER_SUBSTACK_SID of ['', '   ', '\n']) {
      const r = new SecretCredentialResolver({ ...ENV, OWNER_SUBSTACK_SID });
      await expect(r.resolve(AUTH)).rejects.toThrow(
        'Resolved credentials must contain substack_sid',
      );
    }
  });

  it('trims surrounding whitespace from owner secrets', async () => {
    const r = new SecretCredentialResolver({
      ...ENV,
      OWNER_SUBSTACK_SID: ' s%3Aa\n',
      OWNER_CONNECT_SID: 's%3Ab\n',
    });
    expect(await r.resolve(AUTH)).toMatchObject({ substack_sid: 's%3Aa', connect_sid: 's%3Ab' });
  });
});
