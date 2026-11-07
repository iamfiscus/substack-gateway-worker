// Port of upstream packages/gateway_drafts/tests/_dialect_helpers.py (bc2e875):
// shared builders for the draft Markdown dialect tests.

import { fillDefaults } from '../../../src/converters/dialect/attrs';
import type { Mark, Node } from '../../../src/converters/dialect/inline';

/**
 * Build a ProseMirror text node: `t('a', 'strong', 'em')`. A trailing
 * `{ href }` adds a default-attrs link mark first.
 */
export function t(text: string, ...rest: Array<string | { href?: string }>): Node {
  const node: Node = { type: 'text', text };
  const last = rest.at(-1);
  const href = typeof last === 'object' ? last.href : undefined;
  const marks: Mark[] = rest
    .filter((m): m is string => typeof m === 'string')
    .map((type) => ({ type }));
  if (href) {
    marks.unshift({
      type: 'link',
      attrs: {
        href,
        target: '_blank',
        rel: 'noopener noreferrer nofollow',
        class: null,
      },
    });
  }
  if (marks.length > 0) node.marks = marks;
  return node;
}

/** Build a paragraph holding one plain text node, with `textAlign`. */
export function p(text: string, align: string | null = null): Node {
  return { type: 'paragraph', attrs: { textAlign: align }, content: [t(text)] };
}

/** Build a doc holding one `captionedImage` with these `image2` attrs. */
export function docWithImage(image2Attrs: Record<string, unknown> = {}): Node {
  const attrs = fillDefaults('image2', { alt: 'H', ...image2Attrs });
  const image = { type: 'captionedImage', content: [{ type: 'image2', attrs }] };
  return { type: 'doc', content: [image] };
}
