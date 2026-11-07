// Port of upstream packages/gateway_drafts/tests/test_draft_markdown_datawrapper.py
// (bc2e875), test names in camelCase.

import { describe, expect, it } from 'vitest';
import { DraftMarkdownError } from '../../src/converters/dialect/errors';
import type { Node } from '../../src/converters/dialect/inline';
import { pyJsonDumps } from '../../src/converters/dialect/pyJson';
import { draftBodyToMarkdown, markdownToDraftBody } from '../../src/converters/draftMarkdown';

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

  it('datawrapperNodeRoundTripsToFence', () => {
    // A stored datawrapper node carries thumbnails and metadata the
    // ```datawrapper fence cannot express, so it is written verbatim as a
    // substack-node fence and parses back to the very same node.
    const node = {
      type: 'datawrapper',
      attrs: {
        url: 'https://datawrapper.dwcdn.net/boimj/2/',
        thumbnail_url: 'https://s3/x.png',
        thumbnail_url_full: 'https://s3/x-full.png',
        height: 400,
        title: 'T',
        description: '',
      },
    };
    const markdown = draftBodyToMarkdown(JSON.stringify({ type: 'doc', content: [node] }));
    expect(markdown).toBe(`\`\`\`substack-node\n${pyJsonDumps(node, 2)}\n\`\`\`\n`);
    expect(nodes(markdown)).toStrictEqual([node]);
  });

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
