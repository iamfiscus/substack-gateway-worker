import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canon';
import { goldenNames, readGolden } from './golden';

describe('canonicalJson', () => {
  it('uses Python json.dumps separators and sorted keys', () => {
    expect(canonicalJson({ b: [1, 2, { d: null, c: true }], a: {}, e: [] })).toBe(
      '{"a": {}, "b": [1, 2, {"c": true, "d": null}], "e": []}',
    );
  });

  it('writes non-ASCII raw and escapes like Python', () => {
    expect(canonicalJson('é 日本 😀   \x7f "\\\n\r\t\b\f\x01\x1f')).toBe(
      '"é 日本 😀   \x7f \\"\\\\\\n\\r\\t\\b\\f\\u0001\\u001f"',
    );
  });

  it('sorts keys by code point, not UTF-16 unit', () => {
    expect(canonicalJson({ '😀': 1, ｚ: 2, a: 3 })).toBe('{"a": 3, "ｚ": 2, "😀": 1}');
    expect(readGolden('draft-doc', 'pyjs-sort-keys-astral')).toBe(
      '{"content": [{"attrs": {"a": 3, "ｚ": 2, "😀": 1}, "type": "x"}], "type": "doc"}',
    );
  });

  it('formats numbers like Python repr', () => {
    expect(canonicalJson([0, -7, 1200, 0.08, 0.125, 1e-5, -1.5e-7, 2 ** 60])).toBe(
      '[0, -7, 1200, 0.08, 0.125, 1e-05, -1.5e-07, 1152921504606846976]',
    );
    expect(canonicalJson([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])).toBe(
      '[NaN, Infinity, -Infinity]',
    );
  });

  it('drops undefined members and rejects non-JSON values', () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b": 1}');
    expect(() => canonicalJson(() => 1)).toThrow(TypeError);
  });

  it('reproduces every note golden from its parsed JSON', () => {
    const names = goldenNames('note');
    expect(names.length).toBeGreaterThan(500);
    for (const name of names) {
      const golden = readGolden('note', name);
      expect(canonicalJson(JSON.parse(golden)), name).toBe(golden);
    }
  });
});
