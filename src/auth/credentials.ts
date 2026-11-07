// Port of gateway_core/auth.py and gateway_core/credentials.py (upstream bc2e875).

export type BearerCredentials = {
  publication_url: string;
  substack_sid: string;
  connect_sid: string;
};

export class InvalidTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTokenError';
  }
}

const MISSING_MESSAGE =
  'No Substack credentials. Pass `token` with base64-encoded credentials, ' +
  'or run a deployment that resolves credentials from the authenticated ' +
  'session.';

export class MissingCredentialsError extends Error {
  constructor(message: string = MISSING_MESSAGE) {
    super(message);
    this.name = 'MissingCredentialsError';
  }
}

const INVALID_TOKEN = 'Invalid token: expected base64-encoded JSON credentials';

// Mirrors Python urlparse: scheme must be http/https and netloc non-empty.
function hasHttpScheme(url: string): boolean {
  const m = /^([A-Za-z][A-Za-z0-9+.-]*):(.*)$/s.exec(url.trim());
  if (!m) return false;
  const scheme = (m[1] ?? '').toLowerCase();
  const rest = m[2] ?? '';
  if (scheme !== 'http' && scheme !== 'https') return false;
  if (!rest.startsWith('//')) return false;
  const netloc = rest.slice(2).split(/[/?#]/, 1)[0] ?? '';
  return netloc.length > 0;
}

export function validateBearerCredentials(
  c: Partial<BearerCredentials>,
  source = 'Token',
): asserts c is BearerCredentials {
  if (!c.publication_url) {
    throw new Error(`${source} must contain publication_url`);
  }
  if (!hasHttpScheme(c.publication_url)) {
    throw new Error(`${source} must contain a valid HTTP or HTTPS publication_url`);
  }
  if (!c.substack_sid || !c.connect_sid) {
    throw new Error(`${source} must contain substack_sid and connect_sid`);
  }
}

/** Python non-validating b64decode: drop every char outside the alphabet. */
export function lenientBase64ToBytes(raw: string, urlSafe = false): Uint8Array {
  let s = raw.replace(urlSafe ? /[^A-Za-z0-9\-_+/]/g : /[^A-Za-z0-9+/]/g, '');
  if (urlSafe) s = s.replace(/-/g, '+').replace(/_/g, '/');
  if (s.length % 4 === 1) throw new Error('invalid base64 length');
  s += '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function optionalString(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw new Error('not a string');
  return v;
}

export function decodeBearerCredentials(raw: string): BearerCredentials {
  let parsed: Partial<BearerCredentials>;
  try {
    const token = raw.replace(/^Bearer /, '');
    const bytes = lenientBase64ToBytes(token);
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    const obj: unknown = JSON.parse(text);
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
      throw new Error('not an object');
    }
    const o = obj as Record<string, unknown>;
    parsed = {
      publication_url: optionalString(o.publication_url),
      substack_sid: optionalString(o.substack_sid),
      connect_sid: optionalString(o.connect_sid),
    };
  } catch {
    throw new InvalidTokenError(INVALID_TOKEN);
  }
  try {
    validateBearerCredentials(parsed);
  } catch (e) {
    throw new InvalidTokenError((e as Error).message);
  }
  return parsed;
}
