// Port of upstream packages/gateway_drafts/tests/test_draft_markdown_image.py
// (bc2e875), test names in camelCase.

import { describe, expect, it } from 'vitest';
import { fillDefaults } from '../../src/converters/dialect/attrs';
import type { Node } from '../../src/converters/dialect/inline';
import { draftBodyToMarkdown, markdownToDraftBody } from '../../src/converters/draftMarkdown';
import { docWithImage } from './dialect/helpers';

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

  it('captionedImageNodeRoundTrips', () => {
    const body = JSON.stringify(docWithImage({ src: HOSTED, alt: 'A cat', width: 10, height: 10 }));
    const markdown = draftBodyToMarkdown(body);
    expect(markdown).toBe(`![A cat](${HOSTED}){height=10 width=10}\n`);
    expect(JSON.parse(markdownToDraftBody(markdown))).toStrictEqual(JSON.parse(body));
  });

  it('captionedImageWithNullAltRoundTrips', () => {
    const body = JSON.stringify(docWithImage({ src: HOSTED, alt: null }));
    expect(draftBodyToMarkdown(body)).toBe(`![](${HOSTED})\n`);
  });

  it('imageMarkdownCannotReproduceFallsBackToAVerbatimFence', () => {
    // An image2 missing most of its attributes (or hosted elsewhere) cannot be
    // written as ![alt](src) without changing the node, so it is kept verbatim.
    const image = {
      type: 'captionedImage',
      content: [{ type: 'image2', attrs: { src: 'https://s3/x.png' } }],
    };
    const markdown = draftBodyToMarkdown(JSON.stringify({ type: 'doc', content: [image] }));
    expect(markdown.startsWith('```substack-node\n')).toBe(true);
    expect(nodes(markdown)).toStrictEqual([image]);
  });
});
