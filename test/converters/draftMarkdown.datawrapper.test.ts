// Port of upstream packages/gateway_drafts/tests/test_draft_markdown_datawrapper.py
// (bc2e875), test names in camelCase. The round trip needs draftBodyToMarkdown,
// which comes with the serializer in Task 14.

import { describe, expect, it } from 'vitest';
import { DraftMarkdownError } from '../../src/converters/dialect/errors';
import type { Node } from '../../src/converters/dialect/inline';
import { markdownToDraftBody } from '../../src/converters/draftMarkdown';

function nodes(markdown: string): Node[] {
  return (JSON.parse(markdownToDraftBody(markdown)) as Node).content ?? [];
}

describe('test_draft_markdown_datawrapper', () => {
  it('datawrapperFenceBecomesPlaceholder', () => {
    expect(nodes('```datawrapper\nhttps://www.datawrapper.de/_/boimj/\n```')).toEqual([
      { type: '_unresolved_datawrapper', attrs: { url: 'https://www.datawrapper.de/_/boimj/' } },
    ]);
  });

  it('plainCodeFenceIsUnaffected', () => {
    expect(nodes('```python\nprint(1)\n```')[0]?.type).toBe('highlighted_code_block');
  });

  // TODO(Task 14): needs draftBodyToMarkdown.
  it.todo('datawrapperNodeRoundTripsToFence');

  it.each([
    'https://app.datawrapper.de/chart/AbC12/visualize',
    'https://example.com/not-a-chart',
    '',
    'https://www.datawrapper.de/_/boimj/ https://www.datawrapper.de/_/other/',
  ])('badDatawrapperFenceIsAMarkdownErrorAtItsLine %j', (body) => {
    const markdown = ['Intro.', '', '```datawrapper', ...(body ? [body] : []), '```'].join('\n');
    let err: unknown;
    try {
      markdownToDraftBody(markdown);
    } catch (caught) {
      err = caught;
    }
    expect(err).toBeInstanceOf(DraftMarkdownError);
    expect((err as DraftMarkdownError).line).toBe(3);
    expect((err as DraftMarkdownError).reason).toContain('Datawrapper');
  });

  it('whitespaceAroundDatawrapperUrlIsIgnored', () => {
    const [node] = nodes('```datawrapper\n  https://datawrapper.dwcdn.net/boimj/2/  \n\n```');
    expect(node?.attrs?.url).toBe('https://datawrapper.dwcdn.net/boimj/2/');
  });
});
