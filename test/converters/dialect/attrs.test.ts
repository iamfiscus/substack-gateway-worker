// Port of upstream packages/gateway_drafts/tests/test_dialect_attrs.py (bc2e875),
// plus exact error messages taken from upstream (the upstream tests only check
// that these raise).

import { describe, expect, it } from 'vitest';
import {
  diffFromDefaults,
  fillDefaults,
  formatAttrBlock,
  loadsBoundedJson,
  MARK_DEFAULTS,
  MAX_JSON_DEPTH,
  NODE_DEFAULTS,
  parseAttrBlock,
} from '../../../src/converters/dialect/attrs';
import { DraftMarkdownError } from '../../../src/converters/dialect/errors';

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected an exception');
}

function errorMessage(fn: () => unknown): string {
  const err = thrown(fn);
  expect(err).toBeInstanceOf(DraftMarkdownError);
  return (err as DraftMarkdownError).message;
}

describe('attrs (test_dialect_attrs.py)', () => {
  it('testParseTypedValues', () => {
    expect(parseAttrBlock('size=large width=1536 belowTheFold=false href=null x')).toStrictEqual({
      size: 'large',
      width: 1536,
      belowTheFold: false,
      href: null,
      x: true,
    });
  });

  it('testParseUnquotedEdgeValues', () => {
    expect(parseAttrBlock('a=true b=-5 c=1.5 d=TRUE e=12ab')).toStrictEqual({
      a: true,
      b: -5,
      c: '1.5',
      d: 'TRUE',
      e: '12ab',
    });
  });

  it('testParseEmptyAndWhitespace', () => {
    expect(parseAttrBlock('')).toStrictEqual({});
    expect(parseAttrBlock('   \t ')).toStrictEqual({});
    expect(parseAttrBlock('  a=1   b  ')).toStrictEqual({ a: 1, b: true });
  });

  it('testQuotedAndJsonValues', () => {
    expect(parseAttrBlock('title="a \\"b\\" c" meta=\'{"k": [1]}\'')).toStrictEqual({
      title: 'a "b" c',
      meta: { k: [1] },
    });
  });

  it('testDoubleQuotedBackslashAndUnknownEscape', () => {
    expect(parseAttrBlock(String.raw`p="C:\\dir" q="a\nb"`)).toStrictEqual({
      p: 'C:\\dir',
      q: 'a\\nb',
    });
  });

  it('testSingleQuotedJsonWithEscapedApostrophe', () => {
    expect(parseAttrBlock(String.raw`v='"it\'s"'`)).toStrictEqual({ v: "it's" });
    expect(parseAttrBlock(String.raw`v='"a\\"' w=1`)).toStrictEqual({ v: 'a\\', w: 1 });
  });

  it('testFormatRoundTrips', () => {
    const attrs = {
      title: 'two words',
      n: '123',
      flag: true,
      meta: { k: [1] },
      u: 'https://x/y.png',
    };
    expect(parseAttrBlock(formatAttrBlock(attrs).slice(1, -1))).toStrictEqual(attrs);
  });

  it('testFormatRoundTripsAwkwardValues', () => {
    const attrs = {
      empty: '',
      t: 'true',
      f: 'false',
      nul: 'null',
      neg: '-3',
      eq: 'a=b',
      braces: '{x}',
      dq: 'say "hi"',
      sq: "it's",
      bs: 'back\\slash',
      nl: 'line1\nline2',
      float: 1.5,
      none: null,
      off: false,
      num: 7,
      lst: [1, 'a', null],
      uni: 'zażółć gęślą',
    };
    const block = formatAttrBlock(attrs);
    expect(block).not.toContain('\n');
    expect(parseAttrBlock(block.slice(1, -1))).toStrictEqual(attrs);
  });

  it('testFormatShape', () => {
    expect(formatAttrBlock({})).toBe('');
    expect(formatAttrBlock({ a: true, b: null, c: 3, d: 'x y' })).toBe(
      '{a=true b=null c=3 d="x y"}',
    );
  });

  it('testFormatRejectsInvalidKey', () => {
    expect(() => formatAttrBlock({ 'bad key': 1 })).toThrow(DraftMarkdownError);
  });

  it.each(['a="unterminated', "a='[1", "a='{not json}'", 'a=', '=x', 'a="x"y', "a='1'z"])(
    'testMalformedBlocksRaise %s',
    (text) => {
      expect(() => parseAttrBlock(text)).toThrow(DraftMarkdownError);
    },
  );

  it.each([
    ['unquoted', `n=${'9'.repeat(5000)}`],
    ['negative', `n=-${'9'.repeat(5000)}`],
    ['json', `n='${'9'.repeat(5000)}'`],
  ])('testIntegerTooLongToConvertIsAMarkdownError %s', (_id, text) => {
    // Python refuses int <-> str conversion past 4300 digits (ValueError).
    expect(errorMessage(() => parseAttrBlock(text))).toContain("'n'");
  });

  it('testDeeplyNestedJsonValueIsAMarkdownError', () => {
    const text = `n='${'['.repeat(100_000)}${']'.repeat(100_000)}'`;
    expect(errorMessage(() => parseAttrBlock(text))).toContain("'n'");
  });

  it('testLongDigitStringIsQuotedWhenFormatted', () => {
    const value = '9'.repeat(5000);
    expect(formatAttrBlock({ n: value })).toBe(`{n="${value}"}`);
    expect(parseAttrBlock(formatAttrBlock({ n: value }).slice(1, -1))).toStrictEqual({ n: value });
  });

  it('testDiffAndFillAreInverse', () => {
    const full = fillDefaults('image2', { src: 's', imageSize: 'large' });
    expect(full.belowTheFold).toBe(false);
    expect(full.imageSize).toBe('large');
    expect(diffFromDefaults('image2', full)).toStrictEqual({ src: 's', imageSize: 'large' });
  });

  it('testUnknownKeySurvives', () => {
    expect(diffFromDefaults('paragraph', { textAlign: null, newKey: 1 })).toStrictEqual({
      newKey: 1,
    });
  });

  it('testFillDoesNotMutateTables', () => {
    const full = fillDefaults('heading', { level: 2 });
    full.extra = 1;
    expect(NODE_DEFAULTS.heading).toStrictEqual({ level: 1, textAlign: null });
    expect(full).toStrictEqual({ level: 2, textAlign: null, extra: 1 });
  });

  it('testUnknownKindHasNoDefaults', () => {
    expect(fillDefaults('nope', { a: 1 })).toStrictEqual({ a: 1 });
    expect(diffFromDefaults('nope', { a: 1 })).toStrictEqual({ a: 1 });
  });

  it('testDiffDistinguishesFalseFromZeroAndNone', () => {
    expect(diffFromDefaults('image2', { belowTheFold: 0, alt: '' })).toStrictEqual({
      belowTheFold: 0,
      alt: '',
    });
    expect(diffFromDefaults('ordered_list', { start: 1, order: 1, type: null })).toStrictEqual({});
  });

  it('testTablesContainExpectedKinds', () => {
    expect(new Set(Object.keys(NODE_DEFAULTS))).toStrictEqual(
      new Set([
        'paragraph',
        'heading',
        'image2',
        'button',
        'highlighted_code_block',
        'latex_block',
        'pullquote',
        'ordered_list',
      ]),
    );
    expect(NODE_DEFAULTS.latex_block).toStrictEqual({});
    expect(MARK_DEFAULTS.link).toStrictEqual({
      target: '_blank',
      rel: 'noopener noreferrer nofollow',
      class: null,
    });
    const image = NODE_DEFAULTS.image2 as Record<string, unknown>;
    expect(Object.keys(image)).toHaveLength(17);
    for (const k of ['srcNoWatermark', 'alt', 'href', 'align']) expect(image[k]).toBeNull();
    for (const k of ['belowTheFold', 'topImage', 'isProcessing', 'offset']) {
      expect(image[k]).toBe(false);
    }
  });

  it('testErrorMessageHasLine', () => {
    expect(String(new DraftMarkdownError('bad', 7))).toBe('DraftMarkdownError: line 7: bad');
    expect(new DraftMarkdownError('bad', 7).message).toBe('line 7: bad');
  });

  it('testErrorWithoutLine', () => {
    const err = new DraftMarkdownError('bad');
    expect(err.message).toBe('bad');
    expect(err.reason).toBe('bad');
    expect(err.line).toBeUndefined();
    expect(err).toBeInstanceOf(Error);
    expect(new DraftMarkdownError('x', 3).line).toBe(3);
    expect(new DraftMarkdownError('x', 3).reason).toBe('x');
  });

  it('testJsonNestingBoundIsIndependentOfThePythonVersion', () => {
    const ok = '['.repeat(MAX_JSON_DEPTH) + ']'.repeat(MAX_JSON_DEPTH);
    expect(parseAttrBlock(`n='${ok}'`).n).not.toBeNull();
    const tooDeep = '['.repeat(MAX_JSON_DEPTH + 1) + ']'.repeat(MAX_JSON_DEPTH + 1);
    expect(errorMessage(() => parseAttrBlock(`n='${tooDeep}'`))).toMatch(/nested deeper/);
    // brackets inside JSON strings do not count towards the depth
    expect(parseAttrBlock(`n='["${'['.repeat(500)}"]'`)).toStrictEqual({ n: ['['.repeat(500)] });
  });
});

describe('attrs: exact upstream messages', () => {
  // Messages produced by upstream bc2e875 for the same input.
  it.each([
    ['a="unterminated', "attribute block: unterminated \" quote for 'a'"],
    ["a='[1", "attribute block: unterminated ' quote for 'a'"],
    [
      "a='{not json}'",
      "attribute block: invalid JSON for 'a': Expecting property name enclosed in double quotes",
    ],
    ['a=', "attribute block: missing value for 'a'"],
    ['=x', "attribute block: missing key before '=' in '=x'"],
    ['a="x"y', "attribute block: unexpected text after quoted value of 'a'"],
    ["a='1'z", "attribute block: unexpected text after quoted value of 'a'"],
    [
      `n=${'9'.repeat(5000)}`,
      "attribute block: integer value of 'n' is too long (Exceeds the limit (4300 digits) for " +
        'integer string conversion: value has 5000 digits; use sys.set_int_max_str_digits() to ' +
        'increase the limit)',
    ],
    [
      `n=-${'9'.repeat(5000)}`,
      "attribute block: integer value of 'n' is too long (Exceeds the limit (4300 digits) for " +
        'integer string conversion: value has 5000 digits; use sys.set_int_max_str_digits() to ' +
        'increase the limit)',
    ],
    [
      `n='${'9'.repeat(5000)}'`,
      "attribute block: JSON for 'n' cannot be read: Exceeds the limit (4300 digits) for integer " +
        'string conversion: value has 5000 digits; use sys.set_int_max_str_digits() to increase ' +
        'the limit',
    ],
    [
      `n='${'['.repeat(201)}${']'.repeat(201)}'`,
      "attribute block: JSON for 'n' cannot be read: JSON nested deeper than 200 levels",
    ],
    ['=x é\'"', "attribute block: missing key before '=' in '=x é\\'\"'"],
    [String.raw`a='"\q"'`, "attribute block: invalid JSON for 'a': Invalid \\escape"],
    [String.raw`a='"\u12x4"'`, "attribute block: invalid JSON for 'a': Invalid \\uXXXX escape"],
    ["a='[1,]'", "attribute block: invalid JSON for 'a': Expecting value"],
    [`a='"x" y'`, "attribute block: invalid JSON for 'a': Extra data"],
  ])('parseAttrBlock(%j)', (text, message) => {
    expect(errorMessage(() => parseAttrBlock(text))).toBe(message);
  });

  it.each([
    ['bad key', "attribute block: invalid key 'bad key'"],
    ['', "attribute block: invalid key ''"],
    ['a=b', "attribute block: invalid key 'a=b'"],
    ["x'y", 'attribute block: invalid key "x\'y"'],
    ['é\u3000', "attribute block: invalid key 'é\\u3000'"],
  ])('formatAttrBlock key %j', (key, message) => {
    expect(errorMessage(() => formatAttrBlock({ [key]: 1 }))).toBe(message);
  });
});

describe('attrs: Python semantics', () => {
  it('reads Unicode decimal digits as integers, like Python int()', () => {
    expect(parseAttrBlock('a=١٢ b=𝟙𝟚 c=-٣')).toStrictEqual({ a: 12, b: 12, c: -3 });
    expect(parseAttrBlock('a=9_9 b=+9 c=-0')).toStrictEqual({ a: '9_9', b: '+9', c: 0 });
  });

  it('splits on Python whitespace, not JS whitespace', () => {
    // U+001C is str.isspace() in Python; U+FEFF is not (JS \s has it the other way).
    expect(parseAttrBlock('a=1\x1cb')).toStrictEqual({ a: 1, b: true });
    expect(parseAttrBlock('a=1\ufeffb')).toStrictEqual({ a: '1\ufeffb' });
    expect(formatAttrBlock({ a: 'x\x1cy', b: 'x\ufeffy' })).toBe('{a="x\x1cy" b=x\ufeffy}');
  });

  it('reads JSON like Python json.loads', () => {
    expect(parseAttrBlock("a='NaN' b='-Infinity' c='1e400'")).toStrictEqual({
      a: Number.NaN,
      b: Number.NEGATIVE_INFINITY,
      c: Number.POSITIVE_INFINITY,
    });
    expect(errorMessage(() => parseAttrBlock("a='\ufeff1'"))).toBe(
      "attribute block: invalid JSON for 'a': Unexpected UTF-8 BOM (decode using utf-8-sig)",
    );
  });

  it('keeps __proto__ as an ordinary key', () => {
    const attrs = parseAttrBlock('__proto__=x');
    expect(Object.keys(attrs)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(attrs)).toBe(Object.prototype);
    expect(formatAttrBlock(attrs)).toBe('{__proto__=x}');
    const json = parseAttrBlock(`a='{"__proto__": 1}'`).a as Record<string, unknown>;
    expect(Object.keys(json)).toEqual(['__proto__']);
  });

  it('formats JSON values like Python json.dumps', () => {
    expect(formatAttrBlock({ a: { b: [1, 2.5, null], c: "it's" }, d: 1e-7, e: Number.NaN })).toBe(
      `{a='{"b": [1, 2.5, null], "c": "it\\'s"}' d='1e-07' e='NaN'}`,
    );
    expect(formatAttrBlock({ a: 'x\ny' })).toBe(`{a='"x\\ny"'}`);
  });

  it('loadsBoundedJson counts depth outside strings only', () => {
    expect(loadsBoundedJson('{"a": "[[[["}')).toStrictEqual({ a: '[[[[' });
    expect(() => loadsBoundedJson('['.repeat(MAX_JSON_DEPTH + 1))).toThrow(
      `JSON nested deeper than ${MAX_JSON_DEPTH} levels`,
    );
  });
});
