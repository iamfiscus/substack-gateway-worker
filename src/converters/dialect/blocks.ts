// Port of upstream packages/gateway_drafts/src/gateway_drafts/converters/dialect/blocks.py
// (bc2e875): block-level draft Markdown -> Substack ProseMirror nodes.
//
// `parseBlocks` walks the input line by line. Lines are split on `\n` only
// (after normalising `\r\n` / `\r`), never like Python's `str.splitlines()`:
// attribute values may hold U+2028 and friends. Outside fences, trailing
// whitespace (spaces and tabs) is ignored.
//
// Block syntax, recognised only at the start of a line (a leading backslash
// makes the line paragraph text):
//
// - `#`...`######` headings, `-` / `*` / `+` and `N.` list items, `>`
//   blockquote and `|>` pullquote (bodies parsed recursively);
// - fences (see fences.ts) and `$$` LaTeX;
// - `---` horizontal rule, `![alt](src){attrs}` image,
//   `::button[Text]{href=...}`, `::defaults{align=X}` (first line only);
// - `:::align{X}` / `:::callout` containers closed by a bare `:::`.
//
// Every other line is paragraph text; consecutive ones join with a space.
// Malformed dialect constructs throw DraftMarkdownError with the 1-based line
// number of the input.
//
// Python regex semantics kept: `\d` is any Unicode decimal digit, `\w` is
// Unicode (`\p{L}\p{N}_`), and `.` matches U+2028/U+2029 (lines never hold
// `\n`, so dotAll is the same as Python's `.`). Attribute keys stay own data
// properties, so `__proto__` is an ordinary key. Known JS limit: a float
// `watermark-opacity` such as `'40.0'` (single-quoted JSON) is the number 40
// here, so it is accepted where Python rejects a float.

import { type Attrs, fillDefaults } from './attrs';
import { DraftMarkdownError, PyValueError } from './errors';
import { attrsAt, type Fence, HSPACE, oneLineLatex, openFence } from './fences';
import { type Node, parseInline } from './inline';
import { asciiDigits, pyLstrip, pyRstrip, pyStrip, setOwn } from './pyStr';
import { hostname, urlsplit } from './pyUrl';

type Line = [number, string];

// Images already re-hosted on Substack's own S3/CDN (e.g. uploaded earlier via
// the upload_image primitive). Re-posting a Substack-owned URL to the image
// endpoint returns a payload without the `bytes` field and keeps the same
// asset, so such an image is built directly instead of re-uploaded. The URL's
// host is compared exactly (`hostname` is already lower-case): `substackcdn.com`
// or a subdomain of it, and the `substack-post-media` bucket's virtual-hosted
// S3 endpoint, with or without a region.
const SUBSTACK_CDN = 'substackcdn.com';
const SUBSTACK_S3 = /^substack-post-media\.s3(?:\.[a-z0-9-]+)?\.amazonaws\.com$/;

const HEADING = /^(#{1,6})[ \t]+(.*)/s;
const BULLET = /^[-*+][ \t]+(.*)/s;
const ORDERED = /^(\p{Nd}+)\.[ \t]+(.*)/su;
const QUOTE = /^(>|\|>) ?(.*)/s;
const IMAGE = /^!\[([^\]]*)\]\(([^)]+)\)(?:[ \t]*\{(.*)\})?$/s;
const DIRECTIVE = /^::(button|defaults)(?![\p{L}\p{N}_-])(.*)$/su;
const CONTAINER = /^:::(align|callout)(?![\p{L}\p{N}_-])(.*)$/su;
const BUTTON = /^\[((?:\\.|[^\\\]])*)\]\{(.*)\}$/s;
const ESCAPE = /\\([!-/:-@[-`{-~])/g;
const WATERMARK_SCALE = /^(\p{Nd}+(?:\.\p{Nd}+)?)%$/u;

export const ALIGN_VALUES: Readonly<Record<string, string | null>> = {
  left: 'left',
  center: 'center',
  right: 'right',
  justify: 'justify',
  default: null,
};
export const BUTTON_URLS: Readonly<Record<string, string>> = {
  subscribe: '%%checkout_url%%',
  share: '%%share_url%%',
  comment: '%%half_magic_comments_url%%',
};
export const SIZE_PRESETS: Readonly<Record<string, Readonly<Attrs>>> = {
  normal: { imageSize: 'normal', resizeWidth: 0 },
  large: { imageSize: 'large', resizeWidth: 1200 },
  full: { imageSize: 'full', resizeWidth: null },
};
export const WATERMARK_POSITIONS = ['top-right', 'top-left', 'bottom-right', 'bottom-left'];
export const WATERMARK_DEFAULT_SCALE = 0.06;
export const WATERMARK_DEFAULT_OPACITY = 65;
export const MAX_QUOTE_DEPTH = 32;

/** Whether `src` is an http(s) URL on one of Substack's own image hosts. */
export function isSubstackHosted(src: string): boolean {
  let parts: ReturnType<typeof urlsplit>;
  try {
    parts = urlsplit(src);
  } catch (err) {
    if (err instanceof PyValueError) return false; // e.g. an unbalanced IPv6 bracket
    throw err;
  }
  const host = hostname(parts.netloc);
  if (!['http', 'https'].includes(parts.scheme) || !host) return false;
  if (host === SUBSTACK_CDN || host.endsWith(`.${SUBSTACK_CDN}`)) return true;
  return SUBSTACK_S3.test(host);
}

/** Parse draft dialect Markdown into top-level ProseMirror nodes. */
export function parseBlocks(markdown: string): Node[] {
  const text = markdown.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  const lines = text.split('\n').map((raw, index): Line => [index + 1, raw]);
  return new Parser(lines, new Context()).parse();
}

class Context {
  constructor(
    readonly defaultAlign: string | null = null,
    readonly inQuote = false,
    readonly inAlign = false,
    readonly align: string | null = null,
    readonly depth = 0, // quote nesting level
  ) {}
}

class Frame {
  readonly nodes: Node[] = [];

  constructor(
    readonly kind: 'root' | 'callout' | 'align',
    readonly line = 0,
    readonly align: string | null = null,
  ) {}
}

/** Python `dict.pop(key, fallback)` for own keys. */
function pop(attrs: Attrs, key: string, fallback?: unknown): unknown {
  if (!Object.hasOwn(attrs, key)) return fallback;
  const value = attrs[key];
  delete attrs[key];
  return value;
}

class Parser {
  private defaultAlign: string | null;
  private readonly frames: Frame[] = [new Frame('root')];
  private fence: Fence | null = null;
  private seenBlock = false;
  private para: string[] = [];
  private listKind: string | null = null;
  private listItems: Node[] = [];
  private quoteKind: string | null = null;
  private quoteLines: Line[] = [];

  constructor(
    private readonly lines: Line[],
    private readonly ctx: Context,
  ) {
    this.defaultAlign = ctx.defaultAlign;
  }

  // --- driver -------------------------------------------------------------

  parse(): Node[] {
    for (const [number, raw] of this.lines) this.line(number, raw);
    if (this.fence !== null) throw this.fence.unclosed();
    this.flush();
    if (this.frames.length > 1) {
      const frame = this.frames.at(-1) as Frame;
      throw new DraftMarkdownError(
        `unclosed :::${frame.kind} container: close it with a line holding only :::`,
        frame.line,
      );
    }
    return (this.frames[0] as Frame).nodes;
  }

  private line(number: number, raw: string): void {
    if (this.fence !== null) {
      if (this.fence.closesOn(raw)) {
        this.emit(this.fence.build());
        this.fence = null;
      } else {
        this.fence.body.push(raw);
      }
      return;
    }
    const text = pyRstrip(raw, HSPACE);
    const stripped = pyLstrip(text, HSPACE);
    if (!stripped) {
      this.flushPara();
      if (this.quoteKind) this.quoteLines.push([number, '']);
      return;
    }
    const first = !this.seenBlock;
    this.seenBlock = true;
    const quote = QUOTE.exec(pyLstrip(raw, HSPACE));
    if (quote) {
      this.quoteLine(number, quote[1] as string, quote[2] as string);
      return;
    }
    this.flushQuote();
    if (!this.block(number, text, stripped, first)) {
      this.flushList();
      this.para.push(stripped);
    }
  }

  /** Handle a non-paragraph line; return false when it is paragraph text. */
  private block(number: number, text: string, stripped: string, first: boolean): boolean {
    const bullet = BULLET.exec(text);
    if (bullet) return this.listLine('bullet', bullet[1] as string);
    const ordered = ORDERED.exec(text);
    if (ordered) return this.listLine('ordered', ordered[2] as string);
    const node = this.leaf(number, text, stripped, first);
    if (node === false) return false;
    this.flush();
    if (node !== true) this.emit(node);
    return true;
  }

  /**
   * A node to emit, true (handled, nothing to emit) or false (the line is
   * paragraph text).
   */
  private leaf(number: number, text: string, stripped: string, first: boolean): Node | boolean {
    if (stripped === '---') return { type: 'horizontal_rule' };
    if (stripped === ':::') {
      this.flush();
      this.closeContainer(number);
      return true;
    }
    if (stripped.startsWith(':::')) return this.container(number, stripped);
    if (stripped.startsWith('::')) return this.directive(number, stripped, first);
    const heading = HEADING.exec(text);
    if (heading) {
      return this.heading((heading[1] as string).length, pyStrip(heading[2] as string, HSPACE));
    }
    const latex = oneLineLatex(stripped);
    if (latex) return latex;
    const fence = openFence(stripped, number);
    if (fence) {
      this.flush();
      this.fence = fence;
      return true;
    }
    const image = IMAGE.exec(stripped);
    if (image) return imageNode(image[1] as string, image[2] as string, image[3], number);
    return false;
  }

  // --- emitting and flushing ----------------------------------------------

  private emit(node: Node): void {
    (this.frames.at(-1) as Frame).nodes.push(node);
  }

  private flush(): void {
    this.flushPara();
    this.flushList();
    this.flushQuote();
  }

  private flushPara(): void {
    const joined = this.para.join(' ');
    this.para = [];
    if (!joined) return;
    const content = parseInline(joined);
    if (content.length > 0) this.emit(this.paragraph(content));
  }

  private flushList(): void {
    if (this.listItems.length > 0) {
      const node: Node = { type: `${this.listKind}_list` };
      if (this.listKind === 'ordered') node.attrs = fillDefaults('ordered_list', {});
      node.content = this.listItems;
      this.emit(node);
    }
    this.listKind = null;
    this.listItems = [];
  }

  private flushQuote(): void {
    const kind = this.quoteKind;
    const lines = this.quoteLines;
    this.quoteKind = null;
    this.quoteLines = [];
    if (lines.length === 0) return;
    if (this.ctx.depth >= MAX_QUOTE_DEPTH) {
      throw new DraftMarkdownError(
        `quotes nest deeper than ${MAX_QUOTE_DEPTH} levels`,
        (lines[0] as Line)[0],
      );
    }
    const [inside, align] = this.alignment();
    const ctx = new Context(this.defaultAlign, true, inside, align, this.ctx.depth + 1);
    const content = new Parser(lines, ctx).parse();
    if (content.length === 0) return;
    if (kind === '>') {
      this.emit({ type: 'blockquote', content });
    } else {
      const attrs = fillDefaults('pullquote', {});
      this.emit({ type: 'pullquote', attrs, content });
    }
  }

  // --- alignment ------------------------------------------------------------

  /** [inside an :::align container, its alignment]. */
  private alignment(): [boolean, string | null] {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const frame = this.frames[i] as Frame;
      if (frame.kind === 'align') return [true, frame.align];
    }
    return [this.ctx.inAlign, this.ctx.align];
  }

  private paragraph(content: Node[]): Node {
    const [inside, align] = this.alignment();
    const textAlign = inside ? align : this.defaultAlign;
    return { type: 'paragraph', attrs: { textAlign }, content };
  }

  private heading(level: number, text: string): Node {
    const [inside, align] = this.alignment();
    const attrs = { level, textAlign: inside ? align : null };
    return { type: 'heading', attrs, content: parseInline(text) };
  }

  // --- lists and quotes ---------------------------------------------------

  private listLine(kind: string, item: string): boolean {
    this.flushPara();
    if (this.listKind !== kind) {
      this.flushList();
      this.listKind = kind;
    }
    const content = parseInline(pyStrip(item, HSPACE));
    if (content.length > 0) {
      this.listItems.push({ type: 'list_item', content: [this.paragraph(content)] });
    }
    return true;
  }

  private quoteLine(number: number, kind: string, body: string): void {
    this.flushPara();
    this.flushList();
    if (this.quoteKind !== kind) {
      this.flushQuote();
      this.quoteKind = kind;
    }
    this.quoteLines.push([number, body]);
  }

  // --- containers and directives --------------------------------------------

  private container(number: number, stripped: string): boolean {
    const match = CONTAINER.exec(stripped);
    if (match === null) return false;
    const kind = match[1] as 'align' | 'callout';
    const rest = match[2] as string;
    if (!['', '{'].includes(rest.slice(0, 1))) throw malformed(`:::${kind}`, number);
    this.flush();
    if (kind === 'callout') {
      if (rest) throw new DraftMarkdownError(':::callout takes no attributes', number);
      if (this.ctx.inQuote || this.frames.length > 1) {
        throw new DraftMarkdownError(
          ':::callout is allowed only at the top level, not inside a quote or another container',
          number,
        );
      }
      this.frames.push(new Frame('callout', number));
      return true;
    }
    const value = rest.endsWith('}') ? pyStrip(rest.slice(1, -1), HSPACE) : null;
    if (value === null || !Object.hasOwn(ALIGN_VALUES, value)) {
      throw new DraftMarkdownError(
        ':::align needs one of {left|center|right|justify|default}, e.g. :::align{center}',
        number,
      );
    }
    if (this.alignment()[0]) {
      throw new DraftMarkdownError(':::align containers do not nest', number);
    }
    this.frames.push(new Frame('align', number, ALIGN_VALUES[value] as string | null));
    return true;
  }

  private closeContainer(number: number): void {
    if (this.frames.length === 1) {
      throw new DraftMarkdownError(
        '::: closes no open container (write \\::: for literal text)',
        number,
      );
    }
    const frame = this.frames.pop() as Frame;
    if (frame.kind === 'align') {
      const parent = (this.frames.at(-1) as Frame).nodes;
      for (const node of frame.nodes) parent.push(node);
      return;
    }
    const node: Node = { type: 'calloutBlock' };
    if (frame.nodes.length > 0) node.content = frame.nodes;
    this.emit(node);
  }

  private directive(number: number, stripped: string, first: boolean): Node | boolean {
    const match = DIRECTIVE.exec(stripped);
    if (match === null) return false;
    const name = match[1] as 'button' | 'defaults';
    const rest = match[2] as string;
    if (!['', '[', '{'].includes(rest.slice(0, 1))) throw malformed(`::${name}`, number);
    if (name === 'button') return button(rest, number);
    const topLevel = !this.ctx.inQuote && this.frames.length === 1;
    if (!(first && topLevel)) {
      throw new DraftMarkdownError('::defaults is allowed only once, as the first line', number);
    }
    this.defaultAlign = defaultsAlign(rest, number);
    return true;
  }
}

const FORMS: Readonly<Record<string, string>> = {
  '::button': '::button[Text]{href=URL}',
  '::defaults': '::defaults{align=X}',
  ':::align': ':::align{X}',
  ':::callout': ':::callout',
};

function malformed(name: string, number: number): DraftMarkdownError {
  return new DraftMarkdownError(
    `malformed ${name} line: write it as ${FORMS[name]} with no space before ` +
      `{ or [ and nothing after it (start the line with a backslash, ` +
      `\\${name}, for literal text)`,
    number,
  );
}

function defaultsAlign(rest: string, number: number): string | null {
  const attrs = rest.endsWith('}') ? attrsAt(rest.slice(1, -1), number) : null;
  const value = attrs !== null && Object.keys(attrs).length === 1 ? attrs.align : undefined;
  if (typeof value !== 'string' || !Object.hasOwn(ALIGN_VALUES, value)) {
    throw new DraftMarkdownError(
      '::defaults needs {align=left|center|right|justify|default}',
      number,
    );
  }
  return ALIGN_VALUES[value] as string | null;
}

function unescapeText(text: string): string {
  return text.replace(ESCAPE, '$1');
}

function button(rest: string, number: number): Node {
  const match = BUTTON.exec(rest);
  const text = match ? unescapeText(match[1] as string) : '';
  const attrs = match ? attrsAt(match[2], number) : {};
  const href = pop(attrs, 'href', null);
  if (!text || typeof href !== 'string' || !href) {
    throw new DraftMarkdownError(
      '::button needs a text and an href: ::button[Text]{href=URL}, where ' +
        'URL may be subscribe, share or comment',
      number,
    );
  }
  const url = Object.hasOwn(BUTTON_URLS, href) ? (BUTTON_URLS[href] as string) : href;
  return { type: 'button', attrs: fillDefaults('button', { url, text, ...attrs }) };
}

function imageNode(alt: string, src: string, attrText: string | undefined, number: number): Node {
  const attrs = attrsAt(attrText, number);
  const imageAttrs: Attrs = {};
  if (Object.hasOwn(attrs, 'size')) {
    const size = pop(attrs, 'size');
    if (typeof size !== 'string' || !Object.hasOwn(SIZE_PRESETS, size)) {
      throw new DraftMarkdownError('image size must be normal, large or full', number);
    }
    Object.assign(imageAttrs, SIZE_PRESETS[size], { align: 'center', fullscreen: false });
  }
  if (Object.hasOwn(attrs, 'original')) {
    const original = pop(attrs, 'original');
    if (typeof original !== 'string' || !original) {
      throw new DraftMarkdownError('image original= needs a URL', number);
    }
    imageAttrs.srcNoWatermark = original;
  }
  const mark = watermark(attrs, number);
  for (const [key, value] of Object.entries(attrs)) setOwn(imageAttrs, key, value);
  if (mark === null && isSubstackHosted(src)) {
    const final = fillDefaults('image2', { ...imageAttrs, src, alt: alt || null });
    return { type: 'captionedImage', content: [{ type: 'image2', attrs: final }] };
  }
  return {
    type: '_unresolved_image',
    attrs: { src, alt, image_attrs: imageAttrs, watermark: mark },
  };
}

/** Pop the watermark keys from `attrs` and return the instruction. */
function watermark(attrs: Attrs, number: number): Attrs | null {
  if (!Object.hasOwn(attrs, 'watermark')) {
    if (Object.hasOwn(attrs, 'watermark-pos') || Object.hasOwn(attrs, 'watermark-opacity')) {
      throw new DraftMarkdownError('watermark-pos / watermark-opacity need watermark too', number);
    }
    return null;
  }
  const value = pop(attrs, 'watermark');
  let scale = WATERMARK_DEFAULT_SCALE;
  if (value !== true) {
    const match = typeof value === 'string' ? WATERMARK_SCALE.exec(value) : null;
    const percent = match ? Number(asciiDigits(match[1] as string)) : 0;
    if (!(percent > 0 && percent <= 100)) {
      throw new DraftMarkdownError(
        'watermark takes no value or a percentage of the image width, e.g. watermark=8%',
        number,
      );
    }
    scale = percent / 100;
  }
  const position = pop(attrs, 'watermark-pos', 'top-right');
  if (typeof position !== 'string' || !WATERMARK_POSITIONS.includes(position)) {
    throw new DraftMarkdownError(
      `watermark-pos must be one of ${WATERMARK_POSITIONS.join(', ')}`,
      number,
    );
  }
  const opacity = pop(attrs, 'watermark-opacity', WATERMARK_DEFAULT_OPACITY);
  if (typeof opacity !== 'number' || !Number.isInteger(opacity) || opacity < 0 || opacity > 100) {
    throw new DraftMarkdownError('watermark-opacity must be a whole number from 0 to 100', number);
  }
  return { scale, position, opacity };
}
