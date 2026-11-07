// Port of upstream packages/gateway_drafts/src/gateway_drafts/converters/markdown.py
// (bc2e875): draft Markdown -> Substack draft body, a thin facade over dialect/.
//
// `markdownToDraftDoc` parses the draft dialect into a ProseMirror doc
// (throwing DraftMarkdownError on malformed dialect constructs);
// `draftBodyToMarkdown` writes a stored draft body back as dialect Markdown,
// losslessly: `markdownToDraftDoc(draftBodyToMarkdown(body))` gives back the
// doc in `body` (with legacy paragraphs and headings given the default
// `textAlign`).

import { parseBlocks } from './dialect/blocks';
import type { Node } from './dialect/inline';
import { pyJsonDumps, pyJsonLoads } from './dialect/pyJson';
import { serializeDoc } from './dialect/serialize';

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

/**
 * A stored draft body (JSON text, read like `json.loads`) as dialect Markdown.
 * Throws JSONDecodeError when `body` is not JSON.
 */
export function draftBodyToMarkdown(body: string): string {
  // The trailing newline keeps the output multi-line, so feeding it back to
  // `markdownToDraftDoc` never triggers the literal `\n` expansion.
  const markdown = serializeDoc(pyJsonLoads(body));
  return markdown ? `${markdown}\n` : '';
}
