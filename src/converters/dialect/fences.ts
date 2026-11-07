// Port of upstream packages/gateway_drafts/src/gateway_drafts/converters/dialect/fences.py
// (bc2e875): fenced blocks of the draft dialect (code, Datawrapper, verbatim
// nodes, LaTeX).
//
// A fence opens on a line of its own and closes on a line holding only its
// closing delimiter. Body lines are kept exactly as written (no whitespace
// stripping), so code and LaTeX survive unchanged.
//
// - ```lang {attrs} ... ```        -> `highlighted_code_block`.
// - ```datawrapper + URL           -> `_unresolved_datawrapper` placeholder.
// - ```substack-node + JSON        -> that node, verbatim.
// - $$ {attrs} ... $$ (or $$expr$$ on one line) -> `latex_block`.
//
// Python regex semantics kept: `\s` is Python's whitespace, `.` matches
// everything but `\n` (U+2028 included), and `$` also matches before a final
// `\n`. Known JS limit: the internal-type check walks object values in JS
// order, so integer-like keys come first (it only changes which of several
// internal types is named).

import { type Attrs, fillDefaults, loadsBoundedJson, parseAttrBlock } from './attrs';
import { DraftMarkdownError, PyValueError } from './errors';
import type { Node } from './inline';
import { JSONDecodeError } from './pyJson';
import { pyRepr } from './pyRepr';
import { PY_SPACE, pyStrip } from './pyStr';

const CODE_OPEN = new RegExp(`^\`\`\`([^${PY_SPACE}\`{]*)[ \\t]*(?:\\{([^\\n]*)\\})?(?=\\n?$)`);
const LATEX_OPEN = /^\$\$[ \t]*(?:\{([^\n]*)\})?(?=\n?$)/;
const LATEX_ONE_LINE = /^\$\$([^\n]+?)\$\$(?=\n?$)/;
/** The only whitespace the dialect strips around syntax. */
export const HSPACE = ' \t';
const VERBATIM = 'substack-node';
const DATAWRAPPER = 'datawrapper';
const DATAWRAPPER_ID = /datawrapper\.de\/_\/([A-Za-z0-9]+)|dwcdn\.net\/([A-Za-z0-9]+)/;
const SPACE_RUN = new RegExp(`[${PY_SPACE}]+`);

export type FenceKind = 'code' | 'datawrapper' | 'substack-node' | 'latex';

/**
 * The resolve URL (`https://www.datawrapper.de/_/<id>/`) for a chart URL.
 *
 * Throws DraftMarkdownError (at `line`, when known) for anything that is not a
 * single published Datawrapper chart URL.
 */
export function normalizeDatawrapperUrl(url: string, line?: number | null): string {
  // Python `len(url.split()) == 1`: not empty, not several URLs.
  const singleUrl = url.split(SPACE_RUN).filter(Boolean).length === 1;
  const match = singleUrl ? DATAWRAPPER_ID.exec(url) : null;
  if (match === null) {
    throw new DraftMarkdownError(
      `not a Datawrapper chart URL: ${pyRepr(url)}; a \`\`\`datawrapper fence holds ` +
        'one published chart URL, https://www.datawrapper.de/_/<id>/ or ' +
        'https://datawrapper.dwcdn.net/<id>/',
      line,
    );
  }
  const chartId = match[1] || match[2];
  return `https://www.datawrapper.de/_/${chartId}/`;
}

/** Parse an attribute block body, reporting errors at `line`. */
export function attrsAt(text: string | null | undefined, line: number): Attrs {
  if (text == null) return {};
  try {
    return parseAttrBlock(text);
  } catch (err) {
    if (err instanceof DraftMarkdownError) throw new DraftMarkdownError(err.reason, line);
    throw err;
  }
}

export class Fence {
  readonly body: string[] = [];

  constructor(
    readonly kind: FenceKind,
    readonly line: number,
    readonly attrs: Attrs,
  ) {}

  closesOn(raw: string): boolean {
    return pyStrip(raw, HSPACE) === (this.kind === 'latex' ? '$$' : '```');
  }

  build(): Node {
    const text = this.body.join('\n');
    if (this.kind === 'latex') return latexBlock(text, this.attrs);
    if (this.kind === DATAWRAPPER) {
      const url = pyStrip(text);
      // Validate here, where the fence's line is known.
      normalizeDatawrapperUrl(url, this.line);
      return { type: '_unresolved_datawrapper', attrs: { url } };
    }
    if (this.kind === VERBATIM) return verbatim(text, this.line);
    const node: Node = {
      type: 'highlighted_code_block',
      attrs: fillDefaults('highlighted_code_block', this.attrs),
    };
    if (text) node.content = [{ type: 'text', text }]; // ProseMirror forbids empty text nodes
    return node;
  }

  unclosed(): DraftMarkdownError {
    const delimiter = this.kind === 'latex' ? '$$' : '```';
    return new DraftMarkdownError(
      `unclosed ${this.kind} fence: close it with a line holding only ${delimiter}`,
      this.line,
    );
  }
}

/** The fence a line opens, or null when it opens none. */
export function openFence(stripped: string, line: number): Fence | null {
  const code = CODE_OPEN.exec(stripped);
  if (code) {
    const lang = code[1] as string;
    const attrText = code[2];
    const attrs = attrsAt(attrText, line);
    if (lang === VERBATIM || lang === DATAWRAPPER) {
      if (attrText !== undefined) {
        throw new DraftMarkdownError(`\`\`\`${lang} fences take no attributes`, line);
      }
      return new Fence(lang, line, {});
    }
    return new Fence('code', line, { language: lang || null, ...attrs });
  }
  if (stripped.startsWith('```')) {
    throw new DraftMarkdownError(
      'malformed fence opener: write ```lang or ```lang {key=value} with ' +
        'nothing else on the line (start it with \\``` for literal text)',
      line,
    );
  }
  const latex = LATEX_OPEN.exec(stripped);
  if (latex) return new Fence('latex', line, attrsAt(latex[1], line));
  return null;
}

/** `$$expr$$` on a single line, or null. */
export function oneLineLatex(stripped: string): Node | null {
  const match = LATEX_ONE_LINE.exec(stripped);
  return match ? latexBlock(pyStrip(match[1] as string, HSPACE), {}) : null;
}

function randomLatexId(): string {
  let id = '';
  for (let i = 0; i < 10; i++) id += String.fromCharCode(65 + Math.floor(Math.random() * 26));
  return id;
}

let latexIdGenerator: () => string = randomLatexId;

/** A 10-character uppercase id, matching Substack's editor-generated ids. */
export function latexId(): string {
  return latexIdGenerator();
}

/** Test hook: replace the id generator (null restores the random one). */
export function setLatexIdGenerator(fn: (() => string) | null): void {
  latexIdGenerator = fn ?? randomLatexId;
}

export function latexBlock(expression: string, attrs: Attrs): Node {
  const full: Attrs = { persistentExpression: expression, ...attrs };
  if (!Object.hasOwn(full, 'id')) full.id = latexId();
  return { type: 'latex_block', attrs: full };
}

function isDict(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function verbatim(text: string, line: number): Node {
  let node: unknown;
  try {
    node = loadsBoundedJson(text);
  } catch (err) {
    if (err instanceof JSONDecodeError) {
      throw new DraftMarkdownError(
        `substack-node fence holds invalid JSON (${err.msg} at fence body ` +
          `line ${err.lineno}, column ${err.colno}); do not edit its JSON`,
        line,
      );
    }
    if (err instanceof PyValueError) {
      // e.g. too deep or huge numbers
      throw new DraftMarkdownError(`substack-node fence JSON cannot be read: ${err.message}`, line);
    }
    throw err;
  }
  if (!isDict(node) || typeof node.type !== 'string') {
    throw new DraftMarkdownError(
      'substack-node fence must hold one JSON object with a "type"',
      line,
    );
  }
  const internal = internalType(node);
  if (internal !== null) {
    throw new DraftMarkdownError(
      `substack-node fence holds the internal node type ${pyRepr(internal)}; ` +
        'node types starting with "_" are not allowed',
      line,
    );
  }
  return node as Node;
}

/** The first node `type` starting with `_` anywhere in `node`, if any. */
function internalType(node: unknown): string | null {
  const stack = [node]; // iterative: the JSON may be nested close to the depth limit
  while (stack.length > 0) {
    const item = stack.pop();
    // A loop, not push(...values): a huge array would overflow the argument limit.
    if (Array.isArray(item)) {
      for (const value of item) stack.push(value);
    } else if (isDict(item)) {
      const kind = item.type;
      if (typeof kind === 'string' && kind.startsWith('_')) return kind;
      for (const value of Object.values(item)) stack.push(value);
    }
  }
  return null;
}
