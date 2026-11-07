// Every draft-doc and draft-error golden through markdownToDraftDoc: the full
// draft dialect parser against upstream bc2e875 (scripts/golden/generate.py).
//
// Docs are compared as canonical JSON after parsing both sides; the golden side
// is read with pyJsonLoads, which takes Python's NaN / Infinity spellings. A JS
// number cannot tell 1.0 from 1, so Python float spellings compare equal to
// ints. Goldens listed in knownDiffs.ts hold integers past 2^53: there both
// sides lose the same precision, and the test checks the golden really needs
// its entry. Errors must match exactly: type, line, message and str(exc).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DraftMarkdownError } from '../../src/converters/dialect/errors';
import { setLatexIdGenerator } from '../../src/converters/dialect/fences';
import { pyJsonLoads } from '../../src/converters/dialect/pyJson';
import { markdownToDraftDoc } from '../../src/converters/draftMarkdown';
import { canonicalJson } from '../support/canon';
import { goldenInput, goldenNames, readGolden } from '../support/golden';
import { KNOWN_DIFFS } from './knownDiffs';

const DOCS = goldenNames('draft-doc');
const ERRORS = goldenNames('draft-error');
const STRING = /"(?:[^"\\]|\\.)*"/g;
const NUMBER = /-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g;

/** Whether the JSON text holds an integer literal a JS number cannot hold exactly. */
function hasBigInt(json: string): boolean {
  const numbers = json.replace(STRING, '""').match(NUMBER) ?? [];
  return numbers.some((n) => /^-?\d+$/.test(n) && !Number.isSafeInteger(Number(n)));
}

beforeAll(() => setLatexIdGenerator(() => 'GOLDENID00'));
afterAll(() => setLatexIdGenerator(null));

describe('draft-doc goldens', () => {
  it('cover the crlf and no-trailing-newline inputs', () => {
    expect(DOCS.length).toBeGreaterThan(400);
    expect(DOCS).toEqual(expect.arrayContaining(['crlf', 'crlf-lone-cr', 'no-trailing-newline']));
  });

  it.each(DOCS)('%s', (name) => {
    const golden = readGolden('draft-doc', name);
    const doc = markdownToDraftDoc(goldenInput(name));
    expect(canonicalJson(doc)).toBe(canonicalJson(pyJsonLoads(golden)));
    expect(hasBigInt(golden)).toBe(Object.hasOwn(KNOWN_DIFFS, `draft-doc/${name}`));
  });
});

describe('draft-error goldens', () => {
  it.each(ERRORS)('%s', (name) => {
    const golden = JSON.parse(readGolden('draft-error', name)) as Record<string, unknown>;
    let err: unknown;
    try {
      markdownToDraftDoc(goldenInput(name));
    } catch (caught) {
      err = caught;
    }
    expect(err).toBeInstanceOf(DraftMarkdownError);
    const e = err as DraftMarkdownError;
    expect({ error: e.name, line: e.line ?? null, message: e.reason, str: e.message }).toEqual(
      golden,
    );
  });
});

describe('known diffs', () => {
  it('name only existing goldens', () => {
    for (const key of Object.keys(KNOWN_DIFFS)) {
      const [kind = '', name = ''] = key.split('/');
      expect(goldenNames(kind)).toContain(name);
    }
  });
});
