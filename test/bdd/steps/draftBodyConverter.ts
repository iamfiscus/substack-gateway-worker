// Port of upstream packages/gateway_oss/features/steps/draft_body_converter.py (bc2e875).

import { expect } from 'vitest';
import { draftBodyToMarkdown, markdownToDraftBody } from '../../../src/converters/draftMarkdown';
import { type StepRegistry, step } from '../runner';
import { dedentStrip } from './markdownConverter';

type DraftNode = {
  type: string;
  attrs?: Record<string, unknown> | null;
  content?: DraftNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> | null }[];
};

export type DraftConverterWorld = {
  draftBodyStr: string | null;
  draftDoc: DraftNode | null;
  currentListNode: DraftNode | null;
  currentCodeBlock: DraftNode | null;
  currentQuoteNode: DraftNode | null;
  reverseResult: string | null;
};

export const createDraftConverterWorld = (): DraftConverterWorld => ({
  draftBodyStr: null,
  draftDoc: null,
  currentListNode: null,
  currentCodeBlock: null,
  currentQuoteNode: null,
  reverseResult: null,
});

function convert(w: DraftConverterWorld, markdown: string): void {
  const body = markdownToDraftBody(markdown);
  w.draftBodyStr = body;
  w.draftDoc = JSON.parse(body) as DraftNode;
  w.currentListNode = null;
  w.currentCodeBlock = null;
  w.currentQuoteNode = null;
}

function nodes(w: DraftConverterWorld): DraftNode[] {
  return w.draftDoc?.content ?? [];
}

function node(w: DraftConverterWorld, idx: string | undefined): DraftNode {
  const all = nodes(w);
  const index = Number(idx);
  expect(
    all.length,
    `Expected at least ${index} node(s), got ${all.length}`,
  ).toBeGreaterThanOrEqual(index);
  return all[index - 1] as DraftNode;
}

function paraNode(w: DraftConverterWorld, para: string | undefined, nodeIdx: string | undefined) {
  const p = node(w, para);
  expect(p.type, `Node ${para} is not a paragraph: ${p.type}`).toBe('paragraph');
  const content = p.content ?? [];
  const index = Number(nodeIdx);
  expect(
    content.length,
    `Paragraph ${para}: expected at least ${index} text node(s)`,
  ).toBeGreaterThanOrEqual(index);
  return content[index - 1] as DraftNode;
}

function textOf(n: DraftNode): string {
  return (n.content ?? []).map((child) => child.text ?? '').join('');
}

function isA(w: DraftConverterWorld, idx: string | undefined, type: string): DraftNode {
  const n = node(w, idx);
  expect(n.type, `Expected ${type}, got ${n.type}`).toBe(type);
  return n;
}

function quoteInner(current: DraftNode | null, idx: string | undefined, text: string | undefined) {
  expect(current, 'No current quote node').not.toBeNull();
  const inner = current?.content ?? [];
  const index = Number(idx);
  expect(inner.length).toBeGreaterThanOrEqual(index);
  const para = inner[index - 1] as DraftNode;
  expect(para.type).toBe('paragraph');
  expect(textOf(para)).toBe(text);
}

function codeBlock(w: DraftConverterWorld, idx: string | undefined): DraftNode {
  const n = isA(w, idx, 'highlighted_code_block');
  w.currentCodeBlock = n;
  return n;
}

export const draftBodyConverterSteps: StepRegistry<DraftConverterWorld> = [
  step('I convert draft markdown "{markdown}"', (w, [markdown]) => convert(w, markdown ?? '')),
  step('I convert draft markdown:', (w, _args, { docString }) =>
    convert(w, dedentStrip(docString ?? '')),
  ),

  // Doc-level assertions
  step('the draft body is a JSON string', (w) => {
    expect(typeof w.draftBodyStr).toBe('string');
    JSON.parse(w.draftBodyStr as string);
  }),
  step('the draft doc type is "{docType}"', (w, [docType]) => {
    expect(w.draftDoc?.type).toBe(docType);
  }),
  step('the draft doc has no schema version attribute', (w) => {
    expect(w.draftDoc?.attrs ?? {}).not.toHaveProperty('schemaVersion');
  }),
  step('the draft doc has {count:d} node', (w, [count]) => {
    expect(nodes(w)).toHaveLength(Number(count));
  }),
  step('the draft doc has {count:d} nodes', (w, [count]) => {
    expect(nodes(w)).toHaveLength(Number(count));
  }),

  // Node type assertions
  step('draft node {idx:d} is a paragraph', (w, [idx]) => {
    isA(w, idx, 'paragraph');
  }),
  step(
    'draft node {idx:d} is a paragraph with {count:d} text node "{text}"',
    (w, [idx, c, text]) => {
      const n = isA(w, idx, 'paragraph');
      const content = n.content ?? [];
      expect(content).toHaveLength(Number(c));
      expect(content[0]?.text).toBe(text);
    },
  ),
  step(
    'draft node {idx:d} is a heading with level {level:d} and text "{text}"',
    (w, [idx, level, text]) => {
      const n = isA(w, idx, 'heading');
      expect(n.attrs?.level).toBe(Number(level));
      expect((n.content ?? []).map((child) => child.text).join('')).toBe(text);
    },
  ),
  step(
    'draft node {idx:d} is a highlighted_code_block with language "{lang}"',
    (w, [idx, lang]) => {
      expect(codeBlock(w, idx).attrs?.language).toBe(lang);
    },
  ),
  step('draft node {idx:d} is a highlighted_code_block with null language', (w, [idx]) => {
    expect(codeBlock(w, idx).attrs?.language ?? null).toBeNull();
  }),
  step('draft code block text contains "{text}"', (w, [text]) => {
    expect(w.currentCodeBlock, 'No current code block').not.toBeNull();
    expect(textOf(w.currentCodeBlock as DraftNode)).toContain(text);
  }),
  step('draft node {idx:d} is a blockquote with {count:d} inner node', (w, [idx, c]) => {
    w.currentQuoteNode = isA(w, idx, 'blockquote');
    expect(w.currentQuoteNode.content ?? []).toHaveLength(Number(c));
  }),
  step('draft node {idx:d} is a blockquote with {count:d} inner nodes', (w, [idx, c]) => {
    w.currentQuoteNode = isA(w, idx, 'blockquote');
    expect(w.currentQuoteNode.content ?? []).toHaveLength(Number(c));
  }),
  step('draft blockquote inner node {idx:d} is a paragraph with text "{text}"', (w, [idx, text]) =>
    quoteInner(w.currentQuoteNode, idx, text),
  ),
  step('draft node {idx:d} is a pullquote with {count:d} inner node', (w, [idx, c]) => {
    w.currentQuoteNode = isA(w, idx, 'pullquote');
    expect(w.currentQuoteNode.content ?? []).toHaveLength(Number(c));
  }),
  step('draft node {idx:d} is a pullquote with {count:d} inner nodes', (w, [idx, c]) => {
    w.currentQuoteNode = isA(w, idx, 'pullquote');
    expect(w.currentQuoteNode.content ?? []).toHaveLength(Number(c));
  }),
  step('draft pullquote inner node {idx:d} is a paragraph with text "{text}"', (w, [idx, text]) =>
    quoteInner(w.currentQuoteNode, idx, text),
  ),
  step(
    'draft paragraph {para:d} text node {node:d} is a link with text "{text}" and href "{href}"',
    (w, [para, n, text, href]) => {
      const t = paraNode(w, para, n);
      expect(t.text).toBe(text);
      const link = (t.marks ?? []).find((m) => m.type === 'link');
      expect(link, 'Expected link mark').toBeDefined();
      expect(link?.attrs?.href ?? '').toBe(href);
    },
  ),
  step('draft node {idx:d} is a bullet_list with {count:d} items', (w, [idx, c]) => {
    w.currentListNode = isA(w, idx, 'bullet_list');
    expect(w.currentListNode.content).toHaveLength(Number(c));
  }),
  step('draft node {idx:d} is an ordered_list with {count:d} items', (w, [idx, c]) => {
    w.currentListNode = isA(w, idx, 'ordered_list');
    expect(w.currentListNode.content).toHaveLength(Number(c));
  }),

  // List assertions
  step('draft ordered_list start attr is {start:d}', (w, [start]) => {
    expect(w.currentListNode, 'No current list node').not.toBeNull();
    expect(w.currentListNode?.attrs?.start).toBe(Number(start));
  }),
  step('draft list item {idx:d} text is "{text}"', (w, [idx, text]) => {
    expect(w.currentListNode, 'No current list node').not.toBeNull();
    const item = w.currentListNode?.content?.[Number(idx) - 1] as DraftNode;
    expect(item.type).toBe('list_item');
    const para = item.content?.[0] as DraftNode;
    expect(para.type).toBe('paragraph');
    expect((para.content ?? []).map((child) => child.text).join('')).toBe(text);
  }),

  // Inline text node assertions
  step('draft paragraph {para:d} text node {node:d} is plain "{text}"', (w, [para, n, text]) => {
    const t = paraNode(w, para, n);
    expect(t.text).toBe(text);
    expect(t).not.toHaveProperty('marks');
  }),
  step(
    'draft paragraph {para:d} text node {node:d} has mark "{mark}" and text "{text}"',
    (w, [para, n, mark, text]) => {
      const t = paraNode(w, para, n);
      expect(t.text).toBe(text);
      expect((t.marks ?? []).map((m) => m.type)).toContain(mark);
    },
  ),
  step(
    'draft paragraph {para:d} text node {node:d} has marks "{marks}" and text "{text}"',
    (w, [para, n, marks, text]) => {
      const t = paraNode(w, para, n);
      expect(t.text).toBe(text);
      expect(new Set((t.marks ?? []).map((m) => m.type))).toEqual(new Set(marks?.split(',')));
    },
  ),

  // Reverse converter steps (draftBodyToMarkdown output always ends with one newline)
  step('the draft body round-trips to markdown "{expected}"', (w, [expected]) => {
    expect(draftBodyToMarkdown(w.draftBodyStr as string)).toBe(`${expected}\n`);
  }),
  step('the draft body round-trips to markdown:', (w, _args, { docString }) => {
    const expected = `${dedentStrip(docString ?? '')}\n`;
    expect(draftBodyToMarkdown(w.draftBodyStr as string)).toBe(expected);
  }),
  step('I reverse-convert the draft body JSON:', (w, _args, { docString }) => {
    w.reverseResult = draftBodyToMarkdown(dedentStrip(docString ?? ''));
  }),
  step('the markdown result is "{expected}"', (w, [expected]) => {
    expect(w.reverseResult).toBe(`${expected}\n`);
  }),
  step('the markdown result is:', (w, _args, { docString }) => {
    expect(w.reverseResult).toBe(`${dedentStrip(docString ?? '')}\n`);
  }),
  step('draft node {idx:d} has attrs {attrsJson}', (w, [idx, attrsJson]) => {
    expect(node(w, idx).attrs).toEqual(JSON.parse(attrsJson ?? ''));
  }),
];
