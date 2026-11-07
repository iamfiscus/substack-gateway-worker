// Port of upstream packages/gateway_drafts/src/gateway_drafts/converters/dialect/attrs.py
// (bc2e875): the attribute defaults table and `{key=value}` attribute blocks.
//
// Substack ProseMirror nodes carry many attributes that are almost always at
// their default value. The dialect omits attributes equal to the default
// (`diffFromDefaults`) and restores them when parsing (`fillDefaults`).
// Attributes that differ are written in an attribute block: whitespace-separated
// `key` / `key=value` items.
//
// Python semantics kept: whitespace is `str.isspace()`, an unquoted integer is
// `-?\d+` with Unicode digits (read like `int()`, digit limit included), and
// quoted JSON is read and written like Python's `json`. Keys go in as own data
// properties, so `__proto__` is an ordinary key. Known JS limits: integers past
// 2^53 lose precision, `1.0` and `1` are the same number (both are an int here),
// and integer-like keys ("1") come first in JS object order.

import { DraftMarkdownError } from './errors';
import { JSONDecodeError, pyJsonDumps, pyJsonLoads, setOwn } from './pyJson';
import { pyRepr } from './pyRepr';
import { isSpace, PY_SPACE, PyValueError, pyIntFromDigits } from './pyStr';

export type Attrs = Record<string, unknown>;

// Real draft documents nest a few dozen levels at most. The explicit bound keeps
// deeply nested input an error everywhere (and well inside the JS stack).
export const MAX_JSON_DEPTH = 200;

/**
 * Python `json.loads` that refuses arrays/objects nested deeper than
 * MAX_JSON_DEPTH. Throws PyValueError (not JSONDecodeError) when the bound is
 * exceeded, and JSONDecodeError / PyValueError as Python's `json` does.
 */
export function loadsBoundedJson(text: string): unknown {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const char of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    } else if (char === '[' || char === '{') {
      depth += 1;
      if (depth > MAX_JSON_DEPTH) {
        throw new PyValueError(`JSON nested deeper than ${MAX_JSON_DEPTH} levels`);
      }
    } else if (char === ']' || char === '}') {
      depth -= 1;
    }
  }
  return pyJsonLoads(text);
}

const IMAGE2_NONE_KEYS = [
  'srcNoWatermark',
  'fullscreen',
  'imageSize',
  'height',
  'width',
  'resizeWidth',
  'bytes',
  'alt',
  'title',
  'type',
  'href',
  'internalRedirect',
  'align',
];
const IMAGE2_FALSE_KEYS = ['belowTheFold', 'topImage', 'isProcessing', 'offset'];

export const NODE_DEFAULTS: Readonly<Record<string, Readonly<Attrs>>> = {
  paragraph: { textAlign: null },
  heading: { level: 1, textAlign: null },
  image2: {
    ...Object.fromEntries(IMAGE2_NONE_KEYS.map((key) => [key, null])),
    ...Object.fromEntries(IMAGE2_FALSE_KEYS.map((key) => [key, false])),
  },
  button: { action: null, class: null },
  highlighted_code_block: { language: null, nodeId: null },
  latex_block: {},
  pullquote: { align: null, color: null },
  ordered_list: { start: 1, type: null, order: 1 },
};

export const MARK_DEFAULTS: Readonly<Record<string, Readonly<Attrs>>> = {
  link: {
    target: '_blank',
    rel: 'noopener noreferrer nofollow',
    class: null,
  },
};

function defaultsFor(kind: string): Readonly<Attrs> {
  if (Object.hasOwn(NODE_DEFAULTS, kind)) return NODE_DEFAULTS[kind] as Attrs;
  if (Object.hasOwn(MARK_DEFAULTS, kind)) return MARK_DEFAULTS[kind] as Attrs;
  return {};
}

/** The defaults for `kind` overlaid with `attrs` (unknown keys kept). */
export function fillDefaults(kind: string, attrs: Attrs): Attrs {
  // The defaults are all primitives, so a shallow copy cannot alias the table.
  return { ...defaultsFor(kind), ...attrs };
}

/** Only the keys absent from the defaults or with a different value. */
export function diffFromDefaults(kind: string, attrs: Attrs): Attrs {
  const defaults = defaultsFor(kind);
  const out: Attrs = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (!Object.hasOwn(defaults, key) || !same(defaults[key], value)) setOwn(out, key, value);
  }
  return out;
}

// Python compares by type too (`False == 0` there); the defaults are primitives,
// so strict equality is the same test.
function same(a: unknown, b: unknown): boolean {
  return a === b;
}

const INT = /^-?\p{Nd}+$/u;
const NEEDS_QUOTES = new RegExp(`[${PY_SPACE}"'{}=]`);
const KEY_FORBIDDEN = NEEDS_QUOTES;

/** Parse the inside of an attribute block (without the braces). */
export function parseAttrBlock(text: string): Attrs {
  const attrs: Attrs = {};
  let pos = 0;
  const length = text.length;
  while (pos < length) {
    if (isSpace(text.charAt(pos))) {
      pos += 1;
      continue;
    }
    const start = pos;
    while (pos < length && !isSpace(text.charAt(pos)) && text.charAt(pos) !== '=') pos += 1;
    const key = text.slice(start, pos);
    if (!key) {
      throw new DraftMarkdownError(`attribute block: missing key before '=' in ${pyRepr(text)}`);
    }
    if (pos >= length || isSpace(text.charAt(pos))) {
      setOwn(attrs, key, true);
      continue;
    }
    pos += 1; // consume "="
    if (pos >= length || isSpace(text.charAt(pos))) {
      throw new DraftMarkdownError(`attribute block: missing value for '${key}'`);
    }
    const [value, end] = parseValue(text, pos, key);
    setOwn(attrs, key, value);
    pos = end;
  }
  return attrs;
}

function parseValue(text: string, pos: number, key: string): [unknown, number] {
  const quote = text.charAt(pos);
  if (quote !== '"' && quote !== "'") {
    let end = pos;
    while (end < text.length && !isSpace(text.charAt(end))) end += 1;
    return [typedLiteral(text.slice(pos, end), key), end];
  }
  const [inner, end] = readQuoted(text, pos, key);
  if (end < text.length && !isSpace(text.charAt(end))) {
    throw new DraftMarkdownError(`attribute block: unexpected text after quoted value of '${key}'`);
  }
  if (quote === '"') return [inner, end];
  try {
    return [loadsBoundedJson(inner), end];
  } catch (err) {
    if (err instanceof JSONDecodeError) {
      throw new DraftMarkdownError(`attribute block: invalid JSON for '${key}': ${err.msg}`);
    }
    if (err instanceof PyValueError) {
      // e.g. too deep or huge numbers
      throw new DraftMarkdownError(
        `attribute block: JSON for '${key}' cannot be read: ${err.message}`,
      );
    }
    throw err;
  }
}

/** Read a quoted value starting at `text[pos]`: [unescaped text, index after]. */
function readQuoted(text: string, start: number, key: string): [string, number] {
  const quote = text.charAt(start);
  let pos = start + 1;
  let out = '';
  while (pos < text.length) {
    const char = text.charAt(pos);
    if (char === quote) return [out, pos + 1];
    if (char === '\\' && pos + 1 < text.length) {
      const next = text.charAt(pos + 1);
      if (quote === '"' && (next === '"' || next === '\\')) out += next;
      else if (quote === "'" && next === "'") out += next;
      else out += char + next;
      pos += 2;
      continue;
    }
    out += char;
    pos += 1;
  }
  throw new DraftMarkdownError(`attribute block: unterminated ${quote} quote for '${key}'`);
}

const KEYWORDS = new Map<string, unknown>([
  ['true', true],
  ['false', false],
  ['null', null],
]);

function typedLiteral(raw: string, key: string): unknown {
  if (KEYWORDS.has(raw)) return KEYWORDS.get(raw);
  if (INT.test(raw)) {
    try {
      return pyIntFromDigits(raw);
    } catch (err) {
      if (!(err instanceof PyValueError)) throw err;
      // past Python's int <-> str digit limit
      throw new DraftMarkdownError(
        `attribute block: integer value of '${key}' is too long (${err.message})`,
      );
    }
  }
  return raw;
}

/** Whether unquoted `raw` would parse as something other than a string. */
function readsAsLiteral(raw: string): boolean {
  return KEYWORDS.has(raw) || INT.test(raw);
}

/** Format `attrs` as `{k=v ...}`; an empty mapping gives `""`. */
export function formatAttrBlock(attrs: Attrs): string {
  const entries = Object.entries(attrs);
  if (entries.length === 0) return '';
  const parts: string[] = [];
  for (const [key, value] of entries) {
    if (!key || KEY_FORBIDDEN.test(key)) {
      throw new DraftMarkdownError(`attribute block: invalid key ${pyRepr(key)}`);
    }
    parts.push(`${key}=${formatValue(value)}`);
  }
  return `{${parts.join(' ')}}`;
}

function formatValue(value: unknown): string {
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (value === null) return 'null';
  if (typeof value === 'number' && Number.isInteger(value)) return BigInt(value).toString();
  if (typeof value === 'string') return formatString(value);
  return formatJson(value);
}

function formatString(value: string): string {
  if (value.includes('\n') || value.includes('\r')) return formatJson(value);
  if (!value || NEEDS_QUOTES.test(value) || readsAsLiteral(value)) {
    const escaped = value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
    return `"${escaped}"`;
  }
  return value;
}

function formatJson(value: unknown): string {
  let encoded: string;
  try {
    encoded = pyJsonDumps(value);
  } catch (err) {
    throw new DraftMarkdownError(
      `attribute block: value is not JSON-serialisable: ${(err as Error).message}`,
    );
  }
  return `'${encoded.replaceAll("'", "\\'")}'`;
}
