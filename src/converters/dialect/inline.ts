// Port of upstream packages/gateway_drafts/src/gateway_drafts/converters/dialect/inline.py
// (bc2e875): inline Markdown <-> ProseMirror text nodes for the draft dialect.
//
// Supported marks: `strong` (`**`), `em` (`*`), `strikethrough` (`~~`),
// optionally inside one `link` (`[...](href)`), and `code` (`` ` ``) alone.
// Delimiters wrap the exact text, inner whitespace included (`a** x **b` is
// strong " x "), but a delimiter run with whitespace or a text boundary on both
// sides is literal (`2 * 3`).
//
// `parseInline` is a character scanner with a mark stack: a delimiter closes
// the mark on top of the stack if it can, otherwise opens a mark that is not yet
// active, otherwise it is literal. A `]` without a valid `(target)` turns its
// `[` into literal text. Openers still unclosed at the end become literal text,
// so parsing never fails. `serializeInline` writes the fixed nesting order
// link > strong > em > strikethrough and returns null whenever the content
// cannot be written so that `parseInline` gives it back.
//
// The scanner walks UTF-16 units where upstream walks code points; every
// character it gives a meaning to is ASCII and no astral character is
// whitespace, so the results are the same. Whitespace is Python's `isspace()`.

import { diffFromDefaults, fillDefaults } from './attrs';
import { isSpace } from './pyStr';

export type Mark = { type: string; attrs?: Record<string, unknown> };
export type Node = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
  text?: string;
  marks?: Mark[];
};

const RANK: Record<string, number> = { link: 0, strong: 1, em: 2, strikethrough: 3, code: 4 };
const DELIMITER: Record<string, string> = { strong: '**', em: '*', strikethrough: '~~' };
const TEXT_ESCAPED = new Set('\\*`[]~{}');
const HREF_ESCAPED = new Set('\\()');
// Python's string.punctuation.
const PUNCTUATION = new Set('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~');

/** Backslash-escape every character the inline dialect gives a meaning to. */
export function escapeText(text: string): string {
  let out = '';
  for (const c of text) out += TEXT_ESCAPED.has(c) ? `\\${c}` : c;
  return out;
}

function escapeHref(href: string): string {
  let out = '';
  for (const c of href) out += HREF_ESCAPED.has(c) ? `\\${c}` : c;
  return out;
}

// --- parsing ----------------------------------------------------------------

/** Whether `text[pos]` is a backslash escaping an ASCII punctuation character. */
function isEscape(text: string, pos: number): boolean {
  return text.charAt(pos) === '\\' && PUNCTUATION.has(text.charAt(pos + 1));
}

function unescapePunctuation(raw: string): string {
  let out = '';
  let pos = 0;
  while (pos < raw.length) {
    if (isEscape(raw, pos)) {
      out += raw.charAt(pos + 1);
      pos += 2;
    } else {
      out += raw.charAt(pos);
      pos += 1;
    }
  }
  return out;
}

/**
 * Map each unescaped `(` to its balanced `)` if no whitespace lies between.
 *
 * Every target scan starts right after the `(` of a `](`, which always begins a
 * fresh escape pair, so one left-to-right pass serves all of them.
 */
function linkTargets(text: string): Map<number, number> {
  const targets = new Map<number, number>();
  const opens: Array<[number, number]> = []; // [index, whitespace seen before it]
  let spaces = 0;
  let pos = 0;
  while (pos < text.length) {
    if (isEscape(text, pos)) {
      pos += 2;
      continue;
    }
    const char = text.charAt(pos);
    if (isSpace(char)) {
      spaces += 1;
    } else if (char === '(') {
      opens.push([pos, spaces]);
    } else if (char === ')' && opens.length > 0) {
      const [start, seen] = opens.pop() as [number, number];
      if (seen === spaces) targets.set(start, pos);
    }
    pos += 1;
  }
  return targets;
}

function runEnd(text: string, pos: number): number {
  let end = pos;
  while (end < text.length && text.charAt(end) === text.charAt(pos)) end += 1;
  return end;
}

function spaced(text: string, pos: number): boolean {
  return pos < 0 || pos >= text.length || isSpace(text.charAt(pos));
}

function literalRun(text: string, start: number, end: number): boolean {
  return spaced(text, start - 1) && spaced(text, end);
}

type Token = {
  kind: 'text' | 'code' | 'open' | 'close';
  value: string; // literal text, code text, or the raw delimiter
  mark: string;
  href: string;
};

function token(kind: Token['kind'], value: string, mark = ''): Token {
  return { kind, value, mark, href: '' };
}

class Scanner {
  private pos = 0;
  private readonly tokens: Token[] = [];
  private readonly stack: number[] = []; // indices of open tokens, innermost last
  private readonly active = new Map<string, number>();
  private buffer: string[] = [];
  private runEnd = 0; // end of the delimiter run being consumed
  private lookahead: [number, number] = [-1, 0]; // [runEnd, next run length]
  private targets: Map<number, number> | null = null;

  constructor(private readonly text: string) {}

  run(): Token[] {
    const text = this.text;
    while (this.pos < text.length) {
      const char = text.charAt(this.pos);
      if (isEscape(text, this.pos)) {
        this.literal(text.charAt(this.pos + 1), 2);
      } else if (char === '`') {
        this.code();
      } else if (char === '*' || text.startsWith('~~', this.pos)) {
        this.delimiter();
      } else if (char === '[') {
        this.open('link', '[');
      } else if (char === ']' && this.isActive('link')) {
        this.closeLink();
      } else {
        this.literal(char, 1);
      }
    }
    this.flush();
    this.demote(this.stack.map((_, depth) => depth));
    return this.tokens;
  }

  private isActive(mark: string): boolean {
    return (this.active.get(mark) ?? 0) > 0;
  }

  private bump(mark: string, delta: number): void {
    this.active.set(mark, (this.active.get(mark) ?? 0) + delta);
  }

  private top(): string {
    const index = this.stack.at(-1);
    return index === undefined ? '' : (this.tokens[index] as Token).mark;
  }

  private literal(chars: string, advance: number): void {
    this.buffer.push(chars);
    this.pos += advance;
  }

  private flush(): void {
    if (this.buffer.length > 0) {
      this.tokens.push(token('text', this.buffer.join('')));
      this.buffer = [];
    }
  }

  private open(mark: string, raw: string): void {
    this.flush();
    this.stack.push(this.tokens.length);
    this.tokens.push(token('open', raw, mark));
    this.bump(mark, 1);
    this.pos += raw.length;
  }

  private close(raw: string): void {
    this.flush();
    const mark = (this.tokens[this.stack.pop() as number] as Token).mark;
    this.bump(mark, -1);
    this.tokens.push(token('close', raw, mark));
    this.pos += raw.length;
  }

  /** Turn the openers at these stack depths into literal text. */
  private demote(depths: number[]): void {
    // Deepest first: every removal then shifts only the few entries above it.
    for (const depth of [...depths].sort((a, b) => b - a)) {
      const index = this.stack.splice(depth, 1)[0] as number;
      const tok = this.tokens[index] as Token;
      this.bump(tok.mark, -1);
      this.tokens[index] = token('text', tok.value);
    }
  }

  private code(): void {
    const end = this.text.indexOf('`', this.pos + 1);
    if (end <= this.pos + 1) {
      // unclosed or empty: literal backtick
      this.literal('`', 1);
      return;
    }
    this.flush();
    this.tokens.push(token('code', this.text.slice(this.pos + 1, end)));
    this.pos = end + 1;
  }

  private delimiter(): void {
    const text = this.text;
    const pos = this.pos;
    if (pos >= this.runEnd) {
      // first character of a new run
      this.runEnd = runEnd(text, pos);
      if (literalRun(text, pos, this.runEnd)) {
        this.literal(text.slice(pos, this.runEnd), this.runEnd - pos);
        return;
      }
    }
    const top = this.top();
    if (text.charAt(pos) === '~') {
      if (top === 'strikethrough') this.close('~~');
      else if (!this.isActive('strikethrough')) this.open('strikethrough', '~~');
      else this.literal('~', 1);
      return;
    }
    const remaining = this.runEnd - pos;
    const strong = this.isActive('strong');
    const em = this.isActive('em');
    if (top === 'em' && remaining === 2 && !strong) {
      this.open('strong', '**'); // em wraps strong: *a **b** c*
    } else if (top === 'em') {
      this.close('*');
    } else if (top === 'strong' && remaining >= 2) {
      this.close('**');
    } else if (remaining >= 3 && !strong && !em) {
      if (this.nextRunLength() === 2) {
        // ***a** b*: strong closes first
        this.open('em', '*');
        this.open('strong', '**');
      } else {
        this.open('strong', '**');
        this.open('em', '*');
      }
    } else if (remaining >= 2 && !strong) {
      this.open('strong', '**');
    } else if (!em) {
      this.open('em', '*');
    } else {
      this.literal('*', 1);
    }
  }

  /** Length of the next non-literal `*` run after the current one. */
  private nextRunLength(): number {
    if (this.lookahead[0] !== this.runEnd) {
      this.lookahead = [this.runEnd, this.scanNextRun()];
    }
    return this.lookahead[1];
  }

  private scanNextRun(): number {
    const text = this.text;
    let pos = this.runEnd;
    while (pos < text.length) {
      const char = text.charAt(pos);
      if (isEscape(text, pos)) {
        pos += 2;
      } else if (char === '`') {
        const end = text.indexOf('`', pos + 1);
        pos = end > pos + 1 ? end + 1 : pos + 1;
      } else if (char === '*') {
        const end = runEnd(text, pos);
        if (!literalRun(text, pos, end)) return end - pos;
        pos = end;
      } else {
        pos += 1;
      }
    }
    return 0;
  }

  private markAt(depth: number): string {
    return (this.tokens[this.stack[depth] as number] as Token).mark;
  }

  private closeLink(): void {
    // At most three non-link marks can sit above the innermost "[".
    let depth = this.stack.length - 1;
    while (this.markAt(depth) !== 'link') depth -= 1;
    const start = this.pos + 1;
    let end: number | undefined;
    if (this.text.charAt(start) === '(') {
      this.targets ??= linkTargets(this.text);
      end = this.targets.get(start);
    }
    if (end === undefined) {
      // not a link: its "[" is literal text
      this.demote([depth]);
      this.literal(']', 1);
      return;
    }
    // Marks opened inside the link text and still open there are literal.
    const inside: number[] = [];
    for (let d = depth + 1; d < this.stack.length; d++) inside.push(d);
    this.demote(inside);
    const link = this.tokens[this.stack.at(-1) as number] as Token;
    link.href = unescapePunctuation(this.text.slice(start + 1, end));
    this.close(this.text.slice(this.pos, end + 1));
    // Links cannot nest: any enclosing "[" is literal text.
    if (this.isActive('link')) {
      const links: number[] = [];
      this.stack.forEach((_, d) => {
        if (this.markAt(d) === 'link') links.push(d);
      });
      this.demote(links);
    }
  }
}

function markFor(tok: Token): Mark {
  if (tok.mark === 'link') return { type: 'link', attrs: fillDefaults('link', { href: tok.href }) };
  return { type: tok.mark };
}

function byRank(marks: Mark[]): Mark[] {
  return [...marks].sort((a, b) => (RANK[a.type] as number) - (RANK[b.type] as number));
}

// A run of adjacent text with the same marks: [ordered marks, text parts].
type Run = [Mark[], string[]];

function append(runs: Run[], text: string, marks: Mark[]): void {
  if (!text) return;
  const ordered = byRank(marks);
  const last = runs.at(-1);
  if (last && deepEqual(last[0], ordered)) {
    last[1].push(text); // joined once at the end, never re-copied
    return;
  }
  runs.push([ordered, [text]]);
}

/** Parse inline dialect Markdown into merged ProseMirror text nodes. */
export function parseInline(text: string): Node[] {
  const runs: Run[] = [];
  const active: Mark[] = [];
  for (const tok of new Scanner(text).run()) {
    if (tok.kind === 'text') append(runs, tok.value, active);
    else if (tok.kind === 'code') append(runs, tok.value, [...active, { type: 'code' }]);
    else if (tok.kind === 'open') active.push(markFor(tok));
    else active.pop();
  }
  return runs.map(([marks, parts]) => {
    const node: Node = { type: 'text', text: parts.join('') };
    if (marks.length > 0) node.marks = marks;
    return node;
  });
}

// --- serializing ------------------------------------------------------------

function isDict(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Python `==` for JSON values: structural, order-insensitive for objects. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (!isDict(a) || !isDict(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
}

/** `value in some_dict` in Python: unhashable values raise TypeError. */
function isRanked(type: unknown): type is string {
  if (typeof type === 'object' && type !== null) {
    throw new TypeError(`unhashable type: '${Array.isArray(type) ? 'list' : 'dict'}'`);
  }
  return typeof type === 'string' && Object.hasOwn(RANK, type);
}

/** The node's marks in canonical order, or null if not expressible. */
function expressibleMarks(node: unknown): Mark[] | null {
  if (!isDict(node) || node.type !== 'text') return null;
  const text = node.text;
  const marks = Object.hasOwn(node, 'marks') ? node.marks : [];
  if (typeof text !== 'string' || !Array.isArray(marks)) return null;
  if (!marks.every((m) => isDict(m) && isRanked(m.type))) return null;
  const typed = marks as Mark[];
  const types = typed.map((mark) => mark.type);
  if (new Set(types).size !== types.length) return null;
  if (types.includes('code') && (types.length > 1 || text.includes('`'))) return null;
  for (const mark of typed) {
    if (mark.type === 'link' && !plainLink(mark)) return null;
  }
  return byRank(typed);
}

function plainLink(mark: Mark): boolean {
  const attrs = mark.attrs;
  if (!isDict(attrs) || typeof attrs.href !== 'string') return false;
  return Object.keys(diffFromDefaults('link', attrs)).every((key) => key === 'href');
}

function opener(mark: Mark): string {
  return mark.type === 'link' ? '[' : (DELIMITER[mark.type] as string);
}

function closer(mark: Mark): string {
  if (mark.type === 'link') return `](${escapeHref(mark.attrs?.href as string)})`;
  return DELIMITER[mark.type] as string;
}

/** Write text nodes as inline dialect Markdown, or null if not expressible. */
export function serializeInline(content: readonly unknown[]): string | null {
  const out: string[] = [];
  const stack: Mark[] = [];
  for (const node of content) {
    const marks = expressibleMarks(node);
    if (marks === null) return null;
    const isCode = marks.length > 0 && marks[0]?.type === 'code';
    const wanted = isCode ? [] : marks;
    let keep = 0;
    while (keep < Math.min(stack.length, wanted.length) && deepEqual(stack[keep], wanted[keep])) {
      keep += 1;
    }
    while (stack.length > keep) out.push(closer(stack.pop() as Mark));
    for (const mark of wanted.slice(keep)) {
      out.push(opener(mark));
      stack.push(mark);
    }
    const text = (node as Node).text as string;
    out.push(isCode ? `\`${text}\`` : escapeText(text));
  }
  while (stack.length > 0) out.push(closer(stack.pop() as Mark));
  const markdown = out.join('');
  return deepEqual(parseInline(markdown), content) ? markdown : null;
}
