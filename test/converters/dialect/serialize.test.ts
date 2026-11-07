// Port of upstream packages/gateway_drafts/tests/test_dialect_serialize.py
// (bc2e875), test names in camelCase, plus Python-semantics cases checked
// against upstream.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fillDefaults } from '../../../src/converters/dialect/attrs';
import { parseBlocks } from '../../../src/converters/dialect/blocks';
import type { Node } from '../../../src/converters/dialect/inline';
import { pyJsonDumps } from '../../../src/converters/dialect/pyJson';
import {
  Serializer,
  serializeDoc,
  setSerializerWarn,
} from '../../../src/converters/dialect/serialize';
import { docWithImage, p, t } from './helpers';

const HOSTED = 'https://substack-post-media.s3.amazonaws.com/public/images/a_1536x1024.png';
const FENCE = '```substack-node';

type AnyNode = Record<string, unknown>;

let warnings: string[] = [];
beforeEach(() => {
  warnings = [];
  setSerializerWarn((msg) => warnings.push(msg));
});
afterEach(() => setSerializerWarn(null));

function doc(...nodes: unknown[]): AnyNode {
  return { type: 'doc', content: nodes };
}

function roundtrip(...nodes: unknown[]): string {
  const md = serializeDoc(doc(...nodes));
  expect(parseBlocks(md)).toStrictEqual(nodes);
  return md;
}

function heading(text: string, level = 1, align: string | null = null): Node {
  return { type: 'heading', attrs: { level, textAlign: align }, content: [t(text)] };
}

function item(text: string, align: string | null = null): Node {
  return { type: 'list_item', content: [p(text, align)] };
}

function bullets(texts: string[], align: string | null = null): Node {
  return { type: 'bullet_list', content: texts.map((text) => item(text, align)) };
}

function ordered(texts: string[], attrs: AnyNode = {}): Node {
  return {
    type: 'ordered_list',
    attrs: fillDefaults('ordered_list', attrs),
    content: texts.map((text) => item(text)),
  };
}

function quote(...content: Node[]): Node {
  return { type: 'blockquote', content };
}

function pullquote(...content: Node[]): Node {
  return { type: 'pullquote', attrs: fillDefaults('pullquote', {}), content };
}

function code(text: string, language: string | null = null, attrs: AnyNode = {}): Node {
  const node: Node = {
    type: 'highlighted_code_block',
    attrs: fillDefaults('highlighted_code_block', { language, ...attrs }),
  };
  if (text) node.content = [{ type: 'text', text }];
  return node;
}

function latex(expression: string, latexId = 'ABCDEFGHIJ'): Node {
  return { type: 'latex_block', attrs: { persistentExpression: expression, id: latexId } };
}

function button(url: string, text: string): Node {
  return { type: 'button', attrs: fillDefaults('button', { url, text }) };
}

function image(attrs: AnyNode = {}): Node {
  return (docWithImage({ src: HOSTED, ...attrs }).content as Node[])[0] as Node;
}

function count(text: string, part: string): number {
  return text.split(part).length - 1;
}

// --- tests from the task brief ------------------------------------------------

describe('task brief', () => {
  it('defaultsLineAndException', () => {
    const md = serializeDoc(doc(p('A', 'justify'), p('B', 'justify'), p('C', 'right')));
    expect(md.split('\n')[0]).toBe('::defaults{align=justify}');
    expect(md).toContain(':::align{right}\nC\n:::');
  });

  it('watermarkedImageState', () => {
    const md = serializeDoc(
      docWithImage({
        src: 'https://substack-post-media.s3.amazonaws.com/public/images/w_1536x1024.png',
        srcNoWatermark:
          'https://substack-post-media.s3.amazonaws.com/public/images/o_1536x1024.png',
        imageSize: 'full',
        resizeWidth: null,
        align: 'center',
        fullscreen: false,
      }),
    );
    expect(md).toBe(
      '![H](https://substack-post-media.s3.amazonaws.com/public/images/w_1536x1024.png){size=full original=https://substack-post-media.s3.amazonaws.com/public/images/o_1536x1024.png}',
    );
  });

  it('unknownNodeFallsBack', () => {
    const node = { type: 'videoEmbed', attrs: { id: 'v' } };
    expect(serializeDoc(doc(node)).startsWith('```substack-node\n')).toBe(true);
  });

  it('nestedListFallsBack', () => {
    const nested = {
      type: 'bullet_list',
      content: [{ type: 'list_item', content: [p('a'), { type: 'bullet_list', content: [] }] }],
    };
    expect(serializeDoc(doc(nested))).toContain('```substack-node');
  });

  it('literalRuleParagraphIsEscaped', () => {
    const d = doc(p('---'));
    expect(parseBlocks(serializeDoc(d))).toStrictEqual(d.content);
  });
});

// --- defaults and alignment ---------------------------------------------------

describe('defaults and alignment', () => {
  it('noDefaultsLineWhenMostParagraphsAreUnaligned', () => {
    expect(roundtrip(p('A'), p('B'), p('C', 'center'))).toBe('A\n\nB\n\n:::align{center}\nC\n:::');
  });

  it('tiedAlignmentGivesNoDefaultsLine', () => {
    expect(roundtrip(p('A', 'justify'), p('B', 'center')).startsWith('::defaults')).toBe(false);
  });

  it('defaultsCountNestedParagraphs', () => {
    expect(roundtrip(p('A'), bullets(['x', 'y'], 'justify'))).toBe(
      '::defaults{align=justify}\n\n:::align{default}\nA\n:::\n\n- x\n- y',
    );
  });

  it('consecutiveExceptionsShareOneContainer', () => {
    const md = roundtrip(
      p('A', 'justify'),
      p('B', 'justify'),
      p('C', 'center'),
      heading('T', 2, 'center'),
      p('D', 'justify'),
    );
    expect(md).toContain(':::align{center}\nC\n\n## T\n:::');
  });

  it('headingsIgnoreTheDefault', () => {
    expect(roundtrip(p('A', 'justify'), heading('H'), heading('I', 1, 'justify'))).toBe(
      '::defaults{align=justify}\n\nA\n\n# H\n\n:::align{justify}\n# I\n:::',
    );
  });

  it('quoteWithMixedAlignmentGroupsInside', () => {
    expect(roundtrip(quote(p('a'), p('b', 'center')))).toBe(
      '> a\n>\n> :::align{center}\n> b\n> :::',
    );
  });

  it('calloutGroupsAlignmentInside', () => {
    expect(roundtrip({ type: 'calloutBlock', content: [heading('H', 2, 'center'), p('B')] })).toBe(
      ':::callout\n:::align{center}\n## H\n:::\n\nB\n:::',
    );
  });

  it('uniformlyAlignedQuoteAndListGoInAContainer', () => {
    expect(roundtrip(p('x'), p('y'), quote(p('q', 'right')), bullets(['a'], 'right'))).toBe(
      'x\n\ny\n\n:::align{right}\n> q\n\n- a\n:::',
    );
  });

  it('listWithMixedAlignmentFallsBack', () => {
    const node = { type: 'bullet_list', content: [item('a'), item('b', 'center')] };
    expect(serializeDoc(doc(node)).startsWith(FENCE)).toBe(true);
  });

  it('fallbackNodeIgnoresDefaults', () => {
    const underlined = {
      type: 'paragraph',
      attrs: { textAlign: null },
      content: [t('u', 'underline')],
    };
    const md = roundtrip(p('A', 'justify'), p('B', 'justify'), underlined);
    expect(md.startsWith(`::defaults{align=justify}\n\nA\n\nB\n\n${FENCE}`)).toBe(true);
  });

  it('failingGroupMemberFallsBackAlone', () => {
    const underlined = {
      type: 'paragraph',
      attrs: { textAlign: 'center' },
      content: [t('u', 'underline')],
    };
    const unaligned = ['A', 'A2', 'A3', 'A4'].map((text) => p(text));
    const md = roundtrip(...unaligned, p('B', 'center'), underlined, p('C', 'center'));
    expect(count(md, FENCE)).toBe(1);
    expect(md).toContain(':::align{center}\nB\n:::');
    expect(md).toContain(':::align{center}\nC\n:::');
  });
});

// --- adjacency ----------------------------------------------------------------

describe('adjacency', () => {
  it('twoAdjacentBlockquotesDoNotMerge', () => {
    expect(roundtrip(quote(p('a')), quote(p('b')))).toBe('> a\n\n:::align{default}\n> b\n:::');
  });

  it('twoAdjacentPullquotesDoNotMerge', () => {
    expect(roundtrip(pullquote(p('a')), pullquote(p('b')))).toBe(
      '|> a\n\n:::align{default}\n|> b\n:::',
    );
  });

  it('blockquoteThenPullquoteStayReadable', () => {
    expect(roundtrip(quote(p('a')), pullquote(p('b')))).toBe('> a\n\n|> b');
  });

  it.each([
    [bullets(['a']), bullets(['b']), '- a\n\n:::align{default}\n- b\n:::'],
    [ordered(['a']), ordered(['b']), '1. a\n\n:::align{default}\n1. b\n:::'],
  ])('twoAdjacentListsOfOneKindDoNotMerge %#', (first, second, expected) => {
    expect(roundtrip(first, second)).toBe(expected);
  });

  it('threeAdjacentBlockquotesAlternateWithASeparator', () => {
    expect(roundtrip(quote(p('a')), quote(p('b')), quote(p('c')))).toBe(
      '> a\n\n:::align{default}\n> b\n:::\n\n> c',
    );
  });

  it('separatorUsesTheQuoteAlignmentUnderADefault', () => {
    expect(roundtrip(quote(p('a', 'justify')), quote(p('b', 'justify')))).toBe(
      '::defaults{align=justify}\n\n> a\n\n:::align{justify}\n> b\n:::',
    );
  });

  it('adjacentQuoteWithMixedAlignmentFallsBack', () => {
    // No single :::align value fits a quote with mixed alignments.
    const second = quote(p('b'), p('c', 'center'));
    expect(count(roundtrip(p('x'), p('y'), quote(p('a')), second), FENCE)).toBe(1);
  });

  it('adjacentQuotesInsideAnAlignGroupDoNotMerge', () => {
    const unaligned = ['x', 'y', 'z'].map((text) => p(text));
    const md = roundtrip(...unaligned, quote(p('a', 'center')), quote(p('b', 'center')));
    expect(md).not.toContain(FENCE);
    expect(count(md, ':::align{center}')).toBe(2);
  });

  it('adjacentQuotesInsideACalloutStayReadable', () => {
    expect(roundtrip({ type: 'calloutBlock', content: [quote(p('a')), quote(p('b'))] })).toBe(
      ':::callout\n> a\n\n:::align{default}\n> b\n:::\n:::',
    );
  });

  it('adjacentListsInsideACalloutStayReadable', () => {
    expect(
      roundtrip({ type: 'calloutBlock', content: [bullets(['a']), bullets(['b']), p('c')] }),
    ).toBe(':::callout\n- a\n\n:::align{default}\n- b\n:::\n\nc\n:::');
  });

  it('adjacentQuotesInsideAQuoteStayReadable', () => {
    expect(roundtrip(quote(quote(p('a')), quote(p('b'))))).toBe(
      '> > a\n>\n> :::align{default}\n> > b\n> :::',
    );
  });

  it('adjacentQuotesInsideAnAlignedQuoteFallBack', () => {
    // Inside :::align the separator container cannot nest, so the block falls back.
    const unaligned = ['x', 'y', 'z', 'w', 'v'].map((text) => p(text));
    const inner = quote(quote(p('a', 'center')), quote(p('b', 'center')));
    expect(count(roundtrip(...unaligned, inner), FENCE)).toBe(1);
  });
});

// --- block kinds ----------------------------------------------------------------

describe('block kinds', () => {
  it('orderedListWithOtherStartFallsBack', () => {
    expect(roundtrip(ordered(['a', 'b'], { start: 3 })).startsWith(FENCE)).toBe(true);
  });

  it('orderedListWithDefaultAttrsIsMarkdown', () => {
    expect(roundtrip(ordered(['a', 'b']))).toBe('1. a\n2. b');
  });

  it.each(['```', '```python', '  ```'])('codeContainingAFenceLineFallsBack %j', (line) => {
    expect(roundtrip(code(`a\n${line}\nb`, 'python')).startsWith(FENCE)).toBe(true);
  });

  it('codeBlockWithNodeId', () => {
    expect(roundtrip(code('print(1)\n\n  x  ', 'python', { nodeId: 'abc-1' }))).toBe(
      '```python {nodeId=abc-1}\nprint(1)\n\n  x  \n```',
    );
  });

  it('emptyCodeBlock', () => {
    expect(roundtrip(code(''))).toBe('```\n```');
  });

  it('latexIdIsKept', () => {
    expect(roundtrip(latex('a \\\\ b\nc', 'QWERTYUIOP'))).toBe(
      '$$ {id=QWERTYUIOP}\na \\\\ b\nc\n$$',
    );
  });

  it('latexWithoutIdFallsBack', () => {
    const node = { type: 'latex_block', attrs: { persistentExpression: 'x' } };
    expect(roundtrip(node).startsWith(FENCE)).toBe(true);
  });

  it('horizontalRuleAndButtons', () => {
    const md = roundtrip(
      { type: 'horizontal_rule' },
      button('%%checkout_url%%', 'Subscribe now'),
      button('%%share_url%%', 'Share'),
      button('%%half_magic_comments_url%%', 'Leave a comment'),
      button('https://x.example/a b', 'Go ]here[ \\o/'),
    );
    expect(md.split('\n\n')).toEqual([
      '---',
      '::button[Subscribe now]{href=subscribe}',
      '::button[Share]{href=share}',
      '::button[Leave a comment]{href=comment}',
      '::button[Go \\]here[ \\\\o/]{href="https://x.example/a b"}',
    ]);
  });

  it('buttonWithExtraAttrs', () => {
    const node = {
      type: 'button',
      attrs: fillDefaults('button', { url: 'u', text: 'T', action: 'x' }),
    };
    expect(roundtrip(node)).toBe('::button[T]{href=u action=x}');
  });

  it('buttonWhoseUrlIsAPresetNameFallsBack', () => {
    expect(roundtrip(button('subscribe', 'S')).startsWith(FENCE)).toBe(true);
  });

  it('headingsAndInlineMarks', () => {
    const para = {
      type: 'paragraph',
      attrs: { textAlign: null },
      content: [t('a '), t('b', 'strong'), t(' '), t('c', { href: 'https://x' })],
    };
    expect(roundtrip(heading('H', 3), para)).toBe('### H\n\na **b** [c](https://x)');
  });

  it('headingLevelOutOfRangeFallsBack', () => {
    expect(roundtrip(heading('H', 7)).startsWith(FENCE)).toBe(true);
  });

  it('imageWithoutAttrs', () => {
    expect(roundtrip(image({ alt: null }))).toBe(`![](${HOSTED})`);
  });

  it('imageRawSizeAttrsAndExtrasAreOrdered', () => {
    const md = roundtrip(
      image({
        imageSize: 'large',
        resizeWidth: 800,
        align: 'center',
        fullscreen: false,
        srcNoWatermark: HOSTED,
        width: 1536,
        height: 1024,
        bytes: 1234,
      }),
    );
    expect(md).toBe(
      `![H](${HOSTED}){imageSize=large resizeWidth=800 align=center ` +
        `fullscreen=false original=${HOSTED} bytes=1234 height=1024 width=1536}`,
    );
  });

  it.each([
    ['normal', { imageSize: 'normal', resizeWidth: 0 }],
    ['large', { imageSize: 'large', resizeWidth: 1200 }],
    ['full', { imageSize: 'full', resizeWidth: null }],
  ])('imageSizePresets %s', (size, attrs) => {
    const md = roundtrip(image({ align: 'center', fullscreen: false, ...attrs }));
    expect(md).toBe(`![H](${HOSTED}){size=${size}}`);
  });

  it('externalImageFallsBack', () => {
    expect(roundtrip(image({ src: 'https://example.com/a.png' })).startsWith(FENCE)).toBe(true);
  });

  it('imageWithCaptionFallsBack', () => {
    const node = image();
    node.content?.push({ type: 'caption', content: [t('c')] });
    expect(roundtrip(node).startsWith(FENCE)).toBe(true);
  });

  it.each(['datawrapper', 'digestPostEmbed'])('stateOnlyNodesFallBack %s', (kind) => {
    const node = { type: kind, attrs: { url: 'https://x' } };
    expect(roundtrip(node)).toBe(`${FENCE}\n${pyJsonDumps(node, 2)}\n\`\`\``);
  });

  it('unknownMarkAndEmptyParagraphFallBack', () => {
    const underlined = {
      type: 'paragraph',
      attrs: { textAlign: null },
      content: [t('u', 'underline')],
    };
    const empty = { type: 'paragraph', attrs: { textAlign: null } };
    expect(count(roundtrip(underlined, empty), FENCE)).toBe(2);
  });

  it('unknownNodeDeepInsideFallsBackTheTopLevelBlock', () => {
    const node = quote(p('a'), { type: 'videoEmbed', attrs: { id: 'v' } });
    expect(roundtrip(node).startsWith(FENCE)).toBe(true);
  });
});

// --- line-start escaping --------------------------------------------------------

describe('line-start escaping', () => {
  it.each([
    '# x',
    '#x',
    '> x',
    '|> x',
    '- x',
    '-',
    '+ x',
    '* x',
    '1. x',
    '12. x',
    '::button',
    '::button[Go]{href=x}',
    '::defaults{align=left}',
    ':::',
    ':::align{center}',
    ':::callout',
    '```',
    '```python',
    '$$',
    '$$x$$',
    '!x',
    '![a](b)',
    '---',
    '--- x',
    '{size=large}',
    'a \\ b',
  ])('paragraphTextSurvives %j', (text) => {
    expect(roundtrip(p(text))).not.toContain(FENCE);
    expect(roundtrip(quote(p(text)))).not.toContain(FENCE);
  });

  it('paragraphTextSurvivesAsFirstBlockAfterDefaults', () => {
    roundtrip(p('::defaults{align=left}', 'justify'), p('b', 'justify'));
  });
});

// --- whole documents and robustness -----------------------------------------------

describe('whole documents and robustness', () => {
  it('richDocumentRoundTripsWithoutFallback', () => {
    const nodes = [
      heading('Title', 1),
      p('Intro', 'justify'),
      p('More **text**', 'justify'),
      p('Centered', 'center'),
      heading('Sub', 2, 'center'),
      { type: 'horizontal_rule' },
      bullets(['one', 'two'], 'justify'),
      ordered(['first', 'second']),
      quote(p('quoted', 'justify'), p('q2', 'right')),
      pullquote(p('pulled', 'justify')),
      { type: 'calloutBlock', content: [p('in callout', 'justify'), bullets(['c'])] },
      code('x = 1', 'python', { nodeId: 'n1' }),
      latex('E = mc^2'),
      image({ imageSize: 'large', resizeWidth: 1200, align: 'center', fullscreen: false }),
      button('%%checkout_url%%', 'Subscribe now'),
      p('# not a heading', 'justify'),
      p('Outro', null),
    ];
    const md = serializeDoc(doc(...nodes));
    expect(parseBlocks(md)).toStrictEqual(nodes);
    expect(md).not.toContain(FENCE);
    expect(md.startsWith('::defaults{align=justify}\n\n')).toBe(true);
  });

  it('mixedDocumentRoundTrips', () => {
    roundtrip(
      p('a', 'justify'),
      { type: 'videoEmbed', attrs: { id: 'v' } },
      quote(p('x')),
      quote(p('y')),
      bullets(['l']),
      { type: 'datawrapper', attrs: { url: 'u' } },
      bullets(['m']),
      ordered(['o'], { start: 2 }),
      code('```', null),
      p('b', 'center'),
    );
  });

  it('boolAttrIsNotConfusedWithInt', () => {
    const node = {
      type: 'ordered_list',
      attrs: { start: true, type: null, order: 1 },
      content: [item('a')],
    };
    const md = serializeDoc(doc(node));
    expect(md.startsWith(FENCE)).toBe(true);
    expect(parseBlocks(md)[0]?.attrs?.start).toBe(true);
  });

  it('emptyDoc', () => {
    expect(serializeDoc({ type: 'doc', content: [] })).toBe('');
    expect(serializeDoc({ type: 'doc' })).toBe('');
  });

  it.each<unknown>([
    {},
    { content: null },
    { content: 'text' },
    { content: [1, 'x', null, []] },
    { content: [{ type: 'heading', attrs: { level: 10 ** 9 }, content: [t('x')] }] },
    { content: [{ type: 'heading', attrs: { level: '2' }, content: [t('x')] }] },
    { content: [{ type: 'paragraph', attrs: null, content: null }] },
    { content: [{ type: 'paragraph', attrs: { textAlign: ['x'] }, content: [t('x')] }] },
    { content: [{ type: 'bullet_list', content: [null, { content: 'x' }] }] },
    { content: [{ type: 'captionedImage', content: [{ attrs: { src: 1 } }] }] },
    { content: [{ type: 'button', attrs: { text: 1, url: null } }] },
    { content: [{ type: 'highlighted_code_block', attrs: { language: 3 } }] },
    { content: [{ type: 'latex_block', attrs: { id: { a: 1 } } }] },
    { content: [{ type: 'blockquote', content: [{ type: 'blockquote' }] }] },
    { content: [{ type: 'calloutBlock', content: { a: 1 } }] },
    { content: [{ type: null }, { no: 'type' }, { type: 'x', 1: 2 }] },
    { content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a\nb' }] }] },
  ])('neverRaises %#', (d) => {
    expect(typeof serializeDoc(d)).toBe('string');
  });

  it('deeplyNestedQuotesFallBackWithoutRaising', () => {
    let node: Node = p('x');
    for (let i = 0; i < 200; i++) node = quote(node);
    expect(serializeDoc(doc(node)).startsWith(FENCE)).toBe(true);
  });
});

// --- legacy paragraphs and headings without textAlign -------------------------

function legacyP(text: string, extra: AnyNode = {}): AnyNode {
  return { type: 'paragraph', ...extra, content: [t(text)] };
}

function legacyDoc(): AnyNode {
  const li = { type: 'list_item', content: [legacyP('in a list')] };
  return doc(
    { type: 'heading', attrs: { level: 2 }, content: [t('Legacy')] },
    legacyP('no attrs at all'),
    legacyP('null attrs', { attrs: null }),
    legacyP('empty attrs', { attrs: {} }),
    { type: 'bullet_list', content: [li, li] },
    { type: 'ordered_list', attrs: fillDefaults('ordered_list', {}), content: [li] },
    { type: 'blockquote', content: [legacyP('in a quote')] },
    {
      type: 'pullquote',
      attrs: fillDefaults('pullquote', {}),
      content: [legacyP('in a pullquote')],
    },
    { type: 'calloutBlock', content: [legacyP('in a callout')] },
  );
}

/** `node` with `textAlign: null` on every paragraph and heading. */
function filled(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(filled);
  if (typeof node !== 'object' || node === null) return node;
  const out: AnyNode = Object.fromEntries(
    Object.entries(node).map(([key, value]) => [key, filled(value)]),
  );
  if (out.type === 'paragraph' || out.type === 'heading') {
    out.attrs = { ...((out.attrs as AnyNode | null) ?? {}), textAlign: null };
  }
  return out;
}

describe('legacy paragraphs and headings', () => {
  it('legacyDocSerializesWithoutFences', () => {
    const md = serializeDoc(legacyDoc());
    expect(md).not.toContain(FENCE);
    expect(md.startsWith('## Legacy\n\nno attrs at all\n\nnull attrs\n\nempty attrs\n\n')).toBe(
      true,
    );
  });

  it('legacyDocParsesBackWithDefaultTextAlignFilledIn', () => {
    const d = legacyDoc();
    expect(parseBlocks(serializeDoc(d))).toStrictEqual((filled(d) as AnyNode).content);
  });

  it('legacyNormalisationLeavesTheInputUntouched', () => {
    const d = legacyDoc();
    const before = JSON.stringify(d);
    serializeDoc(d);
    expect(JSON.stringify(d)).toBe(before);
  });

  it('legacyHeadingWithoutLevelIsStillAFence', () => {
    const h = { type: 'heading', content: [t('No level')] };
    const md = serializeDoc(doc(h));
    expect(md.startsWith(FENCE)).toBe(true);
    expect(parseBlocks(md)).toStrictEqual([filled(h)]);
  });

  it('explicitTextAlignIsNotNormalisedAway', () => {
    // Only a missing textAlign is treated as the default; a present one is kept.
    expect(roundtrip(p('right', 'right'), p('plain'))).toContain(':::align{right}');
  });

  it.each([
    // An unknown container: its paragraphs are not ours to normalise.
    { type: 'someFutureBlock', content: [{ type: 'paragraph', content: [t('inside')] }] },
    // A known leaf that is written verbatim keeps its children untouched.
    {
      type: 'footnote',
      attrs: { number: 1 },
      content: [{ type: 'paragraph', content: [t('note')] }],
    },
  ])('legacyParagraphsInsideUnknownNodesAreNotNormalised %#', (node) => {
    const d = doc(p('Before.'), node);
    expect(parseBlocks(serializeDoc(d))).toStrictEqual(d.content);
  });

  it('legacyParagraphsInsideKnownContainersAreNormalised', () => {
    const legacy = { type: 'paragraph', content: [t('x')] };
    const aligned = { type: 'paragraph', attrs: { textAlign: null }, content: [t('x')] };
    const d = doc(
      { type: 'blockquote', content: [legacy] },
      { type: 'bullet_list', content: [{ type: 'list_item', content: [legacy] }] },
    );
    expect(parseBlocks(serializeDoc(d))).toStrictEqual([
      { type: 'blockquote', content: [aligned] },
      { type: 'bullet_list', content: [{ type: 'list_item', content: [aligned] }] },
    ]);
  });

  it('wholeDocumentGuardLogsAWarningWithoutContent', () => {
    const secret = 'a private sentence';
    const spy = vi.spyOn(Serializer.prototype, 'run').mockReturnValue('not the same');
    try {
      const d = doc(p(secret));
      const markdown = serializeDoc(d);
      expect(markdown.startsWith('```substack-node\n')).toBe(true);
      expect(parseBlocks(markdown)).toStrictEqual(d.content);
      expect(warnings).toHaveLength(1);
      expect(warnings.join('\n')).not.toContain(secret);
    } finally {
      spy.mockRestore();
    }
  });

  it('serializerFailureLogsAWarningAndDegradesToFences', () => {
    const spy = vi.spyOn(Serializer.prototype, 'run').mockImplementation(() => {
      throw new Error('bug');
    });
    try {
      const d = doc(p('x'));
      expect(parseBlocks(serializeDoc(d))).toStrictEqual(d.content);
      expect(warnings).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });
});

// --- Python semantics (each checked against upstream bc2e875) -----------------

describe('python semantics', () => {
  it('a list or dict node type degrades the whole document to fences', () => {
    // `kind in frozenset` raises TypeError (unhashable); serialize_doc catches it.
    for (const kind of [['paragraph'], { a: 1 }]) {
      const md = serializeDoc(doc(p('a'), { type: kind, content: [t('x')] }));
      expect(md.split('\n\n').every((part) => part.startsWith(FENCE))).toBe(true);
      expect(count(md, FENCE)).toBe(2);
      expect(warnings).toHaveLength(1);
      warnings = [];
    }
  });

  it('a list mark type falls back only its block', () => {
    // serialize_inline raises TypeError inside the block writer, which returns None.
    const odd = {
      type: 'paragraph',
      attrs: { textAlign: null },
      content: [{ type: 'text', text: 'u', marks: [{ type: ['em'] }] }],
    };
    const md = serializeDoc(doc(p('a'), odd));
    expect(md.startsWith(`a\n\n${FENCE}`)).toBe(true);
    expect(warnings).toHaveLength(0);
  });

  it('a non-string node type has no writer', () => {
    // Each is written as a fence; the parser then refuses a non-string fence
    // type, so the whole-document check raises and the doc stays all fences.
    const md = serializeDoc(doc({ type: 1 }, { type: true }));
    expect(md).toBe(
      `${FENCE}\n{\n  "type": 1\n}\n\`\`\`\n\n${FENCE}\n{\n  "type": true\n}\n\`\`\``,
    );
    expect(warnings).toEqual([
      'draft serializer failed (DraftMarkdownError); writing every block as a substack-node fence',
    ]);
  });

  it('NaN anywhere degrades the whole document to fences', () => {
    // NaN != NaN in Python, so no comparison of the doc ever succeeds.
    const md = serializeDoc(doc(p('a'), { type: 'videoEmbed', attrs: { n: Number.NaN } }));
    expect(md).toBe(
      `${FENCE}\n${pyJsonDumps(p('a'), 2)}\n\`\`\`\n\n${FENCE}\n{\n  "type": "videoEmbed",\n  "attrs": {\n    "n": NaN\n  }\n}\n\`\`\``,
    );
    expect(warnings).toHaveLength(1);
  });

  it('a fence writes json.dumps(indent=2) with empty containers inline', () => {
    const node = { type: 'videoEmbed', attrs: {}, content: [], x: [1, { y: 'é' }] };
    expect(serializeDoc(doc(node))).toBe(
      `${FENCE}\n{\n  "type": "videoEmbed",\n  "attrs": {},\n  "content": [],\n  "x": [\n    1,\n    {\n      "y": "é"\n    }\n  ]\n}\n\`\`\``,
    );
  });

  it('image extras are sorted by code point', () => {
    // Python sorts str by code point; JS sort() by UTF-16 unit would put U+10000 first.
    const md = serializeDoc(doc(image({ '\uffff': 1, '\u{10000}': 2 })));
    expect(md).toBe(`![H](${HOSTED}){\uffff=1 \u{10000}=2}`);
  });

  it('a unicode-digit paragraph start is escaped', () => {
    expect(roundtrip(p('\u0663. x'))).toBe('\u0663\\. x');
  });

  it('button attrs given as a list of pairs are read like dict()', () => {
    // dict([["text", "T"], ["url", "u"]]) works upstream; the parse check then fails.
    const node = {
      type: 'button',
      attrs: [
        ['text', 'T'],
        ['url', 'u'],
      ],
    };
    expect(serializeDoc(doc(node)).startsWith(FENCE)).toBe(true);
  });

  it('integer-like attribute keys come first (known JS limit)', () => {
    // Upstream writes {href=u width=5 1=a}; a JS object puts "1" first. The
    // round trip is still lossless.
    const node = {
      type: 'button',
      attrs: fillDefaults('button', { url: 'u', text: 'T', width: 5, 1: 'a' }),
    };
    expect(roundtrip(node)).toBe('::button[T]{1=a href=u width=5}');
  });
});
