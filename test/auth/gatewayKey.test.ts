import { describe, expect, it } from 'vitest';
import { authenticateGatewayKey, parseGatewayKeys } from '../../src/auth/gatewayKey';

async function sha(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const req = (auth?: string) =>
  new Request('https://x.test/', { headers: auth ? { authorization: auth } : {} });

describe('gateway keys', () => {
  it('authenticates raw and sha256 entries', async () => {
    const keys = parseGatewayKeys(`ci:abc,ops:sha256:${await sha('def')}`);
    expect(await authenticateGatewayKey(req('Bearer abc'), keys)).toEqual({
      token: 'ci',
      clientId: 'ci',
      scopes: [],
    });
    expect((await authenticateGatewayKey(req('Bearer def'), keys))?.clientId).toBe('ops');
  });

  it('rejects unknown keys, missing and non-bearer headers', async () => {
    const keys = parseGatewayKeys('ci:abc');
    expect(await authenticateGatewayKey(req('Bearer zzz'), keys)).toBeNull();
    expect(await authenticateGatewayKey(req(), keys)).toBeNull();
    expect(await authenticateGatewayKey(req('Basic abc'), keys)).toBeNull();
    expect(await authenticateGatewayKey(req('Bearer '), keys)).toBeNull();
  });

  it('trims, ignores empty entries, keeps colons in keys', async () => {
    const keys = parseGatewayKeys(' a : k1 , ,b:x:y,');
    expect(keys.map((k) => k.label)).toEqual(['a', 'b']);
    expect((await authenticateGatewayKey(req('Bearer k1'), keys))?.clientId).toBe('a');
    expect((await authenticateGatewayKey(req('Bearer x:y'), keys))?.clientId).toBe('b');
    expect(parseGatewayKeys(undefined)).toEqual([]);
    expect(parseGatewayKeys('')).toEqual([]);
  });

  it('throws without echoing the key on a malformed entry', () => {
    let msg = '';
    try {
      parseGatewayKeys('ci:abc,SECRETKEYNOCOLON');
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toBe('invalid GATEWAY_API_KEYS entry');
    expect(msg).not.toContain('SECRET');
  });

  it('never exposes the key as the token', async () => {
    const keys = parseGatewayKeys('ci:abc');
    const a = await authenticateGatewayKey(req('Bearer abc'), keys);
    expect(JSON.stringify(a)).not.toContain('abc');
    expect(keys[0]?.sha256).toBe(await sha('abc'));
  });

  it('matches regardless of key length differences', async () => {
    const keys = parseGatewayKeys('ci:abc');
    expect(await authenticateGatewayKey(req('Bearer abcd'), keys)).toBeNull();
    expect(await authenticateGatewayKey(req('Bearer ab'), keys)).toBeNull();
  });
});
