// Port of upstream packages/gateway_drafts/src/gateway_drafts/converters/markdown.py
// (bc2e875): draft Markdown -> Substack draft body, a thin facade over dialect/.
//
// `markdownToDraftDoc` parses the draft dialect into a ProseMirror doc
// (throwing DraftMarkdownError on malformed dialect constructs). The way back,
// `draftBodyToMarkdown`, comes with the serializer.

import { parseBlocks } from './dialect/blocks';
import type { Node } from './dialect/inline';
import { pyJsonDumps } from './dialect/pyJson';

export function markdownToDraftDoc(markdown: string): Node {
  // Only expand literal `\n` escapes for single-line input (agents often send
  // JSON-escaped newlines). Multi-line input already carries real newlines, and
  // expanding there would corrupt LaTeX/escape sequences that legitimately
  // start with `\n` (`\neg`, `\nabla`, `\nu`). Serializer output always ends
  // with a newline, so it is never expanded here.
  const text = markdown.includes('\n') ? markdown : markdown.replaceAll('\\n', '\n');
  return { type: 'doc', content: parseBlocks(text) };
}

/** `json.dumps(markdown_to_draft_doc(markdown), ensure_ascii=False)`. */
export function markdownToDraftBody(markdown: string): string {
  return pyJsonDumps(markdownToDraftDoc(markdown));
}
