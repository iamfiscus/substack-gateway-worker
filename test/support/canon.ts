// Canonical JSON, byte-identical to Python's
// `json.dumps(v, sort_keys=True, ensure_ascii=False)` (the `_canon` of upstream
// packages/gateway_drafts/tests/test_draft_round_trip.py at bc2e875), so TS
// converter output can be compared byte for byte with the goldens in
// test/fixtures/golden/.
//
// Matches Python on: the default `", "` / `": "` separators, keys sorted by code
// point (not UTF-16 unit), non-ASCII written raw, the same string escapes, and
// float formatting (`repr`: exponent below 1e-4 or from 1e16, two-digit
// exponent). JS cannot tell `1.0` from `1`: an integral number is always written
// as a Python int. `undefined` object members are dropped, as JSON.stringify does.

/** UTF-16 unit remapped so that comparing units orders strings by code point. */
function codePointRank(unit: number): number {
  if (unit >= 0xd800 && unit <= 0xdfff) return unit + 0x2000;
  if (unit >= 0xe000) return unit - 0x800;
  return unit;
}

function compareCodePoints(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a.charCodeAt(i);
    const y = b.charCodeAt(i);
    if (x !== y) return codePointRank(x) - codePointRank(y);
  }
  return a.length - b.length;
}

/** Python `repr(float)` for a finite, non-integral number. */
function pythonFloat(v: number): string {
  const [mantissa = '', exp = '0'] = v.toExponential().split('e');
  const exponent = Number(exp);
  if (exponent < -4 || exponent >= 16) {
    const sign = exponent < 0 ? '-' : '+';
    return `${mantissa}e${sign}${String(Math.abs(exponent)).padStart(2, '0')}`;
  }
  return String(v);
}

function canonNumber(v: number): string {
  if (Number.isNaN(v)) return 'NaN';
  if (v === Number.POSITIVE_INFINITY) return 'Infinity';
  if (v === Number.NEGATIVE_INFINITY) return '-Infinity';
  if (Number.isInteger(v)) return BigInt(v).toString();
  return pythonFloat(v);
}

export function canonicalJson(v: unknown): string {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'string':
      return JSON.stringify(v);
    case 'number':
      return canonNumber(v);
    case 'bigint':
      return v.toString();
    case 'boolean':
      return v ? 'true' : 'false';
    case 'object': {
      if (Array.isArray(v)) return `[${v.map(canonicalJson).join(', ')}]`;
      const entries = Object.entries(v as Record<string, unknown>)
        .filter(([, value]) => value !== undefined)
        .sort(([a], [b]) => compareCodePoints(a, b));
      const body = entries.map(([k, value]) => `${JSON.stringify(k)}: ${canonicalJson(value)}`);
      return `{${body.join(', ')}}`;
    }
    default:
      throw new TypeError(`canonicalJson: ${typeof v} is not JSON`);
  }
}
