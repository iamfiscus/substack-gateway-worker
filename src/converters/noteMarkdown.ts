// Markdown -> Substack note payload. Port of upstream
// packages/gateway_core/src/gateway_core/converters/markdown.py (bc2e875):
// markdown_to_doc and markdown_to_note_payload. Byte-identical to upstream on
// the goldens in test/fixtures/golden/note/.
//
// Python `re` / `str` semantics are reproduced explicitly where JS differs:
// - `\s` and `str.strip()` / `rstrip()` use Python's whitespace set (it has
//   U+001C..U+001F and U+0085, and not U+FEFF, unlike JS `\s` / `trim()`);
// - `\d` is any Unicode decimal digit (`\p{Nd}`), as in Python;
// - `.` is "anything but \n" (`[^\n]`): JS `.` also stops at \r, U+2028, U+2029.

export class NoteMarkdownError extends Error {
  override name = 'NoteMarkdownError';
}

type Mark = { type: string };
export type TextNode = { type: 'text'; text: string; marks?: Mark[] };
export type ParagraphNode = { type: 'paragraph'; content: TextNode[] };
export type Doc = { type: 'doc'; attrs: { schemaVersion: string }; content: ParagraphNode[] };
export type NotePayload = {
  bodyJson: Doc;
  tabId: string;
  surface: string;
  replyMinimumRole: string;
  attachmentIds?: string[];
};

// Substack note payload envelope constants
const TAB_ID = 'for-you';
const SURFACE = 'feed';
const REPLY_MIN_ROLE = 'everyone';
const SCHEMA_VERSION = 'v1';

/** Python's `\s` for str patterns, which is also exactly `str.isspace()`. */
const PY_SPACE =
  '\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const PY_SPACE_CHAR = new RegExp(`^[${PY_SPACE}]$`);

// Character loops rather than /[...]+$/, which is quadratic on long space runs.
function pyRstrip(s: string): string {
  let end = s.length;
  while (end > 0 && PY_SPACE_CHAR.test(s.charAt(end - 1))) end--;
  return s.slice(0, end);
}

function pyStrip(s: string): string {
  let start = 0;
  while (start < s.length && PY_SPACE_CHAR.test(s.charAt(start))) start++;
  return pyRstrip(s.slice(start));
}

// Inline formatting: bold before italic so ** is not consumed by single-* rule.
const INLINE = new RegExp(
  [
    '\\*\\*([^\\n]*?)\\*\\*', // bold
    '\\*([^\\n]*?)\\*', // italic
    '`([^\\n]*?)`', // code
    '\\[([^\\]]+)\\]\\(([^)]+)\\)', // link -> "text (url)"
  ].join('|'),
  'gu',
);
const HEADING = new RegExp(`^#{1,6}[${PY_SPACE}]+([^\\n]*)`, 'u');
const UNORDERED = new RegExp(`^[-*][${PY_SPACE}]+([^\\n]*)`, 'u');
const ORDERED = new RegExp(`^(\\p{Nd}+)\\.[${PY_SPACE}]+([^\\n]*)`, 'u');

/**
 * Parse a markdown string into a Substack ProseMirror document node.
 * Throws NoteMarkdownError (upstream: ValueError) if the markdown is empty or
 * produces no content.
 */
export function markdownToDoc(markdown: string): Doc {
  const text = markdown.replaceAll('\\n', '\n');

  if (!pyStrip(text)) {
    throw new NoteMarkdownError(
      'Note body cannot be empty - at least one paragraph with content is required',
    );
  }

  const paragraphs = text.split('\n\n').flatMap(processBlock);

  if (paragraphs.length === 0) {
    throw new NoteMarkdownError('Note must contain at least one paragraph with actual content');
  }

  return { type: 'doc', attrs: { schemaVersion: SCHEMA_VERSION }, content: paragraphs };
}

/** Convert a markdown string to a Substack note creation payload. */
export function markdownToNotePayload(markdown: string, attachmentIds?: string[]): NotePayload {
  const payload: NotePayload = {
    bodyJson: markdownToDoc(markdown),
    tabId: TAB_ID,
    surface: SURFACE,
    replyMinimumRole: REPLY_MIN_ROLE,
  };
  if (attachmentIds && attachmentIds.length > 0) payload.attachmentIds = attachmentIds;
  return payload;
}

function processBlock(block: string): ParagraphNode[] {
  const paragraphs: ParagraphNode[] = [];
  let accumulated: string[] = [];
  const flush = (): void => {
    if (accumulated.length > 0) {
      const nodes = parseInline(accumulated.join('\n'));
      if (nodes.length > 0) paragraphs.push(paragraph(nodes));
    }
    accumulated = [];
  };

  for (const line of block.split('\n')) {
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      const text = pyRstrip(heading[1] ?? '');
      if (text) paragraphs.push(paragraph(parseInline(text).map(bold)));
      continue;
    }
    const bullet = UNORDERED.exec(line);
    if (bullet) {
      flush();
      const text = pyRstrip(bullet[1] ?? '');
      if (text) paragraphs.push(paragraph([textNode('• '), ...parseInline(text)]));
      continue;
    }
    const ordered = ORDERED.exec(line);
    if (ordered) {
      flush();
      const text = pyRstrip(ordered[2] ?? '');
      if (text) paragraphs.push(paragraph([textNode(`${ordered[1]}. `), ...parseInline(text)]));
      continue;
    }
    if (pyStrip(line)) accumulated.push(line);
    else flush();
  }

  flush();
  return paragraphs;
}

// Groups of INLINE: 1=bold 2=italic 3=code 4/5=link
function inlineNode(m: RegExpExecArray): TextNode | null {
  if (m[1] !== undefined) return textNode(m[1], 'bold');
  if (m[2] !== undefined) return textNode(m[2], 'italic');
  if (m[3] !== undefined) return textNode(m[3], 'code');
  if (m[4] !== undefined) return textNode(`${m[4]} (${m[5]})`);
  return null;
}

function parseInline(text: string): TextNode[] {
  const nodes: TextNode[] = [];
  let lastEnd = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > lastEnd) nodes.push(textNode(text.slice(lastEnd, m.index)));
    const node = inlineNode(m);
    if (node) nodes.push(node);
    lastEnd = m.index + m[0].length;
  }
  if (lastEnd < text.length) nodes.push(textNode(text.slice(lastEnd)));
  return nodes.filter((n) => n.text);
}

function textNode(text: string, ...markTypes: string[]): TextNode {
  const node: TextNode = { type: 'text', text };
  if (markTypes.length > 0) node.marks = markTypes.map((type) => ({ type }));
  return node;
}

function bold(node: TextNode): TextNode {
  const existing = node.marks ?? [];
  if (existing.some((m) => m.type === 'bold')) return node;
  return { ...node, marks: [...existing, { type: 'bold' }] };
}

function paragraph(content: TextNode[]): ParagraphNode {
  return { type: 'paragraph', content };
}
