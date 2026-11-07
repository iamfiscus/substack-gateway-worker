// Port of upstream packages/gateway_drafts/tests/test_draft_markdown_image.py
// (bc2e875), test names in camelCase. The round trips need draftBodyToMarkdown,
// which comes with the serializer in Task 14.

import { describe, expect, it } from 'vitest';
import { fillDefaults } from '../../src/converters/dialect/attrs';
import type { Node } from '../../src/converters/dialect/inline';
import { markdownToDraftBody } from '../../src/converters/draftMarkdown';

const HOSTED = 'https://substack-post-media.s3.amazonaws.com/public/images/cat_10x10.png';

function nodes(markdown: string): Node[] {
  return (JSON.parse(markdownToDraftBody(markdown)) as Node).content ?? [];
}

describe('test_draft_markdown_image', () => {
  it('externalImageLineBecomesPlaceholder', () => {
    expect(nodes('![A cat](https://x/cat.png)')).toEqual([
      {
        type: '_unresolved_image',
        attrs: { src: 'https://x/cat.png', alt: 'A cat', image_attrs: {}, watermark: null },
      },
    ]);
  });

  it('hostedImageLineBecomesCaptionedImageDirectly', () => {
    const attrs = fillDefaults('image2', { src: HOSTED, alt: 'A cat' });
    expect(nodes(`![A cat](${HOSTED})`)).toEqual([
      { type: 'captionedImage', content: [{ type: 'image2', attrs }] },
    ]);
  });

  it('dataUriImageIsParsedWhole', () => {
    const [node] = nodes('![](data:image/png;base64,QUJDRA==)');
    expect(node?.type).toBe('_unresolved_image');
    expect(node?.attrs?.src).toBe('data:image/png;base64,QUJDRA==');
    expect(node?.attrs?.alt).toBe('');
  });

  // TODO(Task 14): needs draftBodyToMarkdown.
  it.todo('captionedImageNodeRoundTrips');
  it.todo('captionedImageWithNullAltRoundTrips');
  it.todo('imageMarkdownCannotReproduceFallsBackToAVerbatimFence');
});
