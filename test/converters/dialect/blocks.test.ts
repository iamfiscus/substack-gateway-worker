// Port of upstream packages/gateway_drafts/tests/test_dialect_blocks.py
// (bc2e875), test names in camelCase. Python-semantics cases (line splitting,
// Unicode digits and word characters, urlsplit corner cases) follow at the end;
// each expectation was checked against upstream.

import { afterEach, describe, expect, it } from 'vitest';
import { fillDefaults } from '../../../src/converters/dialect/attrs';
import { isSubstackHosted, parseBlocks } from '../../../src/converters/dialect/blocks';
import { DraftMarkdownError } from '../../../src/converters/dialect/errors';
import { setLatexIdGenerator } from '../../../src/converters/dialect/fences';
import type { Node } from '../../../src/converters/dialect/inline';
import { pyJsonDumps } from '../../../src/converters/dialect/pyJson';
import { p, t } from './helpers';

const HOSTED = 'https://substack-post-media.s3.amazonaws.com/public/images/a_1536x1024.png';

function heading(text: string, level: number, align: string | null = null): Node {
  return { type: 'heading', attrs: { level, textAlign: align }, content: [t(text)] };
}

function item(text: string, align: string | null = null): Node {
  return { type: 'list_item', content: [p(text, align)] };
}

function thrown(fn: () => unknown): DraftMarkdownError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(DraftMarkdownError);
    return err as DraftMarkdownError;
  }
  throw new Error('expected a DraftMarkdownError');
}

/** `json.dumps(node, indent=2)` for the plain ASCII nodes used here. */
function indented(node: unknown): string {
  return JSON.stringify(node, null, 2);
}

function attrsOf(node: Node | undefined): Record<string, unknown> {
  return (node?.attrs ?? {}) as Record<string, unknown>;
}

afterEach(() => setLatexIdGenerator(null));

describe('tests from the task brief', () => {
  it('ruleAndButtons', () => {
    const nodes = parseBlocks(
      '---\n\n::button[Subscribe now]{href=subscribe}\n\n::button[Go]{href=https://x}',
    );
    expect(nodes[0]).toEqual({ type: 'horizontal_rule' });
    expect(nodes[1]?.attrs).toEqual({
      url: '%%checkout_url%%',
      text: 'Subscribe now',
      action: null,
      class: null,
    });
    expect(attrsOf(nodes[2]).url).toBe('https://x');
  });

  it('defaultsAndAlignContainer', () => {
    const nodes = parseBlocks('::defaults{align=justify}\n\nA\n\n:::align{center}\n# T\n\nB\n:::');
    expect(nodes[0]).toEqual(p('A', 'justify'));
    expect(nodes[1]?.attrs).toEqual({ level: 1, textAlign: 'center' });
    expect(nodes[2]).toEqual(p('B', 'center'));
  });

  it('callout', () => {
    expect(parseBlocks(':::callout\nX\n:::')).toEqual([
      { type: 'calloutBlock', content: [p('X')] },
    ]);
  });

  it('substackNodeVerbatim', () => {
    const node = { type: 'digestPostEmbed', attrs: { id: 1, title: 't' } };
    expect(parseBlocks(`\`\`\`substack-node\n${indented(node)}\n\`\`\``)).toEqual([node]);
  });

  it('hostedImageWithSizeIsFinal', () => {
    const node = parseBlocks(`![H](${HOSTED}){size=large}`)[0] as Node;
    const img = attrsOf(node.content?.[0]);
    expect(node.type).toBe('captionedImage');
    expect([img.imageSize, img.resizeWidth, img.align, img.fullscreen]).toEqual([
      'large',
      1200,
      'center',
      false,
    ]);
  });

  it('watermarkInstructionIsPlaceholder', () => {
    const node = parseBlocks(`![H](${HOSTED}){watermark=8%}`)[0] as Node;
    expect(node.type).toBe('_unresolved_image');
    expect(attrsOf(node).watermark).toEqual({ scale: 0.08, position: 'top-right', opacity: 65 });
  });

  it('crlfAndTrailingSpaces', () => {
    expect(parseBlocks('A\r\n\r\n---   \r\n\r\nB')).toEqual(parseBlocks('A\n\n---\n\nB'));
  });

  it('literalRuleInsideSentenceIsText', () => {
    expect(parseBlocks('a --- b')).toEqual([p('a --- b')]);
  });

  it.each([
    [':::align{center}\nA', 1],
    ['A\n\n::defaults{align=justify}', 3],
    ['```substack-node\n{oops\n```', 1],
    [':::callout\n:::callout\nA\n:::\n:::', 2],
  ])('errorsNameTheLine %j', (bad, line) => {
    expect(thrown(() => parseBlocks(bad)).line).toBe(line);
  });
});

describe('ported behaviour of the previous converter', () => {
  it('emptyInputGivesNoBlocks', () => {
    expect(parseBlocks('')).toEqual([]);
    expect(parseBlocks('\n\n   \n')).toEqual([]);
  });

  it('paragraphLinesAreJoinedWithASpace', () => {
    expect(parseBlocks('one\ntwo  \n   three')).toEqual([p('one two three')]);
  });

  it('paragraphUsesInlineMarks', () => {
    expect(parseBlocks('a **b** [c](https://x)')).toEqual([
      {
        type: 'paragraph',
        attrs: { textAlign: null },
        content: [t('a '), t('b', 'strong'), t(' '), t('c', { href: 'https://x' })],
      },
    ]);
  });

  it('headings', () => {
    expect(parseBlocks('# One\n## Two *x*\n###### Six')).toEqual([
      heading('One', 1),
      {
        type: 'heading',
        attrs: { level: 2, textAlign: null },
        content: [t('Two '), t('x', 'em')],
      },
      heading('Six', 6),
    ]);
  });

  it('headingNeedsASpaceAndText', () => {
    expect(parseBlocks('#hashtag')).toEqual([p('#hashtag')]);
    expect(parseBlocks('####### seven')).toEqual([p('####### seven')]);
    expect(parseBlocks('#  ')).toEqual([p('#')]);
  });

  it.each(['-', '*', '+'])('bulletList %s', (marker) => {
    expect(parseBlocks(`${marker} one\n${marker} **two**`)).toEqual([
      {
        type: 'bullet_list',
        content: [
          item('one'),
          {
            type: 'list_item',
            content: [
              { type: 'paragraph', attrs: { textAlign: null }, content: [t('two', 'strong')] },
            ],
          },
        ],
      },
    ]);
  });

  it('orderedListHasDefaultAttrs', () => {
    expect(parseBlocks('1. a\n2. b\n\n3. c')).toEqual([
      {
        type: 'ordered_list',
        attrs: { start: 1, type: null, order: 1 },
        content: [item('a'), item('b'), item('c')],
      },
    ]);
  });

  it('listKindSwitchAndParagraphEndLists', () => {
    const nodes = parseBlocks('- a\n1. b\ntext\n- c');
    expect(nodes.map((n) => n.type)).toEqual([
      'bullet_list',
      'ordered_list',
      'paragraph',
      'bullet_list',
    ]);
  });

  it('blockquoteAndPullquote', () => {
    expect(parseBlocks('> a\n>\n> b\n\n|> c')).toEqual([
      { type: 'blockquote', content: [p('a'), p('b')] },
      { type: 'pullquote', attrs: { align: null, color: null }, content: [p('c')] },
    ]);
  });

  it('blankLineBetweenQuoteLinesKeepsOneQuote', () => {
    expect(parseBlocks('> a\n\n> b')).toEqual([{ type: 'blockquote', content: [p('a'), p('b')] }]);
  });

  it('quoteEndsAtANonQuoteLine', () => {
    expect(parseBlocks('> a\nb')).toEqual([{ type: 'blockquote', content: [p('a')] }, p('b')]);
  });

  it('quoteBodyIsParsedRecursively', () => {
    expect(parseBlocks('> # T\n> - x\n> > y')).toEqual([
      {
        type: 'blockquote',
        content: [
          heading('T', 1),
          { type: 'bullet_list', content: [item('x')] },
          { type: 'blockquote', content: [p('y')] },
        ],
      },
    ]);
  });

  it('codeFence', () => {
    expect(parseBlocks('```python\ndef f():  \n    return 1\n```')).toEqual([
      {
        type: 'highlighted_code_block',
        attrs: { language: 'python', nodeId: null },
        content: [{ type: 'text', text: 'def f():  \n    return 1' }],
      },
    ]);
  });

  it('codeFenceWithoutLanguageAndWithNodeId', () => {
    expect(parseBlocks('```\nx\n```')[0]?.attrs).toEqual({ language: null, nodeId: null });
    const node = parseBlocks('```python {nodeId=abc-123}\nx\n```   ')[0];
    expect(node?.attrs).toEqual({ language: 'python', nodeId: 'abc-123' });
  });

  it('codeFenceLanguageMayContainPunctuation', () => {
    expect(attrsOf(parseBlocks('```c++\nx\n```')[0]).language).toBe('c++');
  });

  it('emptyCodeFenceHasNoEmptyTextNode', () => {
    expect(parseBlocks('```\n```')).toEqual([
      { type: 'highlighted_code_block', attrs: { language: null, nodeId: null } },
    ]);
  });

  it('blockSyntaxInsideCodeFenceIsLiteral', () => {
    const nodes = parseBlocks('```\n$$not latex$$\n:::\n::defaults{align=left}\n---\n```');
    expect(nodes.map((n) => n.type)).toEqual(['highlighted_code_block']);
    expect(nodes[0]?.content?.[0]?.text).toBe('$$not latex$$\n:::\n::defaults{align=left}\n---');
  });

  it('datawrapperFenceIsPlaceholder', () => {
    expect(parseBlocks('```datawrapper\n https://www.datawrapper.de/_/boimj/ \n```')).toEqual([
      { type: '_unresolved_datawrapper', attrs: { url: 'https://www.datawrapper.de/_/boimj/' } },
    ]);
  });

  it('singleLineLatex', () => {
    const node = parseBlocks('$$ E = mc^2 $$')[0] as Node;
    expect(node.type).toBe('latex_block');
    expect(attrsOf(node).persistentExpression).toBe('E = mc^2');
    expect(attrsOf(node).id).toMatch(/^[A-Z]{10}$/);
  });

  it('multilineLatexKeepsLinesAndBackslashes', () => {
    const node = parseBlocks('$$\nP(S) = 0.20  \nP(\\neg S)\n$$')[0];
    expect(attrsOf(node).persistentExpression).toBe('P(S) = 0.20  \nP(\\neg S)');
  });

  it('latexIdIsKeptWhenGiven', () => {
    expect(parseBlocks('$$ {id=ABCDEFGHIJ}\nx\n$$')).toEqual([
      { type: 'latex_block', attrs: { persistentExpression: 'x', id: 'ABCDEFGHIJ' } },
    ]);
  });

  it('generatedLatexIdsDiffer', () => {
    const [a, b] = parseBlocks('$$a$$\n\n$$b$$');
    expect(attrsOf(a).id).not.toBe(attrsOf(b).id);
  });

  it('externalImageIsPlaceholder', () => {
    expect(parseBlocks('![A cat](https://x/cat.png)')).toEqual([
      {
        type: '_unresolved_image',
        attrs: { src: 'https://x/cat.png', alt: 'A cat', image_attrs: {}, watermark: null },
      },
    ]);
  });

  it('dataUriImageIsParsedWhole', () => {
    const node = parseBlocks('![](data:image/png;base64,QUJDRA==)')[0];
    expect(attrsOf(node).src).toBe('data:image/png;base64,QUJDRA==');
    expect(attrsOf(node).alt).toBe('');
  });

  it('imageInsideTextIsNotAnImage', () => {
    expect(parseBlocks('see ![a](https://x/a.png)')[0]?.type).toBe('paragraph');
  });
});

describe('new block syntax', () => {
  it.each([
    ['share', '%%share_url%%'],
    ['comment', '%%half_magic_comments_url%%'],
    ['"https://x.test/a b"', 'https://x.test/a b'],
  ])('buttonUrls %s', (href, url) => {
    expect(parseBlocks(`::button[Go]{href=${href}}`)[0]).toEqual({
      type: 'button',
      attrs: { url, text: 'Go', action: null, class: null },
    });
  });

  it('buttonTextMayEscapeABracketAndExtraAttrsAreKept', () => {
    expect(parseBlocks('::button[a \\] b]{href=share class=wide}')[0]?.attrs).toEqual({
      url: '%%share_url%%',
      text: 'a ] b',
      action: null,
      class: 'wide',
    });
  });

  it.each(['::button[]{href=share}', '::button[Go]', '::button[Go]{class=x}', '::button{href=x}'])(
    'buttonNeedsTextAndHref %s',
    (md) => {
      expect(thrown(() => parseBlocks(`A\n\n${md}`)).line).toBe(3);
    },
  );

  it('attributeValueWithUnicodeLineSeparatorIsOneLine', () => {
    expect(attrsOf(parseBlocks('::button[Go]{href="a\u2028b\x85c"}')[0]).url).toBe('a\u2028b\x85c');
  });

  it('defaultsApplyToNestedParagraphsButNotHeadings', () => {
    const md = '\n\n::defaults{align=justify}\n# H\n- a\n\n> q\n\n:::callout\nc\n:::';
    expect(parseBlocks(md)).toEqual([
      heading('H', 1),
      { type: 'bullet_list', content: [item('a', 'justify')] },
      { type: 'blockquote', content: [p('q', 'justify')] },
      { type: 'calloutBlock', content: [p('c', 'justify')] },
    ]);
  });

  it('alignDefaultMeansNullAlignment', () => {
    const md = '::defaults{align=justify}\n\n:::align{default}\nA\n:::\n\nB';
    expect(parseBlocks(md)).toEqual([p('A'), p('B', 'justify')]);
  });

  it.each(['left', 'center', 'right', 'justify'])('alignValues %s', (value) => {
    expect(parseBlocks(`:::align{${value}}\nA\n:::`)).toEqual([p('A', value)]);
  });

  it('alignAppliesToListsAndQuotesInside', () => {
    expect(parseBlocks(':::align{right}\n- a\n> b\n:::')).toEqual([
      { type: 'bullet_list', content: [item('a', 'right')] },
      { type: 'blockquote', content: [p('b', 'right')] },
    ]);
  });

  it('alignInsideCalloutAndQuote', () => {
    const md = ':::callout\n:::align{center}\n## H\n:::\nB\n:::\n\n> :::align{right}\n> Q\n> :::';
    expect(parseBlocks(md)).toEqual([
      { type: 'calloutBlock', content: [heading('H', 2, 'center'), p('B')] },
      { type: 'blockquote', content: [p('Q', 'right')] },
    ]);
  });

  it('containerLinesWithTrailingSpacesAndBlankLines', () => {
    expect(parseBlocks(':::callout   \n\n\nX   \n\n\n:::   \n\n\n\nY')).toEqual([
      { type: 'calloutBlock', content: [p('X')] },
      p('Y'),
    ]);
  });

  it('loneCarriageReturnsSplitLines', () => {
    expect(parseBlocks('A\r\rB')).toEqual([p('A'), p('B')]);
  });

  it('emptyCalloutHasNoContentKey', () => {
    expect(parseBlocks(':::callout\n:::')).toEqual([{ type: 'calloutBlock' }]);
  });

  it('substackNodeInsideCalloutAndQuote', () => {
    const node = { type: 'videoEmbed', attrs: { id: 'v' } };
    const fence = `\`\`\`substack-node\n${pyJsonDumps(node)}\n\`\`\``;
    expect(parseBlocks(`:::callout\n${fence}\n:::`)).toEqual([
      { type: 'calloutBlock', content: [node] },
    ]);
    const quoted = fence
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n');
    expect(parseBlocks(quoted)).toEqual([{ type: 'blockquote', content: [node] }]);
  });

  it('substackNodeIsNotTouchedByDefaults', () => {
    const node = { type: 'paragraph', content: [t('x')] };
    const md = `::defaults{align=justify}\n\`\`\`substack-node\n${pyJsonDumps(node)}\n\`\`\``;
    expect(parseBlocks(md)).toEqual([node]);
  });

  it('hostedImageWithoutAttrsIsFinal', () => {
    expect(parseBlocks(`![](${HOSTED})`)).toEqual([
      {
        type: 'captionedImage',
        content: [{ type: 'image2', attrs: fillDefaults('image2', { src: HOSTED }) }],
      },
    ]);
  });

  it.each([
    ['normal', ['normal', 0]],
    ['large', ['large', 1200]],
    ['full', ['full', null]],
  ] as const)('sizePresets %s', (size, [imageSize, resizeWidth]) => {
    const node = parseBlocks(`![H](https://x/a.png){size=${size}}`)[0];
    expect(attrsOf(node).image_attrs).toEqual({
      imageSize,
      resizeWidth,
      align: 'center',
      fullscreen: false,
    });
  });

  it('hostedImageStateAttrs', () => {
    const original = 'https://substackcdn.com/image/o.png';
    const node = parseBlocks(
      `![H](${HOSTED}){size=full original=${original} width=1536 title="a b"}`,
    )[0];
    expect(node).toEqual({
      type: 'captionedImage',
      content: [
        {
          type: 'image2',
          attrs: fillDefaults('image2', {
            src: HOSTED,
            alt: 'H',
            imageSize: 'full',
            resizeWidth: null,
            align: 'center',
            fullscreen: false,
            srcNoWatermark: original,
            width: 1536,
            title: 'a b',
          }),
        },
      ],
    });
  });

  it('watermarkOptions', () => {
    const node = parseBlocks(
      '![](https://x/a.png){original=https://x/o.png watermark ' +
        'watermark-pos=bottom-left watermark-opacity=40 size=normal}',
    )[0];
    expect(node?.attrs).toEqual({
      src: 'https://x/a.png',
      alt: '',
      image_attrs: {
        imageSize: 'normal',
        resizeWidth: 0,
        align: 'center',
        fullscreen: false,
        srcNoWatermark: 'https://x/o.png',
      },
      watermark: { scale: 0.06, position: 'bottom-left', opacity: 40 },
    });
  });

  it('imageAttributeBlockMayFollowASpace', () => {
    const node = parseBlocks('![](https://x/a.png) {size=large}')[0];
    expect((attrsOf(node).image_attrs as Record<string, unknown>).imageSize).toBe('large');
  });

  it.each([
    'size=huge',
    'size',
    'watermark-pos=middle',
    'watermark watermark-opacity=101',
    'watermark watermark-opacity=-1',
    'watermark watermark-opacity=50%',
    'watermark=0%',
    'watermark=abc',
    'watermark=8',
    'watermark=-5%',
    'watermark-pos=top-left',
    'watermark-opacity=10',
    'original',
    'title="unterminated',
  ])('badImageAttributesNameTheLine %s', (attrs) => {
    expect(thrown(() => parseBlocks(`A\n\n![](https://x/a.png){${attrs}}`)).line).toBe(3);
  });

  it.each([
    '\\# not a heading',
    '\\> not a quote',
    '\\|> not a pullquote',
    '\\- not a list',
    '\\+ not a list',
    '\\* not a list',
    '1\\. not a list',
    '\\::button[Go]{href=share}',
    '\\:::callout',
    '\\:::',
    '\\$$x$$',
    '\\```',
    '\\!\\[a\\](https://x/a.png)',
    '\\---',
    '\\::defaults{align=left}',
  ])('escapedBlockSyntaxIsParagraphText %s', (md) => {
    const nodes = parseBlocks(`A\n\n${md}`);
    expect(nodes[0]).toEqual(p('A'));
    expect(nodes).toHaveLength(2);
    expect(nodes[1]?.type).toBe('paragraph');
    expect(nodes[1]?.content).toEqual([t(md.replaceAll('\\', ''))]);
  });

  it.each(['::buttons are fun', ':::alignment matters', '::note this', ':::note', '$$ is money'])(
    'lookalikeLinesAreParagraphText %s',
    (md) => {
      expect(parseBlocks(md)).toEqual([p(md)]);
    },
  );

  it.each([
    ['A\n\n```python\nx', 3],
    ['A\n\n$$\nx', 3],
    ['A\n\n```datawrapper\nhttps://x', 3],
    ['A\n:::', 2],
    ['A\n\n:::callout\nB', 3],
    [':::align{center}\n:::align{left}\nA\n:::\n:::', 2],
    [':::align{center}\n:::callout\nA\n:::\n:::', 2],
    [':::align{middle}\nA\n:::', 1],
    [':::align\nA\n:::', 1],
    [':::callout{x=1}\nA\n:::', 1],
    ['::defaults{align=justify}\n::defaults{align=left}', 2],
    ['::defaults{align=middle}', 1],
    ['::defaults{x=1}', 1],
    ['::defaults', 1],
    ['> A\n> ::defaults{align=left}', 2],
    ['A\n\n> :::callout\n> B\n> :::', 3],
    ['A\n\n> :::align{center}\n> B', 3],
    [':::align{center}\n> :::align{left}\n> B\n> :::\n:::', 2],
    ['A\n\n```substack-node\n[1, 2]\n```', 3],
    ['```substack-node\n{"attrs": {}}\n```', 1],
    ['```python {nodeId=}\n```', 1],
  ])('moreErrorsNameTheLine %j', (bad, line) => {
    expect(thrown(() => parseBlocks(bad)).line).toBe(line);
  });

  it('substackNodeErrorMessageMentionsJson', () => {
    expect(thrown(() => parseBlocks('```substack-node\n{oops\n```')).message).toMatch(/JSON/);
  });

  it('unclosedContainerInsideQuoteReportsTheOriginalLine', () => {
    expect(thrown(() => parseBlocks('A\n\nB\n\n> x\n> :::callout')).line).toBe(6);
  });

  it.each([
    [HOSTED, true],
    ['https://substackcdn.com/image/fetch/abc', true],
    ['HTTP://SUBSTACKCDN.COM/x.png', true],
    ['https://example.com/substackcdn.com/x.png', false],
    ['https://substack-post-media.s3.amazonaws.com/public/images/a.png', true],
    ['https://substack-post-media.s3.us-east-1.amazonaws.com/a.png', true],
    ['http://substack-post-media.s3.amazonaws.com/a.png', true],
    ['https://bucketeer-x.substackcdn.com/x.png', true],
    ['https://substackcdn.com:443/x.png', true],
    // Lookalike hosts and URLs that only mention a Substack host.
    ['https://substackcdn.com.evil.example/x.png', false],
    ['https://notsubstackcdn.com/x', false],
    ['https://a:b@substackcdn.com@evil.example/x', false],
    ['https://evil.example?x=substackcdn.com', false],
    ['https://substack-post-media.s3.amazonaws.com.evil.example/a.png', false],
    ['https://substack-post-media.s3.evil.amazonaws.com.example/a.png', false],
    ['https://x.substack-post-media.s3.amazonaws.com/a.png', false],
    ['https://s3.amazonaws.com/substack-post-media/a.png', false],
    ['https://cdn.substack.com/a.png', false],
    ['ftp://substackcdn.com/x.png', false],
    ['//substackcdn.com/x.png', false],
    ['https://x/cat.png', false],
    ['data:image/png;base64,QUJD', false],
  ])('isSubstackHosted %s', (src, hosted) => {
    expect(isSubstackHosted(src)).toBe(hosted);
  });

  it('onlySpacesAndTabsCountAsStrippableWhitespace', () => {
    expect(parseBlocks('a\u00a0\t \n\n\u2028b\x85c')).toEqual([p('a\u00a0'), p('\u2028b\x85c')]);
  });

  it('loneHashIsParagraphTextAndEndsTheList', () => {
    expect(parseBlocks('- a\n# \n- b')).toEqual([
      { type: 'bullet_list', content: [item('a')] },
      p('#'),
      { type: 'bullet_list', content: [item('b')] },
    ]);
  });

  it('deeplyNestedQuotesRaiseInsteadOfOverflowingTheStack', () => {
    expect(parseBlocks(`${'> '.repeat(32)}x`).length).toBeGreaterThan(0); // the limit itself is fine
    expect(thrown(() => parseBlocks(`A\n\n${'> '.repeat(400)}x`)).line).toBe(3);
  });

  it.each([
    ['[ x 100000', '['.repeat(100_000)],
    ['huge int', `{"type": "x", "n": ${'9'.repeat(5000)}}`],
    ['deep', `{"type": "x", "n": ${'['.repeat(100_000)}${']'.repeat(100_000)}}`],
  ])('unreadableSubstackNodeJsonIsAMarkdownError %s', (_label, body) => {
    expect(thrown(() => parseBlocks(`A\n\n\`\`\`substack-node\n${body}\n\`\`\``)).line).toBe(3);
  });

  it.each([
    ['::defaults {align=justify}', '::defaults'],
    [':::align {center}\nA\n:::', ':::align'],
    ['```python extra\nx = 1\n```', 'fence'],
    ['::button [Go]{href=share}', '::button'],
    ['::button is great', '::button'],
    [':::callout please\nA\n:::', ':::callout'],
    [':::align\tcenter\nA\n:::', ':::align'],
    ['```js title', 'fence'],
  ])('malformedDirectiveOrFenceOpenerErrorsOnItsOwnLine %j', (bad, what) => {
    const err = thrown(() => parseBlocks(bad));
    expect(err.message).toMatch(/malformed/);
    expect(err.line).toBe(1);
    expect(err.reason).toContain(what);
  });

  it.each([
    [{ type: '_unresolved_image', attrs: {} }],
    [
      {
        type: 'blockquote',
        content: [{ type: 'paragraph', content: [{ type: '_unresolved_x' }] }],
      },
    ],
  ])('substackNodeRejectsInternalPlaceholderTypes %#', (node) => {
    const md = `A\n\n\`\`\`substack-node\n${indented(node)}\n\`\`\``;
    const err = thrown(() => parseBlocks(md));
    expect(err.message).toMatch(/_unresolved/);
    expect(err.line).toBe(3);
  });

  it('substackNodeAllowsUnderscoresElsewhere', () => {
    const node = { type: 'x_y', attrs: { _private: { type: 1 }, t: '_a' } };
    expect(parseBlocks(`\`\`\`substack-node\n${pyJsonDumps(node)}\n\`\`\``)).toEqual([node]);
  });
});

// Dispatch order and flushing of `_Parser._line`, checked against upstream.
describe('dispatch order and flushing', () => {
  const code = (text: string): Node => ({
    type: 'highlighted_code_block',
    attrs: { language: null, nodeId: null },
    content: [{ type: 'text', text }],
  });
  const latex = (expression: string): Node => ({
    type: 'latex_block',
    attrs: { persistentExpression: expression, id: 'GOLDENID00' },
  });

  it('list, quote and heading rules come before fences and one-line latex', () => {
    setLatexIdGenerator(() => 'GOLDENID00');
    expect(parseBlocks('- ```py')).toEqual([{ type: 'bullet_list', content: [item('```py')] }]);
    expect(parseBlocks('1. ```')[0]?.content).toEqual([item('```')]);
    expect(parseBlocks('> $$x$$')).toEqual([{ type: 'blockquote', content: [latex('x')] }]);
    expect(parseBlocks('# $$x$$')).toEqual([heading('$$x$$', 1)]);
    expect(parseBlocks('# ```')).toEqual([heading('```', 1)]);
  });

  it('opening a fence ends the open paragraph, list and quote', () => {
    expect(parseBlocks('a\n```\nx\n```')).toEqual([p('a'), code('x')]);
    expect(parseBlocks('- a\n```\nx\n```\n- b')).toEqual([
      { type: 'bullet_list', content: [item('a')] },
      code('x'),
      { type: 'bullet_list', content: [item('b')] },
    ]);
    expect(parseBlocks('> q\n```\nx\n```')).toEqual([
      { type: 'blockquote', content: [p('q')] },
      code('x'),
    ]);
  });

  it('a blank line ends the paragraph but not the list', () => {
    setLatexIdGenerator(() => 'GOLDENID00');
    expect(parseBlocks('a\n\nb')).toEqual([p('a'), p('b')]);
    expect(parseBlocks('- a\n\n- b')).toEqual([
      { type: 'bullet_list', content: [item('a'), item('b')] },
    ]);
    expect(parseBlocks('- a\n\nb')).toEqual([
      { type: 'bullet_list', content: [item('a')] },
      p('b'),
    ]);
    expect(parseBlocks('a\n$$x$$\nb')).toEqual([p('a'), latex('x'), p('b')]);
  });
});

// Behaviour checked against upstream bc2e875 (Python 3.11.5).
describe('python semantics', () => {
  it.each(['\v', '\f', '\x1c', '\x1d', '\x1e', '\x85', '\u2028', '\u2029'])(
    'only \\n, \\r\\n and \\r end a line, not %j',
    (sep) => {
      // Upstream splits on "\n" after normalising CR, never with str.splitlines().
      expect(parseBlocks(`a${sep}b`)).toEqual([p(`a${sep}b`)]);
    },
  );

  it('crlf, lone cr and lf give the same blocks', () => {
    const lf = '# T\n\n- a\n- b\n\n> q\n\n```\ncode  \n```\n\nend';
    expect(parseBlocks(lf.replaceAll('\n', '\r\n'))).toEqual(parseBlocks(lf));
    expect(parseBlocks(lf.replaceAll('\n', '\r'))).toEqual(parseBlocks(lf));
    expect(parseBlocks(lf.replace(/\nend$/, '\nend\n'))).toEqual(parseBlocks(lf));
  });

  it('a crlf fence body keeps no carriage return', () => {
    expect(parseBlocks('```\r\na\r\nb\r\n```')[0]?.content).toEqual([
      { type: 'text', text: 'a\nb' },
    ]);
  });

  it('unicode digits make an ordered list item', () => {
    expect(parseBlocks('\u0663. a')[0]?.type).toBe('ordered_list');
  });

  it('unicode digits are a watermark percentage', () => {
    const node = parseBlocks('![](https://x/a.png){watermark=\u0668%}')[0];
    expect((attrsOf(node).watermark as Record<string, unknown>).scale).toBe(0.08);
  });

  it('a unicode word character after the directive name is not a directive', () => {
    expect(parseBlocks('::button\u00e9 x')).toEqual([p('::button\u00e9 x')]);
    expect(parseBlocks(':::callout\u0663')).toEqual([p(':::callout\u0663')]);
  });

  it('a bool watermark-opacity is not a whole number', () => {
    const err = thrown(() => parseBlocks('![](https://x/a.png){watermark watermark-opacity}'));
    expect(err.reason).toBe('watermark-opacity must be a whole number from 0 to 100');
  });

  it('__proto__ image attributes stay own data keys', () => {
    const node = parseBlocks(`![](${HOSTED}){__proto__=1}`)[0];
    const attrs = attrsOf(node?.content?.[0]);
    expect(Object.hasOwn(attrs, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(attrs)).toBe(Object.prototype);
  });

  it.each([
    ['https://[v1.substackcdn.com]/x', true],
    ['https://[::1]@substackcdn.com/x', true],
    ['https://[nope]@substackcdn.com/x', false],
    ['https://[1.2.3.4]@substackcdn.com/x', false],
    ['https://[::1/x', false],
    [' \x01https://substackcdn.com/x', true],
    ['ht\ttps://subst\nackcdn.com/x', true],
    ['https://a%.SUBSTACKCDN.COM/x', false],
    ['https://SUBSTACKCDN.COM%x/x', false],
    ['https://substackcdn.com\uff0fx/', false],
    ['1https://substackcdn.com/x', false],
    ['https:substackcdn.com/x', false],
  ])('isSubstackHosted follows urlsplit on %j', (src, hosted) => {
    expect(isSubstackHosted(src)).toBe(hosted);
  });
});
