// Ports of upstream packages/gateway_drafts/tests/test_draft_round_trip.py,
// test_draft_compat.py and test_draft_doc_split.py (bc2e875), test names in
// camelCase.
//
// web_editor_draft.json is a synthetic doc in the shape Substack's web editor
// sends; gateway_draft.json is what markdownToDraftDoc produces for a dialect
// sample with no placeholders. Both must survive doc -> Markdown -> doc
// unchanged, and their Markdown must be a fixed point of Markdown -> doc ->
// Markdown. legacy_gateway_draft.json is what an older gateway stored
// (paragraphs and headings without textAlign); it reads back without fences and
// with only that default filled in.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pyJsonDumps, pyJsonLoads } from '../../src/converters/dialect/pyJson';
import { setSerializerWarn } from '../../src/converters/dialect/serialize';
import {
  draftBodyToMarkdown,
  markdownToDraftBody,
  markdownToDraftDoc,
} from '../../src/converters/draftMarkdown';
import { draftResponse, providedUpdates, UpdateDraftRequest } from '../../src/schemas/drafts';
import { canonicalJson } from '../support/canon';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'drafts');
const NAMES = ['web_editor_draft.json', 'gateway_draft.json'];

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

beforeAll(() => setSerializerWarn(() => {}));
afterAll(() => setSerializerWarn(null));

describe('test_draft_round_trip', () => {
  it.each(NAMES)('docRoundTripIsLossless %s', (name) => {
    const doc = pyJsonLoads(fixture(name));
    const back = markdownToDraftDoc(draftBodyToMarkdown(pyJsonDumps(doc)));
    expect(canonicalJson(back)).toBe(canonicalJson(doc));
  });

  it.each(NAMES)('markdownIsIdempotent %s', (name) => {
    const md1 = draftBodyToMarkdown(fixture(name));
    const md2 = draftBodyToMarkdown(markdownToDraftBody(md1));
    expect(md2).toBe(md1);
  });

  it.each(NAMES)('docIsStableAfterASecondRoundTrip %s', (name) => {
    // md -> doc -> md -> doc: the second doc equals the first.
    const doc1 = markdownToDraftDoc(draftBodyToMarkdown(fixture(name)));
    const doc2 = markdownToDraftDoc(draftBodyToMarkdown(pyJsonDumps(doc1)));
    expect(canonicalJson(doc2)).toBe(canonicalJson(doc1));
  });

  // How many top-level blocks each fixture writes as ```substack-node fences.
  // Pinned so a serializer change that silently degrades readable blocks to
  // fences (still lossless, but no longer editable) fails here.
  const FENCE_COUNTS: Record<string, number> = {
    'web_editor_draft.json': 4,
    'gateway_draft.json': 1,
  };

  it.each(NAMES)('fenceCountIsPinned %s', (name) => {
    const markdown = draftBodyToMarkdown(fixture(name));
    expect(markdown.split('```substack-node\n').length - 1).toBe(FENCE_COUNTS[name]);
  });

  /** Fill the default textAlign on legacy paragraphs and headings. */
  function withTextAlign(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(withTextAlign);
    if (typeof node !== 'object' || node === null) return node;
    const out: Record<string, unknown> = Object.fromEntries(
      Object.entries(node).map(([key, value]) => [key, withTextAlign(value)]),
    );
    if (out.type === 'paragraph' || out.type === 'heading') {
      out.attrs = { textAlign: null, ...((out.attrs as Record<string, unknown> | null) ?? {}) };
    }
    return out;
  }

  it('legacyDraftReadsBackWithoutFences', () => {
    const body = fixture('legacy_gateway_draft.json');
    const markdown = draftBodyToMarkdown(body);
    expect(markdown).not.toContain('substack-node');
    expect(canonicalJson(markdownToDraftDoc(markdown))).toBe(
      canonicalJson(withTextAlign(pyJsonLoads(body))),
    );
    expect(draftBodyToMarkdown(markdownToDraftBody(markdown))).toBe(markdown);
  });
});

describe('test_draft_compat', () => {
  it('updateRequestReportsOnlyProvidedFields', () => {
    expect(providedUpdates(UpdateDraftRequest.parse({ body: '**bold**' }))).toEqual({
      body: '**bold**',
    });
    expect(providedUpdates(UpdateDraftRequest.parse({ title: 'T', body: 'x' }))).toEqual({
      title: 'T',
      body: 'x',
    });
  });

  it('sharedDraftResponseRoundTripsThroughMarkdownConverter', () => {
    const draft = {
      draft_title: 'Title',
      draft_subtitle: 'Subtitle',
      draft_body: markdownToDraftBody('> quoted'),
    };
    const response = draftResponse(draft, () => {});
    expect(response.title).toBe('Title');
    expect(response.subtitle).toBe('Subtitle');
    expect(response.body).toBe(draftBodyToMarkdown(draft.draft_body));
    expect(response.body).toBe('> quoted\n');
  });
});

describe('test_draft_doc_split', () => {
  it('docIsADictWithDocType', () => {
    const doc = markdownToDraftDoc('Hello');
    expect(typeof doc).toBe('object');
    expect(doc.type).toBe('doc');
    expect(doc.content?.[0]?.type).toBe('paragraph');
  });

  it('bodyIsJsonDumpOfDoc', () => {
    const markdown = '# Title\n\nPlain text';
    expect(markdownToDraftBody(markdown)).toBe(pyJsonDumps(markdownToDraftDoc(markdown)));
  });

  it('literalBackslashNInSingleLineInputIsExpanded', () => {
    // Agents often send JSON-escaped newlines; single-line input has its
    // literal "\n" escapes expanded to line breaks before parsing.
    const doc = markdownToDraftDoc('# Title\\n\\nBody text');
    expect(doc.content?.map((node) => node.type)).toEqual(['heading', 'paragraph']);
  });

  it('literalBackslashNInMultiLineInputIsKept', () => {
    const doc = markdownToDraftDoc('$$\n\\neg x\n$$');
    expect(doc.content?.[0]?.attrs?.persistentExpression).toBe('\\neg x');
  });

  it('oneParagraphWithLiteralBackslashNRoundTripsUnchanged', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { textAlign: null },
          content: [
            { type: 'text', text: 'use ' },
            { type: 'text', text: '\\n', marks: [{ type: 'code' }] },
            { type: 'text', text: ' or a\\nb' },
          ],
        },
      ],
    };
    const markdown = draftBodyToMarkdown(JSON.stringify(doc));
    expect(markdown.endsWith('\n')).toBe(true);
    expect(markdownToDraftDoc(markdown)).toStrictEqual(doc);
  });

  it('draftMarkdownAlwaysEndsWithANewline', () => {
    expect(draftBodyToMarkdown(markdownToDraftBody('Hello'))).toBe('Hello\n');
  });
});

describe('draftBodyToMarkdown', () => {
  it('an empty doc gives an empty string, not a newline', () => {
    expect(draftBodyToMarkdown('{"type": "doc", "content": []}')).toBe('');
  });

  it('reads the body like json.loads (NaN accepted, decoder errors raised)', () => {
    expect(draftBodyToMarkdown('{"content": [{"type": "x", "n": NaN}]}')).toContain('"n": NaN');
    expect(() => draftBodyToMarkdown('{"content": ')).toThrow('Expecting value');
  });
});
