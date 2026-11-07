// Reader for the generated goldens in test/fixtures/golden/ (see
// scripts/golden/generate.py for the layout). Files are read byte for byte:
// CRLF and missing trailing newlines are part of the inputs.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const GOLDEN_DIR = join(import.meta.dirname, '..', 'fixtures', 'golden');

/** Names (file stems) of the goldens of one kind, sorted. */
export function goldenNames(kind: string): string[] {
  const dir = join(GOLDEN_DIR, kind);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((file) => file.replace(/\.(json|md)$/, ''))
    .sort();
}

export function readGolden(kind: string, name: string, ext = 'json'): string {
  return readFileSync(join(GOLDEN_DIR, kind, `${name}.${ext}`), 'utf8');
}

export function goldenInput(name: string): string {
  return readGolden('input', name, 'md');
}
