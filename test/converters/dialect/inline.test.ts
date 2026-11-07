// Port of upstream packages/gateway_drafts/tests/test_dialect_inline.py (bc2e875).
// The randomised tests use their own seeded generator (not Python's Mersenne
// Twister), so they draw different cases from the same distribution.

import { describe, expect, it } from 'vitest';
import {
  escapeText,
  type Node,
  parseInline,
  serializeInline,
} from '../../../src/converters/dialect/inline';
import { PY_SPACE } from '../../../src/converters/dialect/pyStr';
import { goldenInput, goldenNames, readGolden } from '../../support/golden';
import { t } from './helpers';

function roundTrip(content: Node[]): Node[] {
  const md = serializeInline(content);
  expect(md).not.toBeNull();
  return parseInline(md as string);
}

describe('inline (test_dialect_inline.py)', () => {
  it('testBoldLinkRoundTrips', () => {
    const content = [t('see '), t('docs', 'strong', { href: 'https://x' })];
    expect(roundTrip(content)).toStrictEqual(content);
  });

  it('testBoldItalicAndStrike', () => {
    const content = [t('a', 'strong', 'em'), t(' b '), t('c', 'strikethrough')];
    expect(roundTrip(content)).toStrictEqual(content);
  });

  it('testWhitespaceInsideMarkIsKept', () => {
    const content = [t('x'), t(' bold ', 'strong'), t('y')];
    expect(roundTrip(content)).toStrictEqual(content);
  });

  it('testLiteralTokensStayText', () => {
    for (const raw of [
      'a * b',
      'use ::button here',
      'x {size=large}',
      'path\\to',
      '~~not~~ struck?',
    ]) {
      const content = [t(raw)];
      expect(roundTrip(content)).toStrictEqual(content);
    }
  });

  it('testInexpressibleReturnsNone', () => {
    expect(serializeInline([t('u', 'underline')])).toBeNull();
    expect(serializeInline([t('c', 'code', 'strong')])).toBeNull();
    expect(serializeInline([{ type: 'footnoteAnchor', attrs: { number: 1 } }])).toBeNull();
    const odd = t('l', { href: 'https://x' });
    (odd.marks?.[0]?.attrs as Record<string, unknown>).rel = null;
    expect(serializeInline([odd])).toBeNull();
  });

  it('testEmojiUntouched', () => {
    expect(roundTrip([t('🔁 share')])).toStrictEqual([t('🔁 share')]);
  });

  // --- beyond the brief -------------------------------------------------------

  it('testEscapeTextEscapesExactlyTheDialectSet', () => {
    expect(escapeText('\\*`[]~{}')).toBe('\\\\\\*\\`\\[\\]\\~\\{\\}');
    expect(escapeText('a_b (c) #d !e :f |g >h')).toBe('a_b (c) #d !e :f |g >h');
  });

  it('testBackslashEscapesAnyAsciiPunctuation', () => {
    expect(parseInline('\\#\\_\\(\\!')).toStrictEqual([t('#_(!')]);
    // Not punctuation (or at the end): the backslash is literal.
    expect(parseInline('\\a \\é x\\')).toStrictEqual([t('\\a \\é x\\')]);
  });

  it('testDialectParserAcceptsInnerWhitespace', () => {
    expect(parseInline('a** x **b')).toStrictEqual([t('a'), t(' x ', 'strong'), t('b')]);
    expect(parseInline('x~~ y ~~z')).toStrictEqual([t('x'), t(' y ', 'strikethrough'), t('z')]);
  });

  it.each([
    'a ** b',
    '**open',
    '*a',
    '~~a',
    '~a~',
    '[a](x',
    '[a]',
    '[a] (x)',
    '`a',
    '``',
    ']',
    '**a *b**',
    '[**a](x)**',
    '***',
    '\\',
    '',
  ])('testParseNeverRaisesAndUnmatchedIsLiteral %j', (raw) => {
    for (const node of parseInline(raw)) {
      expect(node.type).toBe('text');
      expect(node.text).toBeTruthy();
    }
  });

  it('testUnmatchedDelimitersAreLiteralText', () => {
    expect(parseInline('a ** b')).toStrictEqual([t('a ** b')]);
    expect(parseInline('**open')).toStrictEqual([t('**open')]);
    expect(parseInline('[a](x')).toStrictEqual([t('[a](x')]);
    expect(parseInline('`a')).toStrictEqual([t('`a')]);
    expect(parseInline('')).toStrictEqual([]);
  });

  it('testCodeIsLiteralAndRoundTrips', () => {
    const content = [t('run '), t('a*b\\c[d]', 'code'), t(' now')];
    expect(serializeInline(content)).toBe('run `a*b\\c[d]` now');
    expect(roundTrip(content)).toStrictEqual(content);
  });

  it('testCodeContainingBacktickIsNotExpressible', () => {
    expect(serializeInline([t('a`b', 'code')])).toBeNull();
  });

  it('testLinkHrefWithParenthesesAndBackslash', () => {
    const href = 'https://en.wikipedia.org/wiki/A_(b)\\c';
    const content = [t('wiki', { href }), t(' (more)')];
    expect(roundTrip(content)).toStrictEqual(content);
  });

  it('testAdjacentLinksWithDifferentHrefs', () => {
    const content = [t('a', { href: 'https://a' }), t('b', { href: 'https://b' })];
    expect(serializeInline(content)).toBe('[a](https://a)[b](https://b)');
    expect(roundTrip(content)).toStrictEqual(content);
  });

  it('testMarksSpanInsideOneLink', () => {
    const href = 'https://x';
    const content = [
      t('x ', { href }),
      t('bold', 'strong', { href }),
      t(' it', 'strong', 'em', { href }),
      t(' end', { href }),
    ];
    expect(serializeInline(content)).toBe('[x **bold* it*** end](https://x)');
    expect(roundTrip(content)).toStrictEqual(content);
  });

  it('testSharedMarksStayOpen', () => {
    const content = [t('a', 'strong'), t('b', 'strong', 'em'), t('c', 'strong')];
    expect(serializeInline(content)).toBe('**a*b*c**');
    expect(roundTrip(content)).toStrictEqual(content);
  });

  it.each([
    [[t('a', 'strong'), t('b', 'em')]],
    [[t('a', 'em'), t('b', 'strong')]],
    [[t('a', 'em'), t('b', 'strong', 'em')]],
    [[t('a', 'strong', 'em'), t('b', 'em')]],
    [[t('a*', 'strong'), t('b~', 'strikethrough')]],
    [[t('a\\', 'em'), t('*', 'strong')]],
    [[t('a', 'em', { href: 'https://x' }), t('b', 'strong', 'em', { href: 'https://x' })]],
  ])('testAdjacentDelimiterRunsRoundTrip %#', (content) => {
    expect(roundTrip(content)).toStrictEqual(content);
  });

  it('testLinkWithNonDefaultClassIsNotExpressible', () => {
    const node = t('l', { href: 'https://x' });
    (node.marks?.[0]?.attrs as Record<string, unknown>).class = 'button';
    expect(serializeInline([node])).toBeNull();
  });

  it('testLinkWithoutHrefIsNotExpressible', () => {
    const node = { type: 'text', text: 'l', marks: [{ type: 'link', attrs: {} }] };
    expect(serializeInline([node])).toBeNull();
  });

  it('testNonCanonicalContentFailsTheSelfCheck', () => {
    // em listed before strong: parseInline always emits strong first.
    expect(serializeInline([t('a', 'em', 'strong')])).toBeNull();
    // Adjacent nodes with identical marks: parseInline would merge them.
    expect(serializeInline([t('a', 'strong'), t('b', 'strong')])).toBeNull();
    // Empty text node.
    expect(serializeInline([t('')])).toBeNull();
  });

  it('testDuplicateOrMalformedMarksAreNotExpressible', () => {
    expect(serializeInline([t('a', 'strong', 'strong')])).toBeNull();
    expect(serializeInline([{ type: 'text', text: 'a', marks: ['strong'] }])).toBeNull();
    expect(serializeInline([{ type: 'text', text: 1 }])).toBeNull();
  });

  it('testRandomCanonicalContentIsExpressibleAndRoundTrips', () => {
    const rng = new Rng(20261018);
    for (let i = 0; i < 3000; i++) {
      const content = randomContent(rng);
      const md = serializeInline(content);
      expect(md, JSON.stringify(content)).not.toBeNull();
      expect(parseInline(md as string)).toStrictEqual(content);
    }
  });

  it('testParseNeverRaisesOnRandomDelimiterSoup', () => {
    const rng = new Rng(7);
    const soup = [...'a *~[]()`\\'];
    for (let i = 0; i < 3000; i++) {
      const length = rng.randint(0, 12);
      const text = Array.from({ length }, () => rng.choice(soup)).join('');
      for (const node of parseInline(text)) {
        expect(node.type === 'text' && Boolean(node.text)).toBe(true);
      }
    }
  });

  it('testManyUnterminatedLinkTargetsParseInLinearTime', () => {
    // Each "](" without a closing ")" used to rescan to the end of the text.
    const raw = '[a]('.repeat(20000);
    expect(parseInline(raw)).toStrictEqual([t(raw)]);
  });

  it('testSpacedMarkedTextIsTheOnlyReasonForNone', () => {
    const rng = new Rng(11);
    for (let i = 0; i < 3000; i++) {
      const content = randomContent(rng, true);
      if (serializeInline(content) === null) {
        const spaced = content.some(
          (node) =>
            node.marks &&
            node.marks.length > 0 &&
            node.text !== (node.text as string).trim() &&
            node.marks[0]?.type !== 'code',
        );
        expect(spaced, JSON.stringify(content)).toBe(true);
      }
    }
  });

  // --- review fix round 1 -----------------------------------------------------

  it('testBracketWithoutTargetDoesNotSwallowALaterLink', () => {
    expect(parseInline('Note [1]: see [the docs](https://x) now')).toStrictEqual([
      t('Note [1]: see '),
      t('the docs', { href: 'https://x' }),
      t(' now'),
    ]);
  });

  it('testStrayOpenBracketBeforeALinkIsLiteral', () => {
    expect(parseInline('see [a [docs](https://x)')).toStrictEqual([
      t('see [a '),
      t('docs', { href: 'https://x' }),
    ]);
  });

  it('testLinkClosingInsideOpenMarkMakesTheMarkLiteral', () => {
    expect(parseInline('[**a](https://x)')).toStrictEqual([t('**a', { href: 'https://x' })]);
  });

  it('testLinkTargetAllowsBalancedParentheses', () => {
    expect(parseInline('[wiki](https://en.wikipedia.org/wiki/A_(b)) ok')).toStrictEqual([
      t('wiki', { href: 'https://en.wikipedia.org/wiki/A_(b)' }),
      t(' ok'),
    ]);
  });

  it('testLinkTargetWithUnbalancedParenthesesIsNotALink', () => {
    expect(parseInline('[a](x(y) z')).toStrictEqual([t('[a](x(y) z')]);
  });

  it('testLinkTitleDoesNotLandInTheHref', () => {
    expect(parseInline('[a](https://x "T")')).toStrictEqual([t('[a](https://x "T")')]);
  });

  it('testHrefWithWhitespaceIsNotExpressible', () => {
    expect(serializeInline([t('a', { href: 'https://x y' })])).toBeNull();
  });

  it('testSpacedDelimiterRunsAreLiteral', () => {
    expect(parseInline('2 * 3 * 4 = 24')).toStrictEqual([t('2 * 3 * 4 = 24')]);
    expect(parseInline('a ** b ** c')).toStrictEqual([t('a ** b ** c')]);
    expect(parseInline('x ~~ y ~~ z')).toStrictEqual([t('x ~~ y ~~ z')]);
    expect(parseInline('* a *')).toStrictEqual([t('* a *')]);
  });

  it('testSerializerOutputHittingTheSpacedRuleReturnsNone', () => {
    // Would be written "a * b*": the first run has spaces on both sides.
    expect(serializeInline([t('a '), t(' b', 'em')])).toBeNull();
  });

  it('testEmWrappingStrong', () => {
    expect(parseInline('*a **b** c*')).toStrictEqual([
      t('a ', 'em'),
      t('b', 'strong', 'em'),
      t(' c', 'em'),
    ]);
    expect(parseInline('***a** b*')).toStrictEqual([t('a', 'strong', 'em'), t(' b', 'em')]);
  });

  it('testManyOpenBracketsThenClosingBracketsParseInLinearTime', () => {
    const raw = '['.repeat(30000) + ']'.repeat(30000);
    expect(parseInline(raw)).toStrictEqual([t(raw)]);
  });

  it('testLongAsteriskRunBeforeLongTextParsesInLinearTime', () => {
    const raw = `${'*'.repeat(30000)}${'a'.repeat(30000)}*`;
    const text = parseInline(raw)
      .map((node) => node.text)
      .join('');
    expect(text.split('a').length - 1).toBe(30000);
  });

  it('testLongRunOfUnclosedLinkOpenersIsOneTextNode', () => {
    // Every "[" is demoted to text, so 400k pieces merge into one node.
    const text = '[a'.repeat(200_000);
    expect(parseInline(text)).toStrictEqual([{ type: 'text', text }]);
  });
});

describe('inline: Python semantics', () => {
  it('treats Python whitespace, not JS whitespace, as spacing a delimiter run', () => {
    // U+001C is str.isspace() in Python; U+FEFF is not.
    expect(parseInline('a\x1c*\x1cb*')).toStrictEqual([t('a\x1c*\x1cb*')]);
    expect(parseInline('a﻿*﻿b*')).toStrictEqual([t('a﻿'), t('﻿b', 'em')]);
  });

  it('keeps astral characters whole next to delimiters and escapes', () => {
    expect(parseInline('*🔁*\\🔁')).toStrictEqual([t('🔁', 'em'), t('\\🔁')]);
  });
});

// The block layer strips a paragraph's outer whitespace and escapes line-start
// constructs, so these goldens isolate the inline layer only for single-line
// paragraphs with no outer whitespace.
// (A test-inline-* draft-doc golden is never one JSON.parse cannot read.)
const PY_OUTER_SPACE = new RegExp(`^[${PY_SPACE}]|[${PY_SPACE}]$`);
const INLINE_GOLDEN = /^test-inline-/;

type Doc = { type: string; content?: Node[] };

function singlePlainParagraph(doc: Doc): Node[] | null {
  const block = doc.content?.length === 1 ? doc.content[0] : undefined;
  if (block?.type !== 'paragraph' || Object.keys(block).length !== 3) return null;
  if (JSON.stringify(block.attrs) !== '{"textAlign":null}') return null;
  return block.content ?? null;
}

describe('inline goldens (upstream markdown_to_draft_doc / draft_body_to_markdown)', () => {
  const parsed = goldenNames('draft-doc').filter((name) => {
    if (!INLINE_GOLDEN.test(name)) return false;
    const md = goldenInput(name);
    if (/[\n\r]/.test(md) || PY_OUTER_SPACE.test(md)) return false;
    // Skip lines the block layer reads as something else (e.g. "* a" is a list).
    return singlePlainParagraph(JSON.parse(readGolden('draft-doc', name)) as Doc) !== null;
  });
  const written = goldenNames('input-doc').filter((name) => INLINE_GOLDEN.test(name));

  it('covers the inline goldens', () => {
    expect(parsed.length).toBeGreaterThan(40);
    expect(written.length).toBeGreaterThan(70);
  });

  it.each(parsed)('parseInline %s', (name) => {
    const content = singlePlainParagraph(JSON.parse(readGolden('draft-doc', name)) as Doc);
    expect(parseInline(goldenInput(name))).toStrictEqual(content);
  });

  it.each(written)('serializeInline %s', (name) => {
    const content = singlePlainParagraph(JSON.parse(readGolden('input-doc', name)) as Doc);
    const out = readGolden('draft-md', `doc-${name}`, 'md');
    const md = content && serializeInline(content);
    if (md && !PY_OUTER_SPACE.test(md)) expect(out).toBe(`${md}\n`);
    else expect(out.startsWith('```substack-node\n')).toBe(true);
  });
});

// --- random content ------------------------------------------------------------

/** Small seeded generator (mulberry32) with the random.Random calls the tests use. */
class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  random(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let x = this.state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  }

  /** Inclusive on both ends, like Python's randint. */
  randint(a: number, b: number): number {
    return a + Math.floor(this.random() * (b - a + 1));
  }

  choice<T>(items: readonly T[]): T {
    return items[Math.floor(this.random() * items.length)] as T;
  }
}

const ALPHABET = [...'ab \\*`[]~{}()_#!:é🔁'];
const MARK_SETS: string[][] = [
  [],
  ['strong'],
  ['em'],
  ['strikethrough'],
  ['strong', 'em'],
  ['strong', 'strikethrough'],
  ['em', 'strikethrough'],
  ['strong', 'em', 'strikethrough'],
];

function randomContent(rng: Rng, spacedMarks = false): Node[] {
  const content: Node[] = [];
  const count = rng.randint(1, 6);
  for (let i = 0; i < count; i++) {
    const length = rng.randint(1, 4);
    let node: Node;
    if (rng.random() < 0.15) {
      const alphabet = ALPHABET.filter((c) => c !== '`');
      const text = Array.from({ length }, () => rng.choice(alphabet)).join('');
      node = t(text, 'code');
    } else {
      let text = Array.from({ length }, () => rng.choice(ALPHABET)).join('');
      const href = rng.choice([undefined, undefined, 'https://x', 'https://y/(z)']);
      const marks = rng.choice(MARK_SETS);
      if (marks.length > 0 && !spacedMarks) {
        // A delimiter run with whitespace on both sides is literal, so keep
        // marked text from starting or ending with whitespace (the alphabet's
        // only whitespace is " ", where trim() and Python strip() agree).
        text = text.trim() || 'a';
      }
      node = t(text, ...marks, { href });
    }
    const last = content.at(-1);
    if (last && JSON.stringify(last.marks) === JSON.stringify(node.marks)) {
      last.text = `${last.text}${node.text}`;
    } else {
      content.push(node);
    }
  }
  return content;
}
