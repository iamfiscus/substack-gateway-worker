// Byte-identical check against upstream gateway_core markdown_to_note_payload
// (bc2e875): every golden in test/fixtures/golden/note/ and note-error/.

import { describe, expect, it } from 'vitest';
import {
  markdownToDoc,
  markdownToNotePayload,
  NoteMarkdownError,
} from '../../src/converters/noteMarkdown';
import { canonicalJson } from '../support/canon';
import { goldenInput, goldenNames, readGolden } from '../support/golden';

function thrownMessage(fn: () => unknown): string | null {
  try {
    fn();
  } catch (err) {
    return (err as Error).message;
  }
  return null;
}

describe('markdownToNotePayload goldens', () => {
  const ok = goldenNames('note');
  const failing = goldenNames('note-error');

  it('covers the whole corpus', () => {
    // generate.py skips the note converter for inputs over NOTE_MAX_CHARS.
    const NOTE_MAX_CHARS = 20_000;
    const covered = new Set([...ok, ...failing]);
    const missing = goldenNames('input').filter(
      (name) => !covered.has(name) && [...goldenInput(name)].length <= NOTE_MAX_CHARS,
    );
    expect(missing).toEqual([]);
    expect(covered.size).toBeGreaterThan(550);
  });

  it.each(ok)('%s', (name) => {
    expect(canonicalJson(markdownToNotePayload(goldenInput(name)))).toBe(readGolden('note', name));
  });

  it.each(failing)('%s raises', (name) => {
    const { message } = JSON.parse(readGolden('note-error', name)) as { message: string };
    expect(thrownMessage(() => markdownToNotePayload(goldenInput(name)))).toBe(message);
  });
});

describe('markdownToNotePayload', () => {
  it('adds attachmentIds only when there are some', () => {
    expect(markdownToNotePayload('Hi', ['a1', 'a2']).attachmentIds).toEqual(['a1', 'a2']);
    expect('attachmentIds' in markdownToNotePayload('Hi', [])).toBe(false);
    expect('attachmentIds' in markdownToNotePayload('Hi')).toBe(false);
  });

  it('builds the doc on its own', () => {
    expect(markdownToDoc('Hello')).toEqual({
      type: 'doc',
      attrs: { schemaVersion: 'v1' },
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
    });
  });

  it('raises ValueError-equivalent errors with upstream messages', () => {
    expect(thrownMessage(() => markdownToDoc(''))).toBe(
      'Note body cannot be empty - at least one paragraph with content is required',
    );
    expect(thrownMessage(() => markdownToDoc('- '))).toBe(
      'Note must contain at least one paragraph with actual content',
    );
    expect(() => markdownToDoc('')).toThrow(NoteMarkdownError);
  });
});
