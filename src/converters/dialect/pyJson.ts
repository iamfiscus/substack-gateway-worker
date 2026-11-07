// Python `json.loads` / `json.dumps` (CPython 3.11, C scanner) semantics the
// dialect needs where JS JSON differs:
// - loads accepts NaN, Infinity and -Infinity; refuses a leading BOM; raises
//   JSONDecodeError with CPython's `msg` texts and code-point positions; and
//   raises ValueError past CPython's int digit limit. Integers are JS numbers,
//   so values beyond 2^53 lose precision and `1.0` reads as `1`.
// - dumps writes `", "` / `": "` separators, keeps insertion order, writes
//   non-ASCII raw (ensure_ascii=False, lone surrogates included), Python float
//   spellings, and NaN / Infinity. An integral number is written as an int.

import { PyValueError } from './errors';
import { INT_MAX_STR_DIGITS, intDigitLimitMessage, setOwn } from './pyStr';

export class JSONDecodeError extends PyValueError {
  override name = 'JSONDecodeError';
  /** The bare message, without the position. */
  readonly msg: string;
  /** Position in code points, as Python reports it. */
  readonly pos: number;
  readonly lineno: number;
  readonly colno: number;

  constructor(msg: string, doc: string, index: number) {
    const before = doc.slice(0, index);
    const pos = [...before].length;
    const lastNewline = before.lastIndexOf('\n');
    const lineno = before.split('\n').length;
    const colno = lastNewline < 0 ? pos + 1 : [...before.slice(lastNewline + 1)].length + 1;
    super(`${msg}: line ${lineno} column ${colno} (char ${pos})`);
    this.msg = msg;
    this.pos = pos;
    this.lineno = lineno;
    this.colno = colno;
  }
}

const WHITESPACE = new Set([' ', '\t', '\n', '\r']);
const ESCAPES: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};
const HEX4 = /^[0-9a-fA-F]{4}$/;

/** Thrown inside the scanner where CPython raises StopIteration ("Expecting value"). */
class StopIteration {
  constructor(readonly index: number) {}
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9';
}

class Scanner {
  constructor(readonly s: string) {}

  private skip(i: number): number {
    while (i < this.s.length && WHITESPACE.has(this.s.charAt(i))) i++;
    return i;
  }

  private fail(msg: string, index: number): never {
    throw new JSONDecodeError(msg, this.s, index);
  }

  /** CPython `scan_once_unicode`: the value at `i` and the index after it. */
  value(i: number): [unknown, number] {
    const s = this.s;
    if (i >= s.length) throw new StopIteration(i);
    const ch = s.charAt(i);
    if (ch === '"') return this.string(i + 1);
    if (ch === '{') return this.object(i + 1);
    if (ch === '[') return this.array(i + 1);
    if (ch === 'n' && s.startsWith('null', i)) return [null, i + 4];
    if (ch === 't' && s.startsWith('true', i)) return [true, i + 4];
    if (ch === 'f' && s.startsWith('false', i)) return [false, i + 5];
    if (ch === 'N' && s.startsWith('NaN', i)) return [Number.NaN, i + 3];
    if (ch === 'I' && s.startsWith('Infinity', i)) return [Number.POSITIVE_INFINITY, i + 8];
    if (ch === '-' && s.startsWith('-Infinity', i)) return [Number.NEGATIVE_INFINITY, i + 9];
    return this.number(i);
  }

  private number(start: number): [unknown, number] {
    const s = this.s;
    let i = start;
    if (s.charAt(i) === '-') i++;
    const first = s.charAt(i);
    if (first >= '1' && first <= '9') {
      while (isDigit(s[i])) i++;
    } else if (first === '0') {
      i++;
    } else {
      throw new StopIteration(start);
    }
    let isFloat = false;
    if (s.charAt(i) === '.' && isDigit(s[i + 1])) {
      isFloat = true;
      i += 2;
      while (isDigit(s[i])) i++;
    }
    if (s.charAt(i) === 'e' || s.charAt(i) === 'E') {
      const eStart = i;
      i++;
      if (s.charAt(i) === '+' || s.charAt(i) === '-') i++;
      const digitsStart = i;
      while (isDigit(s[i])) i++;
      if (i > digitsStart) isFloat = true;
      else i = eStart;
    }
    const raw = s.slice(start, i);
    if (isFloat) return [Number(raw), i];
    const digits = raw.startsWith('-') ? raw.length - 1 : raw.length;
    if (digits > INT_MAX_STR_DIGITS) throw new PyValueError(intDigitLimitMessage(digits));
    const value = Number(raw);
    return [value === 0 ? 0 : value, i];
  }

  /** CPython `scanstring_unicode`, strict: `end` is just after the opening quote. */
  private string(end: number): [string, number] {
    const s = this.s;
    const begin = end - 1;
    let out = '';
    let i = end;
    for (;;) {
      let next = i;
      let c = '';
      for (; next < s.length; next++) {
        c = s.charAt(next);
        if (c === '"' || c === '\\') break;
        if (c.charCodeAt(0) <= 0x1f) this.fail('Invalid control character at', next);
      }
      if (next >= s.length) this.fail('Unterminated string starting at', begin);
      out += s.slice(i, next);
      next++;
      if (c === '"') return [out, next];
      if (next === s.length) this.fail('Unterminated string starting at', begin);
      const esc = s.charAt(next);
      if (esc !== 'u') {
        const mapped = ESCAPES[esc];
        if (mapped === undefined) this.fail('Invalid \\escape', next - 1);
        out += mapped;
        i = next + 1;
        continue;
      }
      next++;
      let after = next + 4;
      if (after >= s.length) this.fail('Invalid \\uXXXX escape', next - 1);
      const hex = s.slice(next, after);
      if (!HEX4.test(hex)) this.fail('Invalid \\uXXXX escape', after - 5);
      let code = Number.parseInt(hex, 16);
      if (code >= 0xd800 && code <= 0xdbff && after + 6 < s.length) {
        if (s.charAt(after) === '\\' && s.charAt(after + 1) === 'u') {
          const low = s.slice(after + 2, after + 6);
          if (!HEX4.test(low)) this.fail('Invalid \\uXXXX escape', after + 1);
          const code2 = Number.parseInt(low, 16);
          if (code2 >= 0xdc00 && code2 <= 0xdfff) {
            code = 0x10000 + ((code - 0xd800) << 10) + (code2 - 0xdc00);
            after += 6;
          }
        }
      }
      out += String.fromCodePoint(code);
      i = after;
    }
  }

  private object(start: number): [Record<string, unknown>, number] {
    const s = this.s;
    const obj: Record<string, unknown> = {};
    let i = this.skip(start);
    if (i >= s.length || s.charAt(i) !== '}') {
      for (;;) {
        if (i >= s.length || s.charAt(i) !== '"') {
          this.fail('Expecting property name enclosed in double quotes', i);
        }
        const [key, afterKey] = this.string(i + 1);
        i = this.skip(afterKey);
        if (i >= s.length || s.charAt(i) !== ':') this.fail("Expecting ':' delimiter", i);
        i = this.skip(i + 1);
        const [val, afterVal] = this.value(i);
        setOwn(obj, key, val);
        i = this.skip(afterVal);
        if (i < s.length && s.charAt(i) === '}') break;
        if (i >= s.length || s.charAt(i) !== ',') this.fail("Expecting ',' delimiter", i);
        i = this.skip(i + 1);
      }
    }
    return [obj, i + 1];
  }

  private array(start: number): [unknown[], number] {
    const s = this.s;
    const arr: unknown[] = [];
    let i = this.skip(start);
    if (i >= s.length || s.charAt(i) !== ']') {
      for (;;) {
        const [val, afterVal] = this.value(i);
        arr.push(val);
        i = this.skip(afterVal);
        if (i < s.length && s.charAt(i) === ']') break;
        if (i >= s.length || s.charAt(i) !== ',') this.fail("Expecting ',' delimiter", i);
        i = this.skip(i + 1);
      }
    }
    return [arr, i + 1];
  }

  /** `json.loads(s)`. */
  decode(): unknown {
    const s = this.s;
    if (s.startsWith('\ufeff')) this.fail('Unexpected UTF-8 BOM (decode using utf-8-sig)', 0);
    const start = this.skip(0);
    let value: unknown;
    let end: number;
    try {
      [value, end] = this.value(start);
    } catch (err) {
      if (err instanceof StopIteration) this.fail('Expecting value', err.index);
      throw err;
    }
    end = this.skip(end);
    if (end !== s.length) this.fail('Extra data', end);
    return value;
  }
}

/** Python `json.loads(text)`. */
export function pyJsonLoads(text: string): unknown {
  return new Scanner(text).decode();
}

/** Python `repr(float)` for a finite, non-integral number. */
function floatRepr(v: number): string {
  const [mantissa = '', exp = '0'] = v.toExponential().split('e');
  const exponent = Number(exp);
  if (exponent < -4 || exponent >= 16) {
    const sign = exponent < 0 ? '-' : '+';
    return `${mantissa}e${sign}${String(Math.abs(exponent)).padStart(2, '0')}`;
  }
  return String(v);
}

const SHORT_ESCAPES: Record<string, string> = {
  '"': '\\"',
  '\\': '\\\\',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
  '\b': '\\b',
  '\f': '\\f',
};

/** Escapes control characters, quote and backslash only (json.encoder.ESCAPE). */
function dumpString(s: string): string {
  let out = '"';
  for (const ch of s) {
    const short = SHORT_ESCAPES[ch];
    if (short !== undefined) out += short;
    else if (ch < ' ') out += `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`;
    else out += ch;
  }
  return `${out}"`;
}

function dumpNumber(v: number): string {
  if (Number.isNaN(v)) return 'NaN';
  if (v === Number.POSITIVE_INFINITY) return 'Infinity';
  if (v === Number.NEGATIVE_INFINITY) return '-Infinity';
  if (Number.isInteger(v)) return BigInt(v).toString();
  return floatRepr(v);
}

/**
 * Python `json.dumps(value, ensure_ascii=False)` for JSON-shaped values; with
 * `indent`, `json.dumps(value, indent=indent, ensure_ascii=False)` (items on
 * their own lines, `","` item separator, empty containers as `[]` / `{}`).
 */
export function pyJsonDumps(value: unknown, indent?: number): string {
  return dump(value, indent, 0);
}

function dump(value: unknown, indent: number | undefined, level: number): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return dumpString(value);
    case 'number':
      return dumpNumber(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'object': {
      const isList = Array.isArray(value);
      const items = isList
        ? value.map((v) => dump(v, indent, level + 1))
        : Object.entries(value as Record<string, unknown>).map(
            ([k, v]) => `${dumpString(k)}: ${dump(v, indent, level + 1)}`,
          );
      const [open, close] = isList ? ['[', ']'] : ['{', '}'];
      if (indent === undefined) return `${open}${items.join(', ')}${close}`;
      if (items.length === 0) return `${open}${close}`;
      const inner = `\n${' '.repeat(indent * (level + 1))}`;
      const outer = `\n${' '.repeat(indent * level)}`;
      return `${open}${inner}${items.join(`,${inner}`)}${outer}${close}`;
    }
    default:
      throw new TypeError(`Object of type ${typeof value} is not JSON serializable`);
  }
}
