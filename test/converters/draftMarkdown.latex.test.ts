// The tests of upstream packages/gateway_drafts/tests/test_draft_markdown_latex.py
// (bc2e875) that need the whole Markdown converter; the fence-level ones are in
// dialect/fences.test.ts. The round trips need draftBodyToMarkdown, which comes
// with the serializer in Task 14.

import { describe, expect, it } from 'vitest';
import type { Node } from '../../src/converters/dialect/inline';
import { markdownToDraftBody } from '../../src/converters/draftMarkdown';

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
  // TODO(Task 14): needs draftBodyToMarkdown.
  it.todo('latexBlockRendersBackToDisplayMathWithItsId');
  it.todo('roundTripPreservesMultilineExpressionAndId');
  it.todo('idSurvivesASecondRoundTrip');
});
