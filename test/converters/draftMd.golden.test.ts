// Every draft-md golden through draftBodyToMarkdown: the serializer against
// upstream bc2e875 (scripts/golden/generate.py), compared as exact text.
//
// A golden's input is, by name: `fixture-<stem>` the draft fixture body;
// `doc-<name>` the input-doc golden; anything else the Markdown input, through
// markdownToDraftBody first (as upstream does with json.dumps of its doc).
//
// Goldens in knownDiffs.ts are those whose doc (upstream's JSON of it) holds an
// integer past 2^53 or an integral Python float (`1.0`); the test checks the
// list is exactly those, and that every line that differs holds such a number.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setLatexIdGenerator } from '../../src/converters/dialect/fences';
import { setSerializerWarn } from '../../src/converters/dialect/serialize';
import { draftBodyToMarkdown, markdownToDraftBody } from '../../src/converters/draftMarkdown';
import { goldenInput, goldenNames, readGolden } from '../support/golden';
import { KNOWN_DIFFS } from './knownDiffs';

const NAMES = goldenNames('draft-md');
const DRAFT_FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'drafts');
const STRING = /"(?:[^"\\]|\\.)*"/g;
const NUMBER = /-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g;
// A JSON object key a JS object enumerates before the others.
const INTEGER_KEY = /"(?:0|[1-9]\d{0,8})"\s*:/;

function body(name: string): string {
  if (name.startsWith('fixture-')) {
    return readFileSync(join(DRAFT_FIXTURES, `${name.slice('fixture-'.length)}.json`), 'utf8');
  }
  if (name.startsWith('doc-')) return readGolden('input-doc', name.slice('doc-'.length));
  return markdownToDraftBody(goldenInput(name));
}

/** upstream's JSON of the doc: the body, or the draft-doc golden of a Markdown input. */
function upstreamJson(name: string): string {
  if (name.startsWith('fixture-') || name.startsWith('doc-')) return body(name);
  return readGolden('draft-doc', name);
}

/** A number literal JS reads as a different value or kind (big int, integral float). */
function isLossy(n: string): boolean {
  if (/^-?\d+$/.test(n)) return !Number.isSafeInteger(Number(n));
  return Number.isInteger(Number(n));
}

/** Whether the JSON text holds a number literal a JS number cannot reproduce. */
function hasLossyNumber(json: string): boolean {
  return (json.replace(STRING, '""').match(NUMBER) ?? []).some(isLossy);
}

beforeAll(() => {
  setLatexIdGenerator(() => 'GOLDENID00');
  setSerializerWarn(() => {});
});
afterAll(() => {
  setLatexIdGenerator(null);
  setSerializerWarn(null);
});

describe('draft-md goldens', () => {
  it('cover the fixtures, the doc inputs and the Markdown inputs', () => {
    expect(NAMES.length).toBeGreaterThan(650);
    expect(NAMES).toEqual(
      expect.arrayContaining([
        'fixture-web_editor_draft',
        'fixture-gateway_draft',
        'fixture-legacy_gateway_draft',
      ]),
    );
    expect(NAMES.filter((name) => name.startsWith('doc-')).length).toBe(
      goldenNames('input-doc').length,
    );
  });

  it.each(NAMES)('%s', (name) => {
    const json = body(name);
    const golden = readGolden('draft-md', name, 'md');
    const known = Object.hasOwn(KNOWN_DIFFS, `draft-md/${name}`);
    expect(hasLossyNumber(upstreamJson(name))).toBe(known);
    // Integer-like keys would be written in a different order (see knownDiffs.ts).
    expect(INTEGER_KEY.test(json.replace(/\\./g, ''))).toBe(false);
    const markdown = draftBodyToMarkdown(json);
    if (!known) {
      expect(markdown).toBe(golden);
      return;
    }
    const ours = markdown.split('\n');
    const theirs = golden.split('\n');
    expect(ours).toHaveLength(theirs.length);
    const differing = theirs.filter((line, i) => line !== ours[i]);
    expect(differing.length).toBeGreaterThan(0);
    for (const line of differing) expect(hasLossyNumber(line), line).toBe(true);
  });
});
