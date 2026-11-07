import { describe, expect, it } from 'vitest';
import {
  decodeBearerCredentials,
  InvalidTokenError,
  MissingCredentialsError,
  validateBearerCredentials,
} from '../../src/auth/credentials';

const CREDS = {
  publication_url: 'https://ex.substack.com',
  substack_sid: 's%3Aa',
  connect_sid: 's%3Ab',
};
const INVALID = 'Invalid token: expected base64-encoded JSON credentials';

function b64(obj: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

describe('decodeBearerCredentials', () => {
  const token = b64(CREDS);
  it('decodes plain', () => expect(decodeBearerCredentials(token)).toEqual(CREDS));
  it('tolerates trailing newline', () =>
    expect(decodeBearerCredentials(`${token}\n`)).toEqual(CREDS));
  it('tolerates 76-column wrapping', () => {
    const long = b64({ ...CREDS, publication_url: `https://ex.substack.com/${'a'.repeat(100)}` });
    const wrapped = long.match(/.{1,76}/g)?.join('\n') ?? '';
    expect(wrapped).toContain('\n');
    expect(decodeBearerCredentials(wrapped).substack_sid).toBe('s%3Aa');
  });
  it('strips Bearer prefix', () =>
    expect(decodeBearerCredentials(`Bearer ${token}`)).toEqual(CREDS));
  it('keeps non-ASCII UTF-8 intact', () => {
    const c = { ...CREDS, publication_url: 'https://ünï.example' };
    expect(decodeBearerCredentials(b64(c)).publication_url).toBe('https://ünï.example');
  });
  it('rejects non-base64 input', () => {
    expect(() => decodeBearerCredentials('%%%')).toThrow(INVALID);
    expect(() => decodeBearerCredentials('%%%')).toThrow(InvalidTokenError);
  });
  it('rejects bad JSON, non-objects and invalid UTF-8', () => {
    expect(() => decodeBearerCredentials(btoa('nope'))).toThrow(INVALID);
    expect(() => decodeBearerCredentials(btoa('[1]'))).toThrow(INVALID);
    expect(() => decodeBearerCredentials(btoa('\xff\xfe'))).toThrow(INVALID);
    expect(() => decodeBearerCredentials(b64({ ...CREDS, substack_sid: 5 }))).toThrow(INVALID);
  });
  it('rejects ftp scheme', () =>
    expect(() => decodeBearerCredentials(b64({ ...CREDS, publication_url: 'ftp://x' }))).toThrow(
      'Token must contain a valid HTTP or HTTPS publication_url',
    ));
  it('rejects missing connect_sid', () => {
    const { connect_sid: _omit, ...rest } = CREDS;
    expect(() => decodeBearerCredentials(b64(rest))).toThrow(
      'Token must contain substack_sid and connect_sid',
    );
  });
});

describe('validateBearerCredentials', () => {
  it('requires publication_url', () =>
    expect(() => validateBearerCredentials({})).toThrow('Token must contain publication_url'));
  it('uses custom source', () =>
    expect(() =>
      validateBearerCredentials({ publication_url: 'https://a.b' }, 'Resolved credentials'),
    ).toThrow('Resolved credentials must contain substack_sid and connect_sid'));
  it('rejects url without host', () =>
    expect(() => validateBearerCredentials({ publication_url: 'https:///x' })).toThrow(
      'Token must contain a valid HTTP or HTTPS publication_url',
    ));
});

describe('MissingCredentialsError', () => {
  it('has upstream default message', () => {
    expect(new MissingCredentialsError().message).toBe(
      'No Substack credentials. Pass `token` with base64-encoded credentials, or run a deployment that resolves credentials from the authenticated session.',
    );
  });
});
