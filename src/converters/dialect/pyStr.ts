// Python str semantics the dialect relies on where JS differs.

import { PyValueError } from './errors';

/**
 * Python's `\s` for str patterns, which is also exactly `str.isspace()`, as a
 * regex character-class body (it has U+001C..U+001F and U+0085, and not U+FEFF,
 * unlike JS `\s`).
 */
export const PY_SPACE =
  '\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';

const SPACE_CHAR = new RegExp(`^[${PY_SPACE}]$`);

/** `ch.isspace()` for one UTF-16 unit (no astral character is whitespace). */
export function isSpace(ch: string): boolean {
  return SPACE_CHAR.test(ch);
}

/** CPython's default `sys.get_int_max_str_digits()`. */
export const INT_MAX_STR_DIGITS = 4300;

/** The ValueError text of CPython 3.11 for a str -> int conversion past the limit. */
export function intDigitLimitMessage(digits: number): string {
  return (
    `Exceeds the limit (${INT_MAX_STR_DIGITS} digits) for integer string conversion: ` +
    `value has ${digits} digits; use sys.set_int_max_str_digits() to increase the limit`
  );
}

const DIGIT = /^\p{Nd}$/u;

/**
 * Value of a Unicode decimal digit. Unicode encodes every Nd digit set as a
 * contiguous 0..9 range, so the value is the number of Nd code points right
 * before it, modulo 10.
 */
function digitValue(cp: number): number {
  let first = cp;
  while (DIGIT.test(String.fromCodePoint(first - 1))) first--;
  return (cp - first) % 10;
}

/**
 * Python `int(raw)` for a string matching `-?\d+` (`\d` being any Unicode
 * decimal digit). Throws PyValueError past INT_MAX_STR_DIGITS digits. The result
 * is a JS number, so values beyond 2^53 lose precision.
 */
export function pyIntFromDigits(raw: string): number {
  const negative = raw.startsWith('-');
  let ascii = '';
  for (const ch of negative ? raw.slice(1) : raw) {
    const cp = ch.codePointAt(0) as number;
    ascii += cp >= 0x30 && cp <= 0x39 ? ch : String(digitValue(cp));
  }
  if (ascii.length > INT_MAX_STR_DIGITS) throw new PyValueError(intDigitLimitMessage(ascii.length));
  const value = Number(ascii);
  return negative && value !== 0 ? -value : value;
}

/** Defines `key` as an own property, so that `__proto__` is data, not the prototype. */
export function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}
