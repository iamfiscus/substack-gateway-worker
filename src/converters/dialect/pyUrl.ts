// Python 3.11 `urllib.parse.urlsplit(url)` (CPython 3.11.5, the upstream
// runtime), reduced to what blocks.py reads: the scheme and `.hostname`.
// The WHATWG input cleaning, the IPv6 bracket checks and the NFKC netloc
// check all raise ValueError there; here they throw PyValueError.

import { PyValueError } from './errors';

const SCHEME_CHARS = /^[A-Za-z0-9+\-.]*$/;
const ASCII_LETTER = /^[A-Za-z]$/;
const UNSAFE = /[\t\r\n]/g;
const IPV_FUTURE = /^v[a-fA-F0-9]+\.[^\n]+$/;

export interface SplitUrl {
  scheme: string;
  netloc: string;
}

/** Python `text.lstrip()` of the WHATWG C0 control-or-space set (U+0000..U+0020). */
function stripC0OrSpace(text: string): string {
  let start = 0;
  while (start < text.length && text.charCodeAt(start) <= 0x20) start++;
  return text.slice(start);
}

/** Python `str.isascii()`. */
function isAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 0x7f) return false;
  return true;
}

/** Python `str.partition(sep)`. */
function partition(text: string, sep: string): [string, boolean, string] {
  const i = text.indexOf(sep);
  return i < 0 ? [text, false, ''] : [text.slice(0, i), true, text.slice(i + sep.length)];
}

/** `urlsplit(url)`: scheme and netloc. Throws PyValueError where Python raises ValueError. */
export function urlsplit(input: string): SplitUrl {
  let url = stripC0OrSpace(input).replace(UNSAFE, '');
  let scheme = '';
  let netloc = '';
  const i = url.indexOf(':');
  if (i > 0 && ASCII_LETTER.test(url.charAt(0)) && SCHEME_CHARS.test(url.slice(0, i))) {
    scheme = url.slice(0, i).toLowerCase();
    url = url.slice(i + 1);
  }
  if (url.startsWith('//')) {
    let end = url.length;
    for (const c of '/?#') {
      const at = url.indexOf(c, 2);
      if (at >= 0) end = Math.min(end, at);
    }
    netloc = url.slice(2, end);
    const open = netloc.includes('[');
    const close = netloc.includes(']');
    if (open !== close) throw new PyValueError('Invalid IPv6 URL');
    if (open) checkBracketedHost(partition(partition(netloc, '[')[2], ']')[0]);
  }
  checkNetloc(netloc);
  return { scheme, netloc };
}

/** `SplitResult.hostname`: lower-cased (except an IPv6 zone), or null. */
export function hostname(netloc: string): string | null {
  const hostinfo = netloc.slice(netloc.lastIndexOf('@') + 1);
  const [, open, bracketed] = partition(hostinfo, '[');
  const host = open ? partition(bracketed, ']')[0] : partition(hostinfo, ':')[0];
  if (!host) return null;
  const [name, percent, zone] = partition(host, '%');
  return name.toLowerCase() + (percent ? '%' : '') + zone;
}

function checkBracketedHost(host: string): void {
  if (host.startsWith('v')) {
    if (!IPV_FUTURE.test(host)) throw new PyValueError('IPvFuture address is invalid');
  } else if (isIPv4(host)) {
    throw new PyValueError('An IPv4 address cannot be in brackets');
  } else if (!isIPv6(host)) {
    throw new PyValueError(`'${host}' does not appear to be an IPv4 or IPv6 address`);
  }
}

/** `ipaddress.IPv4Address(text)` succeeds. */
function isIPv4(text: string): boolean {
  const octets = text.split('.');
  return (
    octets.length === 4 &&
    octets.every(
      (o) => /^[0-9]{1,3}$/.test(o) && (o === '0' || !o.startsWith('0')) && Number(o) <= 255,
    )
  );
}

/** `ipaddress.IPv6Address(text)` succeeds (scope id included). */
function isIPv6(text: string): boolean {
  if (text.includes('/')) return false;
  const [address, hasScope, scope] = partition(text, '%');
  if (hasScope && (!scope || scope.includes('%'))) return false;
  if (!address) return false;
  const parts = address.split(':');
  if (parts.length < 3) return false;
  const last = parts.at(-1) as string;
  if (last.includes('.')) {
    if (!isIPv4(last)) return false;
    parts.splice(-1, 1, '0', '0'); // two hextets, both well formed
  }
  if (parts.length > 9) return false;
  let skip: number | null = null;
  for (let k = 1; k < parts.length - 1; k++) {
    if (!parts[k]) {
      if (skip !== null) return false;
      skip = k;
    }
  }
  let hi: number;
  let lo: number;
  if (skip !== null) {
    hi = skip;
    lo = parts.length - skip - 1;
    if (!parts[0] && --hi) return false;
    if (!parts.at(-1) && --lo) return false;
    if (8 - (hi + lo) < 1) return false;
  } else {
    if (parts.length !== 8 || !parts[0] || !parts.at(-1)) return false;
    hi = parts.length;
    lo = 0;
  }
  const hextets = [...parts.slice(0, hi), ...parts.slice(parts.length - lo)];
  return hextets.every((h) => /^[0-9a-fA-F]{1,4}$/.test(h));
}

/** Python `_checknetloc`: characters that NFKC turns into URL delimiters. */
function checkNetloc(netloc: string): void {
  if (!netloc || isAscii(netloc)) return;
  const n = netloc.replace(/[@:#?]/g, '');
  const normalized = n.normalize('NFKC');
  if (n === normalized) return;
  for (const c of '/?#@:') {
    if (normalized.includes(c)) {
      throw new PyValueError(
        `netloc '${netloc}' contains invalid characters under NFKC normalization`,
      );
    }
  }
}
