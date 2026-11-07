// Port of upstream packages/gateway_oss/features/steps/markdown_converter.py (bc2e875).

import { expect } from 'vitest';
import { markdownToNotePayload, type NotePayload } from '../../../src/converters/noteMarkdown';
import { type StepRegistry, step } from '../runner';

type TextNode = { type: 'text'; text: string; marks?: { type: string }[] };

export type ConverterWorld = { payload: NotePayload | null; error: Error | null };

export const createConverterWorld = (): ConverterWorld => ({ payload: null, error: null });

function convert(w: ConverterWorld, markdown: string): void {
  w.error = null;
  w.payload = null;
  try {
    w.payload = markdownToNotePayload(markdown);
  } catch (err) {
    w.error = err as Error;
  }
}

/** Python `textwrap.dedent(s).strip()`: drop the common leading indent, trim. */
function dedentStrip(s: string): string {
  const lines = s.split('\n');
  const indents = lines
    .filter((line) => line.trim() !== '')
    .map((line) => /^[ \t]*/.exec(line)?.[0].length ?? 0);
  const common = indents.length ? Math.min(...indents) : 0;
  return lines
    .map((line) => (line.trim() === '' ? '' : line.slice(common)))
    .join('\n')
    .trim();
}

function payload(w: ConverterWorld): NotePayload {
  expect(w.payload, `conversion failed: ${w.error?.message}`).not.toBeNull();
  return w.payload as NotePayload;
}

function paragraphs(w: ConverterWorld): { content: TextNode[] }[] {
  return payload(w).bodyJson.content as { content: TextNode[] }[];
}

function nodesOf(w: ConverterWorld, para: string): TextNode[] {
  const all = paragraphs(w);
  const index = Number(para);
  expect(all.length, `Expected at least ${index} paragraph(s)`).toBeGreaterThanOrEqual(index);
  return (all[index - 1] as { content: TextNode[] }).content;
}

function nodeAt(w: ConverterWorld, para: string, node: string): TextNode {
  const nodes = nodesOf(w, para);
  const index = Number(node);
  expect(nodes.length, `Paragraph ${para}: expected ${index} node(s)`).toBeGreaterThanOrEqual(
    index,
  );
  return nodes[index - 1] as TextNode;
}

function onlyNode(w: ConverterWorld, para: string, count: string, text: string): TextNode {
  const nodes = nodesOf(w, para);
  expect(nodes).toHaveLength(Number(count));
  const first = nodes[0] as TextNode;
  expect(first.text).toBe(text);
  return first;
}

export const markdownConverterSteps: StepRegistry<ConverterWorld> = [
  step('I convert the markdown "{markdown}"', (w, [markdown]) => convert(w, markdown ?? '')),
  step('I convert the markdown:', (w, _args, { docString }) =>
    convert(w, dedentStrip(docString ?? '')),
  ),
  step('I convert the markdown with an empty list item', (w) =>
    convert(w, '- First item\n- \n- Third item'),
  ),
  step('I convert the markdown with literal backslash-n escapes', (w) =>
    convert(w, String.raw`First line\nSecond line\n\nThird paragraph`),
  ),
  step('I convert the whitespace-only markdown', (w) => convert(w, '   \n\t  ')),
  step('I convert the empty markdown', (w) => convert(w, '')),

  // Payload envelope
  step('the note payload tabId is "{value}"', (w, [value]) => {
    expect(payload(w).tabId).toBe(value);
  }),
  step('the note payload surface is "{value}"', (w, [value]) => {
    expect(payload(w).surface).toBe(value);
  }),
  step('the note payload replyMinimumRole is "{value}"', (w, [value]) => {
    expect(payload(w).replyMinimumRole).toBe(value);
  }),
  step('the note payload bodyJson type is "{value}"', (w, [value]) => {
    expect(payload(w).bodyJson.type).toBe(value);
  }),
  step('the note payload bodyJson schemaVersion is "{value}"', (w, [value]) => {
    expect(payload(w).bodyJson.attrs.schemaVersion).toBe(value);
  }),

  // Paragraphs and text nodes
  step('the note payload has {count:d} paragraph', (w, [count]) => {
    expect(paragraphs(w)).toHaveLength(Number(count));
  }),
  step('the note payload has {count:d} paragraphs', (w, [count]) => {
    expect(paragraphs(w)).toHaveLength(Number(count));
  }),
  step('paragraph {para:d} has {count:d} text node with text "{text}"', (w, [p, c, text]) => {
    const node = onlyNode(w, p ?? '', c ?? '', text ?? '');
    expect(node.marks).toBeUndefined();
  }),
  step('paragraph {para:d} has {count:d} text node with bold text "{text}"', (w, [p, c, text]) => {
    const node = onlyNode(w, p ?? '', c ?? '', text ?? '');
    expect(node.marks ?? []).toEqual([{ type: 'bold' }]);
  }),
  step('paragraph {para:d} has 1 text node with bold and italic text "{text}"', (w, [p, text]) => {
    const node = onlyNode(w, p ?? '', '1', text ?? '');
    expect(new Set((node.marks ?? []).map((m) => m.type))).toEqual(new Set(['bold', 'italic']));
  }),
  step('paragraph {para:d} text node {node:d} is plain "{text}"', (w, [p, n, text]) => {
    const node = nodeAt(w, p ?? '', n ?? '');
    expect(node.text).toBe(text);
    expect(node.marks).toBeUndefined();
  }),
  step('paragraph {para:d} text node {node:d} is bold "{text}"', (w, [p, n, text]) => {
    const node = nodeAt(w, p ?? '', n ?? '');
    expect(node.text).toBe(text);
    expect(node.marks).toEqual([{ type: 'bold' }]);
  }),
  step('paragraph {para:d} text node {node:d} is italic "{text}"', (w, [p, n, text]) => {
    const node = nodeAt(w, p ?? '', n ?? '');
    expect(node.text).toBe(text);
    expect(node.marks).toEqual([{ type: 'italic' }]);
  }),
  step('paragraph {para:d} has 1 text node containing a newline', (w, [p]) => {
    const nodes = nodesOf(w, p ?? '');
    expect(nodes).toHaveLength(1);
    expect((nodes[0] as TextNode).text).toContain('\n');
  }),
  step('paragraph {para:d} text node {node:d} is code "{text}"', (w, [p, n, text]) => {
    const node = nodeAt(w, p ?? '', n ?? '');
    expect(node.text).toBe(text);
    expect(node.marks).toEqual([{ type: 'code' }]);
  }),

  // Errors
  step('a ValueError is raised with message "{message}"', (w, [message]) => {
    expect(w.error, 'Expected a ValueError but none was raised').not.toBeNull();
    expect(w.error?.message).toBe(message);
  }),
];
