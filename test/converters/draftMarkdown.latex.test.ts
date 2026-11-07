// The tests of upstream packages/gateway_drafts/tests/test_draft_markdown_latex.py
// (bc2e875) that need the whole Markdown converter; the fence-level ones are in
// dialect/fences.test.ts.

import { describe, expect, it } from 'vitest';
import type { Node } from '../../src/converters/dialect/inline';
import { draftBodyToMarkdown, markdownToDraftBody } from '../../src/converters/draftMarkdown';

function nodes(markdown: string): Node[] {
  return (JSON.parse(markdownToDraftBody(markdown)) as Node).content ?? [];
}

describe('TestLatexAmongOtherBlocks', () => {
  it('paragraphsSurroundingLatexArePreserved', () => {
    const types = nodes('Before\n\n$$E = mc^2$$\n\nAfter').map((n) => n.type);
    expect(types).toEqual(['paragraph', 'latex_block', 'paragraph']);
  });
});

describe('TestLatexRoundTrip', () => {
  it('latexBlockRendersBackToDisplayMathWithItsId', () => {
    const body = markdownToDraftBody('$$E = mc^2$$');
    const latexId = (JSON.parse(body) as Node).content?.[0]?.attrs?.id;
    expect(draftBodyToMarkdown(body)).toBe(`$$ {id=${latexId}}\nE = mc^2\n$$\n`);
  });

  it('roundTripPreservesMultilineExpressionAndId', () => {
    const original = '$$ {id=ABCDEFGHIJ}\na + b\nc + d\n$$\n';
    expect(draftBodyToMarkdown(markdownToDraftBody(original))).toBe(original);
  });

  it('idSurvivesASecondRoundTrip', () => {
    const body = markdownToDraftBody('$$x$$');
    const again = markdownToDraftBody(draftBodyToMarkdown(body));
    expect(JSON.parse(again)).toStrictEqual(JSON.parse(body));
  });
});
