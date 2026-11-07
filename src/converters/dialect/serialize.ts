// Port of upstream packages/gateway_drafts/src/gateway_drafts/converters/dialect/serialize.py
// (bc2e875): Substack ProseMirror doc -> draft dialect Markdown, losslessly.
//
// `serializeDoc` writes every top-level block in readable dialect syntax when it
// can and as a ```` ```substack-node ```` fence (the node's JSON) when it
// cannot. Each block it writes is re-parsed with `parseBlocks` under the same
// `::defaults` line and compared with the original node; a mismatch replaces
// the block with a fence, so `parseBlocks(serializeDoc(doc))` gives back
// `doc.content` by construction. A final whole-document check guards against
// block interactions the per-block check cannot see.
//
// Legacy shape: drafts written by older gateway versions store `paragraph` and
// `heading` nodes without `attrs` (or without `textAlign`). Substack treats a
// missing `textAlign` as the default null, so the content is normalised first
// (that one default filled in, at the top level and inside quotes, callouts
// and lists only; any other node is kept exactly as stored) and every
// comparison and fence works on the normalised nodes.
//
// Alignment: the most frequent paragraph `textAlign` (ties -> none) becomes the
// `::defaults{align=X}` line; consecutive blocks whose paragraphs and headings
// all share another alignment are wrapped in one `:::align{X}` container.
//
// Python semantics kept: the input is arbitrary JSON, so every place where
// upstream would raise (a missing key, `.get` on a non-dict, `dict()` of a
// list, an unhashable node type in a set lookup) throws here too, and is
// caught at the same level: a block writer failing falls back that block, a
// failure outside the writers falls back the whole document. Comparisons
// require equal types (`true` is not `1`) and NaN never equals itself; `sorted`
// orders by code point. Known JS limits: `1.0` and `1` are the same number, so
// a float upstream writes as `'1.0'` (or fences) can come out readable here;
// integer-like keys ("1") come first in JS object order, so attribute blocks
// and fence JSON holding them list those keys first (the round trip is still
// lossless; see test/converters/knownDiffs.ts); input nested past the JS stack
// rather than Python's recursion limit is what makes a fence body `null`.

import { type Attrs, diffFromDefaults, formatAttrBlock } from './attrs';
import { ALIGN_VALUES, BUTTON_URLS, parseBlocks, SIZE_PRESETS } from './blocks';
import { HSPACE } from './fences';
import { serializeInline } from './inline';
import { pyJsonDumps } from './pyJson';
import { pyLstrip, setOwn } from './pyStr';

type Dict = Record<string, unknown>;
type Writer = (node: Dict, defaultAlign: string | null, inAlign: boolean) => string | null;

/** Placement of a block that needs no `:::align` container. */
const OUTSIDE = Symbol('outside');
/** An alignment value the dialect cannot write. */
const INVALID = Symbol('invalid');
type Align = string | null | typeof INVALID;
type Placement = string | null | typeof INVALID | typeof OUTSIDE;

const BUTTON_HREFS = new Map(Object.entries(BUTTON_URLS).map(([name, url]) => [url, name]));
const SIZE_KEYS = ['imageSize', 'resizeWidth', 'align', 'fullscreen'];
const LINE_START = ['#', '>', '|>', '-', '+', '::', '$$', '```', '!'];
const ORDERED_START = /^\p{Nd}+\./u;
// Node types whose Markdown merges with an adjacent block of the same type.
const MERGING = new Set(['blockquote', 'pullquote', 'bullet_list', 'ordered_list']);
const FENCE = '```substack-node';
const TEXT_ALIGNED = new Set(['paragraph', 'heading']);
// Containers the dialect writes itself; any other node (unknown or written as a
// fence) is left exactly as stored, children included.
const ALIGN_CONTAINERS = new Set([
  'blockquote',
  'pullquote',
  'calloutBlock',
  'bullet_list',
  'ordered_list',
  'list_item',
]);

const warnToConsole = (message: string): void =>
  console.warn(JSON.stringify({ level: 'warn', msg: message }));
let warn: (message: string) => void = warnToConsole;

/** Replace where serializer warnings go (null restores the console default). */
export function setSerializerWarn(fn: ((message: string) => void) | null): void {
  warn = fn ?? warnToConsole;
}

/** Write a ProseMirror doc as draft dialect Markdown; never throws. */
export function serializeDoc(doc: unknown): string {
  const stored = isDict(doc) ? pyGet(doc, 'content') : null;
  if (!Array.isArray(stored) || stored.length === 0) return '';
  let content: unknown[] = stored;
  try {
    content = content.map(withTextAlign);
    const markdown = new Serializer(content).run();
    if (identical(parseBlocks(markdown), content)) return markdown;
    // Never log the content: drafts are private.
    warn(
      `draft serializer: whole-document check failed for ${content.length} blocks; ` +
        'writing every block as a substack-node fence',
    );
  } catch (err) {
    // any failure degrades to verbatim fences
    warn(
      `draft serializer failed (${errorName(err)}); writing every block as a ` +
        'substack-node fence',
    );
  }
  return content.map(fence).join('\n\n');
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

/**
 * `node` with `textAlign: null` added to every paragraph and heading that lacks
 * it, itself included, descending only through known containers. The input is
 * never mutated; unchanged subtrees are shared.
 */
function withTextAlign(node: unknown): unknown {
  if (!isDict(node)) return node;
  const kind = pyGet(node, 'type');
  if (setHas(TEXT_ALIGNED, kind)) {
    const attrs = pyGet(node, 'attrs');
    if (attrs === null) return { ...node, attrs: { textAlign: null } };
    if (isDict(attrs) && !Object.hasOwn(attrs, 'textAlign')) {
      return { ...node, attrs: { ...attrs, textAlign: null } };
    }
    return node;
  }
  const children = pyGet(node, 'content');
  if (setHas(ALIGN_CONTAINERS, kind) && Array.isArray(children)) {
    return { ...node, content: children.map(withTextAlign) };
  }
  return node;
}

/** Exported for tests only (upstream's tests patch `_Serializer.run`). */
export class Serializer {
  readonly defaultAlign: string | null;
  readonly prefix: string;

  constructor(readonly content: unknown[]) {
    this.defaultAlign = defaultAlign(content);
    this.prefix = '';
    if (this.defaultAlign !== null) {
      this.prefix = `::defaults{align=${alignName(this.defaultAlign)}}`;
    }
  }

  run(): string {
    const blocks = this.prefix ? [this.prefix] : [];
    let previous: string | null = null; // merge kind of the last readable block
    for (const [align, nodes] of units(this.content, this.defaultAlign, true)) {
      if (align !== OUTSIDE) {
        blocks.push(...this.group(align as string | null, nodes));
        previous = null;
        continue;
      }
      for (const node of nodes) {
        const kind = mergeKind(node);
        if (kind !== null && kind === previous) {
          blocks.push(this.separated(node));
          previous = null;
          continue;
        }
        const markdown = block(node, this.defaultAlign, false);
        if (markdown !== null && this.check(markdown, [node])) {
          blocks.push(markdown);
          previous = kind;
        } else {
          blocks.push(fence(node));
          previous = null;
        }
      }
    }
    return blocks.join('\n\n');
  }

  /**
   * `node` in its own `:::align` container, so it cannot merge with the
   * same-kind block before it; a fence when that does not round-trip.
   */
  private separated(node: unknown): string {
    const align = uniformAlign(node);
    let markdown: string | null = null;
    if (align !== INVALID) markdown = block(node, this.defaultAlign, true);
    if (markdown !== null) {
      const wrapped = container(align as string | null, [markdown]);
      if (this.check(wrapped, [node])) return wrapped;
    }
    return fence(node);
  }

  /** One `:::align` container per run of nodes that serialize together. */
  private group(align: string | null, nodes: unknown[]): string[] {
    const out: string[] = [];
    let run: [unknown, string][] = [];
    for (const node of nodes) {
      const markdown = block(node, this.defaultAlign, true);
      if (run.length > 0) {
        const kind = mergeKind(node);
        if (kind && kind === mergeKind((run.at(-1) as [unknown, string])[0])) {
          out.push(...this.runOf(align, run));
          run = [];
        }
      }
      if (markdown === null) {
        out.push(...this.runOf(align, run));
        out.push(fence(node));
        run = [];
      } else {
        run.push([node, markdown]);
      }
    }
    out.push(...this.runOf(align, run));
    return out;
  }

  private runOf(align: string | null, run: [unknown, string][]): string[] {
    if (run.length === 0) return [];
    const parts = run.map(([, md]) => md);
    const markdown = container(align, parts);
    if (
      this.check(
        markdown,
        run.map(([node]) => node),
      )
    )
      return [markdown];
    if (run.length === 1) return [fence((run[0] as [unknown, string])[0])];
    return run.flatMap((item) => this.runOf(align, [item]));
  }

  private check(markdown: string, nodes: unknown[]): boolean {
    const text = this.prefix ? `${this.prefix}\n\n${markdown}` : markdown;
    try {
      return identical(parseBlocks(text), nodes);
    } catch {
      return false; // unparseable output is a mismatch
    }
  }
}

// --- alignment ----------------------------------------------------------------

/** `node` and every dict node below it through `content` lists, in order. */
function* walk(node: unknown): Generator<Dict> {
  const stack: unknown[] = [node];
  while (stack.length > 0) {
    const item = stack.pop();
    if (isDict(item)) {
      yield item;
      const children = pyGet(item, 'content');
      if (Array.isArray(children)) stack.push(...[...children].reverse());
    }
  }
}

function alignName(value: string | null): string {
  return value === null ? 'default' : value;
}

function isAlignValue(value: unknown): value is string {
  return typeof value === 'string' && Object.values(ALIGN_VALUES).includes(value);
}

function alignOf(node: Dict): Align {
  const attrs = pyGet(node, 'attrs');
  const value = isDict(attrs) ? pyGet(attrs, 'textAlign') : null;
  if (value === null || isAlignValue(value)) return value;
  return INVALID;
}

function defaultAlign(content: unknown[]): string | null {
  const counts = new Map<Align, number>();
  for (const top of content) {
    for (const node of walk(top)) {
      if (pyGet(node, 'type') === 'paragraph') {
        const align = alignOf(node);
        counts.set(align, (counts.get(align) ?? 0) + 1);
      }
    }
  }
  // Counter.most_common(2): a tie for the top count gives no default.
  let best: Align = null;
  let bestCount = 0;
  let tied = false;
  for (const [align, n] of counts) {
    if (n > bestCount) {
      best = align;
      bestCount = n;
      tied = false;
    } else if (n === bestCount) {
      tied = true;
    }
  }
  if (bestCount === 0 || tied) return null;
  return best === INVALID ? null : best;
}

/**
 * The one alignment of every paragraph and heading in `node` (null when there
 * are none), or INVALID when they differ.
 */
function uniformAlign(node: unknown): Align {
  const aligns = new Set<Align>();
  for (const item of walk(node)) {
    const type = pyGet(item, 'type');
    if (type === 'paragraph' || type === 'heading') aligns.add(alignOf(item));
  }
  if (aligns.size > 1) return INVALID;
  const [only = null] = aligns;
  return only;
}

/** OUTSIDE or the alignment of the `:::align` container `node` needs. */
function placement(node: unknown, defaultValue: string | null): Placement {
  const paragraphs = new Set<Align>();
  const headings = new Set<Align>();
  for (const item of walk(node)) {
    const type = pyGet(item, 'type');
    if (type === 'paragraph') paragraphs.add(alignOf(item));
    else if (type === 'heading') headings.add(alignOf(item));
  }
  const within = (set: Set<Align>, value: Align) => [...set].every((v) => v === value);
  if (within(paragraphs, defaultValue) && within(headings, null)) return OUTSIDE;
  const align = uniformAlign(node);
  if (align === INVALID || (isDict(node) && pyGet(node, 'type') === 'calloutBlock')) {
    return OUTSIDE; // containers group inside; anything else falls back
  }
  return align;
}

/** Consecutive nodes with the same placement, in order. */
function units(
  nodes: unknown[],
  defaultValue: string | null,
  grouping: boolean,
): [Placement, unknown[]][] {
  const out: [Placement, unknown[]][] = [];
  for (const node of nodes) {
    const align = grouping ? placement(node, defaultValue) : OUTSIDE;
    const last = out.at(-1);
    if (last && last[0] === align) last[1].push(node);
    else out.push([align, [node]]);
  }
  return out;
}

function container(align: string | null, parts: string[]): string {
  return `:::align{${alignName(align)}}\n${parts.join('\n\n')}\n:::`;
}

function mergeKind(node: unknown): string | null {
  const kind = isDict(node) ? pyGet(node, 'type') : null;
  return setHas(MERGING, kind) ? (kind as string) : null;
}

// --- blocks -----------------------------------------------------------------------

/** Readable Markdown for one block, or null when the dialect cannot write it. */
function block(node: unknown, defaultValue: string | null, inAlign: boolean): string | null {
  if (!isDict(node)) return null;
  // `_WRITERS.get(str(node.get("type")))`: only a string type names a writer.
  const type = pyGet(node, 'type');
  if (typeof type !== 'string' || !Object.hasOwn(WRITERS, type)) return null;
  try {
    return (WRITERS[type] as Writer)(node, defaultValue, inAlign);
  } catch {
    return null; // odd attribute shapes fall back
  }
}

/**
 * Blocks inside a quote or callout, joined by blank lines. A block that would
 * merge with the same-kind block before it starts a new `:::align` container
 * (its own alignment, or the group's).
 */
function children(nodes: unknown, defaultValue: string | null, inAlign: boolean): string | null {
  if (!Array.isArray(nodes)) return null;
  const segments: [Placement, string[]][] = []; // (alignment or OUTSIDE, blocks)
  for (const [align, members] of units(nodes, defaultValue, !inAlign)) {
    segments.push([align, []]);
    let previous: string | null = null;
    for (const node of members) {
      const kind = mergeKind(node);
      let target: Placement = align;
      if (kind !== null && kind === previous) {
        if (align === OUTSIDE) {
          target = inAlign ? INVALID : uniformAlign(node);
          if (target === INVALID) return null; // :::align cannot nest
        }
        segments.push([target, []]);
      }
      const markdown = block(node, defaultValue, inAlign || target !== OUTSIDE);
      if (markdown === null) return null;
      (segments.at(-1) as [Placement, string[]])[1].push(markdown);
      previous = kind;
      if (target !== align) {
        // a lone separator container: resume outside
        segments.push([OUTSIDE, []]);
        previous = null;
      }
    }
  }
  return segments
    .filter(([, blocks]) => blocks.length > 0)
    .map(([align, blocks]) =>
      align === OUTSIDE ? blocks.join('\n\n') : container(align as string | null, blocks),
    )
    .join('\n\n');
}

function escapeLineStart(markdown: string): string {
  const match = ORDERED_START.exec(markdown);
  if (match) {
    const dot = match[0].length - 1;
    return `${markdown.slice(0, dot)}\\${markdown.slice(dot)}`;
  }
  if (LINE_START.some((start) => markdown.startsWith(start))) return `\\${markdown}`;
  return markdown;
}

function inline(node: Dict): string | null {
  const content = pyGet(node, 'content');
  if (!Array.isArray(content) || content.length === 0) return null;
  return serializeInline(content);
}

const paragraph: Writer = (node) => {
  const text = inline(node);
  return text === null ? null : escapeLineStart(text);
};

const heading: Writer = (node) => {
  const level = getItem(getItem(node, 'attrs'), 'level');
  const text = inline(node);
  if (typeof level !== 'number' || !Number.isInteger(level) || level < 1 || level > 6) return null;
  if (text === null) return null;
  return `${'#'.repeat(level)} ${text}`;
};

const list: Writer = (node) => {
  const items = getItem(node, 'content');
  // Iterating a str or dict yields strings, whose ["content"] raises: any
  // non-list content gives no Markdown.
  if (!Array.isArray(items)) return null;
  const lines: string[] = [];
  for (const [index, item] of items.entries()) {
    const marker = getItem(node, 'type') === 'ordered_list' ? `${index + 1}.` : '-';
    const paragraphs = getItem(item, 'content');
    if (!Array.isArray(paragraphs) || paragraphs.length !== 1) return null;
    const first = paragraphs[0];
    if (pyGet(asDict(first), 'type') !== 'paragraph') return null;
    const text = inline(first as Dict);
    if (text === null) return null;
    lines.push(`${marker} ${text}`);
  }
  return lines.join('\n') || null;
};

const quote: Writer = (node, defaultValue, inAlign) => {
  const marker = getItem(node, 'type') === 'blockquote' ? '>' : '|>';
  const inner = children(pyGet(node, 'content'), defaultValue, inAlign);
  if (!inner) return null;
  return inner
    .split('\n')
    .map((line) => (line ? `${marker} ${line}` : marker))
    .join('\n');
};

const callout: Writer = (node, defaultValue, inAlign) => {
  const content = Object.hasOwn(node, 'content') ? node.content : [];
  const inner = children(content, defaultValue, inAlign);
  if (inner === null) return null;
  return inner ? `:::callout\n${inner}\n:::` : ':::callout\n:::';
};

const button: Writer = (node) => {
  const attrs = pyDict(getItem(node, 'attrs'));
  const text = pop(attrs, 'text');
  const url = pop(attrs, 'url');
  if (typeof text !== 'string' || typeof url !== 'string') return null;
  const label = text.replaceAll('\\', '\\\\').replaceAll(']', '\\]');
  const extra = diffFromDefaults('button', attrs);
  const blockAttrs: Attrs = { href: BUTTON_HREFS.get(url) ?? url, ...extra };
  return `::button[${label}]${formatAttrBlock(blockAttrs)}`;
};

const image: Writer = (node) => {
  const img = unpackOne(getItem(node, 'content'));
  const attrs = asDict(getItem(img, 'attrs'));
  const src = getItem(attrs, 'src');
  const alt = pyGet(attrs, 'alt');
  if (typeof src !== 'string' || !(alt === null || typeof alt === 'string')) return null;
  const rest = diffFromDefaults('image2', attrs);
  pop(rest, 'src');
  delete rest.alt;
  const sizes: Attrs = {};
  for (const key of SIZE_KEYS) {
    if (Object.hasOwn(rest, key)) setOwn(sizes, key, pop(rest, key));
  }
  const preset = sizePreset(attrs);
  const ordered: Attrs = preset ? { size: preset } : sizes;
  if (Object.hasOwn(rest, 'srcNoWatermark'))
    setOwn(ordered, 'original', pop(rest, 'srcNoWatermark'));
  for (const key of Object.keys(rest).sort(codePointCompare)) setOwn(ordered, key, rest[key]);
  return `![${alt || ''}](${src})${formatAttrBlock(ordered)}`;
};

function sizePreset(attrs: Dict): string | null {
  if (pyGet(attrs, 'align') !== 'center' || pyGet(attrs, 'fullscreen') !== false) return null;
  for (const [name, preset] of Object.entries(SIZE_PRESETS)) {
    if (Object.entries(preset).every(([key, value]) => identical(pyGet(attrs, key), value))) {
      return name;
    }
  }
  return null;
}

const codeBlock: Writer = (node) => {
  const attrs = asDict(getItem(node, 'attrs'));
  const language = pyGet(attrs, 'language');
  let text: unknown = '';
  if (Object.hasOwn(node, 'content')) {
    const child = unpackOne(node.content);
    text = getItem(child, 'text');
  }
  if (typeof text !== 'string' || !(language === null || typeof language === 'string')) {
    return null;
  }
  if (text.split('\n').some((line) => pyLstrip(line, HSPACE).startsWith('```'))) return null;
  const extra = diffFromDefaults('highlighted_code_block', attrs);
  delete extra.language;
  const attrBlock = formatAttrBlock(extra);
  const opener = `\`\`\`${language || ''}${attrBlock ? ` ${attrBlock}` : ''}`;
  return `${opener}\n${text ? `${text}\n` : ''}\`\`\``;
};

const latex: Writer = (node) => {
  const attrs = pyDict(getItem(node, 'attrs'));
  const expression = pop(attrs, 'persistentExpression');
  if (typeof expression !== 'string' || !Object.hasOwn(attrs, 'id')) {
    return null; // without an id the parser would generate a new one
  }
  const opener = `$$ ${formatAttrBlock(attrs)}`;
  return `${opener}\n${expression ? `${expression}\n` : ''}$$`;
};

const WRITERS: Readonly<Record<string, Writer>> = {
  paragraph,
  heading,
  bullet_list: list,
  ordered_list: list,
  blockquote: quote,
  pullquote: quote,
  calloutBlock: callout,
  horizontal_rule: () => '---',
  button,
  captionedImage: image,
  highlighted_code_block: codeBlock,
  latex_block: latex,
};

// --- verbatim fallback and comparison --------------------------------------------

function fence(node: unknown): string {
  let body: string;
  try {
    body = pyJsonDumps(node, 2);
  } catch {
    body = 'null'; // e.g. absurdly deep input
  }
  return `${FENCE}\n${body}\n\`\`\``;
}

/** Equality that also requires equal types (`true` is not `1`); NaN is unequal. */
function identical(a: unknown, b: unknown): boolean {
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((v, i) => identical(v, b[i]));
  }
  if (isDict(a)) {
    if (!isDict(b)) return false;
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every((key) => Object.hasOwn(b, key) && identical(a[key], b[key]));
  }
  if (Array.isArray(b) || isDict(b)) return false;
  return a === b;
}

// --- Python dict / list semantics ------------------------------------------------

function isDict(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A dict, or the AttributeError / TypeError Python raises using it as one. */
function asDict(value: unknown): Dict {
  if (!isDict(value)) throw new TypeError('not a dict');
  return value;
}

/** `d.get(key)` (only own keys count). */
function pyGet(d: Dict, key: string): unknown {
  return Object.hasOwn(d, key) ? d[key] : null;
}

/** `d[key]`: a KeyError / TypeError unless `d` is a dict holding `key`. */
function getItem(d: unknown, key: string): unknown {
  if (!isDict(d) || !Object.hasOwn(d, key)) throw new TypeError(`no item ${key}`);
  return d[key];
}

/** `d.pop(key)`: a KeyError when `key` is missing. */
function pop(d: Dict, key: string): unknown {
  const value = getItem(d, key);
  delete d[key];
  return value;
}

/** `(item,) = value`: only a one-element list gives a usable item. */
function unpackOne(value: unknown): unknown {
  // A one-character str or one-key dict unpacks to a str, which every caller
  // then indexes with a str key (TypeError): the same as raising here.
  if (!Array.isArray(value) || value.length !== 1) throw new TypeError('cannot unpack');
  return value[0];
}

/**
 * `dict(value)`: a copy of a dict, or the dict of a list of key/value pairs.
 * A non-str key is refused here; upstream accepts it but every caller then
 * fails on it in `format_attr_block`, so the result is the same.
 */
function pyDict(value: unknown): Dict {
  const out: Dict = {};
  if (isDict(value)) {
    for (const [key, v] of Object.entries(value)) setOwn(out, key, v);
    return out;
  }
  if (!Array.isArray(value)) throw new TypeError('not a mapping');
  for (const pair of value) {
    let items: unknown[];
    if (Array.isArray(pair)) items = pair;
    else if (typeof pair === 'string') items = [...pair];
    else if (isDict(pair)) items = Object.keys(pair);
    else throw new TypeError('not a sequence');
    if (items.length !== 2)
      throw new TypeError('dictionary update sequence element has wrong length');
    const [key, v] = items;
    if (typeof key !== 'string') throw new TypeError('unsupported key');
    setOwn(out, key, v);
  }
  return out;
}

/** `value in some_set`: unhashable values (list, dict) raise TypeError. */
function setHas(set: ReadonlySet<string>, value: unknown): boolean {
  if (typeof value === 'object' && value !== null) {
    throw new TypeError(`unhashable type: '${Array.isArray(value) ? 'list' : 'dict'}'`);
  }
  return typeof value === 'string' && set.has(value);
}

/** Python str ordering: by code point, not by UTF-16 unit. */
function codePointCompare(a: string, b: string): number {
  const x = [...a].map((c) => c.codePointAt(0) ?? 0);
  const y = [...b].map((c) => c.codePointAt(0) ?? 0);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return x.length - y.length;
}
