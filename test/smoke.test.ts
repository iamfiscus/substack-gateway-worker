import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';

describe('scaffold smoke', () => {
  it('worker responds 200 on /', async () => {
    const res = await worker.fetch(new Request('http://x/'));
    expect(res.status).toBe(200);
  });

  it('has at least 29 sample fixture files', () => {
    const root = 'test/fixtures/samples';
    const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((f) =>
      statSync(join(root, f)).isFile(),
    );
    expect(files.length).toBeGreaterThanOrEqual(29);
  });
});
