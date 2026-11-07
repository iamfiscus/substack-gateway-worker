// Gateway API keys: `label:key` or `label:sha256:<hex>`, hashed at parse time.

import { createHash } from 'node:crypto';

export type AuthInfo = { token: string; clientId: string; scopes: string[] };
export type GatewayKey = { label: string; sha256: string };

const HEX64 = /^[0-9a-f]{64}$/;
const INVALID_ENTRY = 'invalid GATEWAY_API_KEYS entry';

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

type SubtleWithTimingSafe = SubtleCrypto & {
  timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean;
};

/** Constant-time compare of two equal-length (hash) strings; never short-circuits. */
function timingSafeEqualHex(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  const native = (crypto.subtle as SubtleWithTimingSafe).timingSafeEqual;
  if (typeof native === 'function') return native.call(crypto.subtle, x, y);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Parse GATEWAY_API_KEYS; raw keys are hashed here and never retained. */
export function parseGatewayKeys(raw?: string): GatewayKey[] {
  const out: GatewayKey[] = [];
  for (const part of (raw ?? '').split(',')) {
    const entry = part.trim();
    if (!entry) continue;
    const i = entry.indexOf(':');
    if (i < 0) throw new Error(INVALID_ENTRY);
    const label = entry.slice(0, i).trim();
    const rest = entry.slice(i + 1).trim();
    if (!label || !rest) throw new Error(INVALID_ENTRY);
    if (rest.startsWith('sha256:')) {
      const hex = rest.slice('sha256:'.length).trim().toLowerCase();
      if (!HEX64.test(hex)) throw new Error(INVALID_ENTRY);
      out.push({ label, sha256: hex });
    } else {
      out.push({ label, sha256: createHash('sha256').update(rest, 'utf8').digest('hex') });
    }
  }
  return out;
}

export async function authenticateGatewayKey(
  req: Request,
  keys: GatewayKey[],
): Promise<AuthInfo | null> {
  const header = req.headers.get('authorization');
  const m = header ? /^Bearer[ \t]+(.+)$/i.exec(header) : null;
  const presented = m?.[1]?.trim();
  if (!presented) return null;
  const digest = await sha256Hex(presented);
  let found: GatewayKey | null = null;
  for (const k of keys) {
    // Evaluate every key so timing doesn't reveal which (or whether) one matched.
    if (timingSafeEqualHex(digest, k.sha256) && found === null) found = k;
  }
  return found ? { token: found.label, clientId: found.label, scopes: [] } : null;
}
