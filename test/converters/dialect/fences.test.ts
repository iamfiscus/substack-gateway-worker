// Port of upstream packages/gateway_drafts/tests/test_datawrapper_url.py and
// test_draft_markdown_latex.py (bc2e875), at the level of fences.ts. The LaTeX
// tests that need the full Markdown converter (blocks among paragraphs, round
// trips) are in draftMarkdown.latex.test.ts; here the same inputs go through
// the fence functions. The fence-only goldens are checked with a minimal line
// driver that feeds lines to the fence functions. It is not blocks.py: it skips
// every other block rule, its flushing and its dispatch order, so it only suits
// inputs made of fences. The real parser runs every golden in
// draftDoc.golden.test.ts.

import { afterEach, describe, expect, it } from 'vitest';
import { DraftMarkdownError } from '../../../src/converters/dialect/errors';
import {
  attrsAt,
  type Fence,
  latexBlock,
  latexId,
  normalizeDatawrapperUrl,
  oneLineLatex,
  openFence,
  setLatexIdGenerator,
} from '../../../src/converters/dialect/fences';
import type { Node } from '../../../src/converters/dialect/inline';
import { canonicalJson } from '../../support/canon';
import { goldenInput, readGolden } from '../../support/golden';

const RESOLVE = 'https://www.datawrapper.de/_/boimj/';
const ID_RE = /^[A-Z]{10}$/;

function thrown(fn: () => unknown): DraftMarkdownError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(DraftMarkdownError);
    return err as DraftMarkdownError;
  }
  throw new Error('expected an exception');
}

/** Fence lines only: open, collect and close fences; every other line is ignored. */
function parseFences(markdown: string): Node[] {
  const lines = markdown.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  const nodes: Node[] = [];
  let fence: Fence | null = null;
  lines.forEach((raw, index) => {
    if (fence) {
      if (fence.closesOn(raw)) {
        nodes.push(fence.build());
        fence = null;
      } else {
        fence.body.push(raw);
      }
      return;
    }
    const stripped = raw.replace(/^[ \t]+|[ \t]+$/g, '');
    if (!stripped) return;
    const latex = oneLineLatex(stripped);
    if (latex) nodes.push(latex);
    else fence = openFence(stripped, index + 1);
  });
  if (fence) throw (fence as Fence).unclosed();
  return nodes;
}

/** Fence lines in, ProseMirror nodes out. */
function build(...lines: string[]): Node[] {
  return parseFences(lines.join('\n'));
}

function latexBlocks(markdown: string): Node[] {
  return parseFences(markdown).filter((n) => n.type === 'latex_block');
}

afterEach(() => setLatexIdGenerator(null));

describe('test_datawrapper_url', () => {
  it.each([
    'https://www.datawrapper.de/_/boimj/',
    'https://www.datawrapper.de/_/boimj',
    'https://datawrapper.dwcdn.net/boimj/2/',
    'https://datawrapper.dwcdn.net/boimj/',
  ])('knownFormsNormalizeToResolveUrl %s', (url) => {
    expect(normalizeDatawrapperUrl(url)).toBe(RESOLVE);
  });

  it('unparseableUrlRaises', () => {
    const err = thrown(() => normalizeDatawrapperUrl('https://example.com/not-a-chart'));
    expect(err.message).toBe(
      "not a Datawrapper chart URL: 'https://example.com/not-a-chart'; a ```datawrapper " +
        'fence holds one published chart URL, https://www.datawrapper.de/_/<id>/ or ' +
        'https://datawrapper.dwcdn.net/<id>/',
    );
    expect(err.line).toBeUndefined();
  });

  it('reportsTheLineWhenGiven', () => {
    expect(thrown(() => normalizeDatawrapperUrl('', 4)).message).toMatch(
      /^line 4: not a Datawrapper chart URL: ''; /,
    );
  });

  it('refusesSeveralUrlsSplitByPythonWhitespace', () => {
    // U+3000 is whitespace for str.split() (and \s in JS), U+FEFF only in JS.
    expect(() => normalizeDatawrapperUrl(`${RESOLVE}\u3000${RESOLVE}`)).toThrow(DraftMarkdownError);
    expect(normalizeDatawrapperUrl(`${RESOLVE}\ufeff`)).toBe(RESOLVE);
  });
});

describe('test_draft_markdown_latex', () => {
  describe('TestLatexBlockNode', () => {
    it('singleLineDisplayMathBecomesLatexBlock', () => {
      const blocks = latexBlocks('$$E = mc^2$$');
      expect(blocks).toHaveLength(1);
      expect(blocks[0]?.attrs?.persistentExpression).toBe('E = mc^2');
    });

    it('nodeHasRandomUppercaseId', () => {
      expect(latexBlocks('$$x$$')[0]?.attrs?.id).toMatch(ID_RE);
    });

    it('dirtyFlagIsNotEmitted', () => {
      // `dirty` is transient editor state; it must never be sent.
      expect(latexBlocks('$$x$$')[0]?.attrs).not.toHaveProperty('dirty');
    });

    it('multilineFencedBlock', () => {
      const blocks = latexBlocks('$$\nP(S) = 0.20\nP(\\neg S) = 0.80\n$$');
      expect(blocks).toHaveLength(1);
      expect(blocks[0]?.attrs?.persistentExpression).toBe('P(S) = 0.20\nP(\\neg S) = 0.80');
    });

    it('backslashesArePreserved', () => {
      expect(latexBlocks(String.raw`$$\frac{a}{b}$$`)[0]?.attrs?.persistentExpression).toBe(
        String.raw`\frac{a}{b}`,
      );
    });

    it('twoBlocksGetDistinctIds', () => {
      const blocks = latexBlocks('$$a$$\n\n$$b$$');
      expect(blocks).toHaveLength(2);
      expect(blocks[0]?.attrs?.id).not.toBe(blocks[1]?.attrs?.id);
    });
  });

  describe('TestLatexAmongOtherBlocks', () => {
    it('dollarDollarInsideCodeFenceIsLiteral', () => {
      const nodes = parseFences('```\n$$not latex$$\n```');
      expect(nodes.map((n) => n.type)).toEqual(['highlighted_code_block']);
      expect(nodes[0]?.content).toEqual([{ type: 'text', text: '$$not latex$$' }]);
    });
  });

  describe('TestLatexRoundTrip', () => {
    it('givenIdIsKept', () => {
      expect(build('$$ {id=ABCDEFGHIJ}', 'a + b', 'c + d', '$$')).toEqual([
        {
          type: 'latex_block',
          attrs: { persistentExpression: 'a + b\nc + d', id: 'ABCDEFGHIJ' },
        },
      ]);
    });
  });
});

describe('latexId', () => {
  it('isTenUppercaseLetters', () => {
    const ids = new Set(Array.from({ length: 50 }, latexId));
    for (const id of ids) expect(id).toMatch(ID_RE);
    expect(ids.size).toBeGreaterThan(1);
  });

  it('canBeReplacedForGoldens', () => {
    setLatexIdGenerator(() => 'GOLDENID00');
    expect(latexId()).toBe('GOLDENID00');
    expect(latexBlock('x', {})).toEqual({
      type: 'latex_block',
      attrs: { persistentExpression: 'x', id: 'GOLDENID00' },
    });
    setLatexIdGenerator(null);
    expect(latexId()).toMatch(ID_RE);
  });

  it('isNotGeneratedWhenGiven', () => {
    setLatexIdGenerator(() => {
      throw new Error('not called');
    });
    expect(latexBlock('x', { id: 'ABCDEFGHIJ', extra: 1 }).attrs).toEqual({
      persistentExpression: 'x',
      id: 'ABCDEFGHIJ',
      extra: 1,
    });
  });
});

describe('fences', () => {
  it('codeFenceFillsDefaultsAndKeepsBodyVerbatim', () => {
    expect(build('```python {nodeId=n1}', '  x  ', '', '```')).toEqual([
      {
        type: 'highlighted_code_block',
        attrs: { language: 'python', nodeId: 'n1' },
        content: [{ type: 'text', text: '  x  \n' }],
      },
    ]);
  });

  it('emptyCodeFenceHasNoTextNode', () => {
    expect(build('```', '```')).toEqual([
      { type: 'highlighted_code_block', attrs: { language: null, nodeId: null } },
    ]);
  });

  it('closingLineMayHaveSpacesAndTabsOnly', () => {
    const fence = openFence('```', 1) as Fence;
    expect(fence.closesOn(' \t``` ')).toBe(true);
    expect(fence.closesOn('```\u00a0')).toBe(false);
    expect((openFence('$$', 1) as Fence).closesOn('  $$')).toBe(true);
  });

  it('nonFenceLinesOpenNothing', () => {
    expect(openFence('text', 1)).toBeNull();
    expect(openFence('$$x$$', 1)).toBeNull();
    expect(oneLineLatex('$$$$')).toBeNull();
  });

  it('oneLineLatexStripsSpacesAndTabsOnly', () => {
    expect(oneLineLatex('$$ \tx\u00a0 $$')?.attrs?.persistentExpression).toBe('x\u00a0');
  });

  it('dotMatchesLineSeparators', () => {
    // Python `.` matches U+2028; JS `.` does not.
    expect(oneLineLatex('$$a\u2028b$$')?.attrs?.persistentExpression).toBe('a\u2028b');
    // U+2029 is whitespace inside the block, so it splits the item there.
    expect(openFence('```py {nodeId=a\u2029b}', 1)?.attrs).toEqual({
      language: 'py',
      nodeId: 'a',
      b: true,
    });
  });

  it('attributeErrorsNameTheFenceLineOnce', () => {
    const err = thrown(() => openFence('```py {=x}', 7));
    expect(err.message).toBe("line 7: attribute block: missing key before '=' in '=x'");
    expect(err.reason).toBe("attribute block: missing key before '=' in '=x'");
  });

  it('attrsAtWithoutBlockIsEmpty', () => {
    expect(attrsAt(undefined, 1)).toEqual({});
    expect(attrsAt(null, 1)).toEqual({});
    expect(attrsAt('a=1', 1)).toEqual({ a: 1 });
  });

  it('verbatimFenceTakesNoAttributesButReportsAttributeErrorsFirst', () => {
    expect(thrown(() => openFence('```datawrapper {}', 2)).message).toBe(
      'line 2: ```datawrapper fences take no attributes',
    );
    expect(thrown(() => openFence('```substack-node {a="x}', 2)).message).toBe(
      "line 2: attribute block: unterminated \" quote for 'a'",
    );
  });

  it('datawrapperFenceKeepsTheStrippedUrl', () => {
    expect(build('```datawrapper', '\u3000https://datawrapper.dwcdn.net/x1/ ', '```')).toEqual([
      { type: '_unresolved_datawrapper', attrs: { url: 'https://datawrapper.dwcdn.net/x1/' } },
    ]);
  });

  it('substackNodeIsKeptVerbatim', () => {
    const [node] = build(
      '```substack-node',
      '{"type": "x",',
      ' "attrs": {"__proto__": [1.5, null]}}',
      '```',
    );
    expect(node?.type).toBe('x');
    expect(Object.hasOwn(node?.attrs ?? {}, '__proto__')).toBe(true);
    expect(Object.entries(node?.attrs ?? {})).toEqual([['__proto__', [1.5, null]]]);
  });

  it('substackNodeErrors', () => {
    const message = (...body: string[]) =>
      thrown(() => build('```substack-node', ...body, '```')).message;
    expect(message('{"type": "x",', '  oops}')).toBe(
      'line 1: substack-node fence holds invalid JSON (Expecting property name enclosed ' +
        'in double quotes at fence body line 2, column 3); do not edit its JSON',
    );
    expect(message(`${'['.repeat(201)}`)).toBe(
      'line 1: substack-node fence JSON cannot be read: JSON nested deeper than 200 levels',
    );
    expect(message(`{"type": "x", "n": ${'9'.repeat(4301)}}`)).toMatch(
      /^line 1: substack-node fence JSON cannot be read: Exceeds the limit \(4300 digits\)/,
    );
    expect(message('{"type": 1}')).toBe(
      'line 1: substack-node fence must hold one JSON object with a "type"',
    );
    expect(message('{"type": "x", "content": [{"attrs": {"type": "_a"}}]}')).toBe(
      "line 1: substack-node fence holds the internal node type '_a'; " +
        'node types starting with "_" are not allowed',
    );
  });

  it('internalTypeIsTheLastPoppedFirst', () => {
    // Upstream walks a stack (pop from the end), so the later sibling wins.
    expect(
      thrown(() =>
        build('```substack-node', '{"type": "x", "a": {"type": "_a"}, "b": {"type": "_b"}}', '```'),
      ).message,
    ).toMatch(/internal node type '_b'/);
  });
});

const ERROR_GOLDENS = [
  'construct-errors-datawrapper-editor-url',
  'construct-errors-datawrapper-empty',
  'construct-errors-fence-attrs-on-substack-node',
  'construct-errors-invalid-substack-node',
  'construct-errors-malformed-fence-opener',
  'construct-errors-substack-node-internal-type',
  'construct-errors-unclosed-code-fence',
  'construct-errors-unclosed-latex',
  'param-serialize-code-containing-a-fence-line-falls-back-01',
  'param-serialize-code-containing-a-fence-line-falls-back-02',
  'param-serialize-code-containing-a-fence-line-falls-back-03',
  'pyjs-isspace-code-lang',
  'pyjs-isspace-datawrapper-split',
  'test-blocks-malformed-directive-or-fence-opener-errors-on-its-own-line-03',
  'test-blocks-malformed-directive-or-fence-opener-errors-on-its-own-line-08',
  'test-blocks-more-errors-name-the-line-01',
  'test-blocks-more-errors-name-the-line-02',
  'test-blocks-more-errors-name-the-line-03',
  'test-blocks-more-errors-name-the-line-19',
  'test-blocks-more-errors-name-the-line-20',
  'test-blocks-substack-node-rejects-internal-placeholder-types-02',
  'test-datawrapper-bad-datawrapper-fence-is-a-markdown-error-at-its-line-01',
  'test-datawrapper-bad-datawrapper-fence-is-a-markdown-error-at-its-line-02',
  'test-datawrapper-bad-datawrapper-fence-is-a-markdown-error-at-its-line-04',
];

const DOC_GOLDENS = [
  'construct-code',
  'construct-datawrapper',
  'construct-latex',
  'no-trailing-newline-fence',
  'pyjs-dot-line-separator-in-code-attrs',
  'pyjs-dot-line-separator-in-latex',
  'pyjs-isspace-datawrapper-strip',
  'test-blocks-block-syntax-inside-code-fence-is-literal',
  'test-blocks-code-fence',
  'test-blocks-code-fence-language-may-contain-punctuation',
  'test-blocks-code-fence-without-language-and-with-node-id-01',
  'test-blocks-code-fence-without-language-and-with-node-id-02',
  'test-blocks-datawrapper-fence-is-placeholder',
  'test-blocks-empty-code-fence-has-no-empty-text-node',
  'test-blocks-generated-latex-ids-differ',
  'test-blocks-latex-id-is-kept-when-given',
  'test-blocks-multiline-latex-keeps-lines-and-backslashes',
];

describe('fence-only goldens', () => {
  it.each(ERROR_GOLDENS)('error %s', (name) => {
    const golden = JSON.parse(readGolden('draft-error', name)) as Record<string, unknown>;
    const err = thrown(() => parseFences(goldenInput(name)));
    expect({ error: err.name, line: err.line, message: err.reason, str: err.message }).toEqual(
      golden,
    );
  });

  it.each(DOC_GOLDENS)('doc %s', (name) => {
    setLatexIdGenerator(() => 'GOLDENID00');
    const doc = { type: 'doc', content: parseFences(goldenInput(name)) };
    expect(canonicalJson(doc)).toBe(canonicalJson(JSON.parse(readGolden('draft-doc', name))));
  });
});
