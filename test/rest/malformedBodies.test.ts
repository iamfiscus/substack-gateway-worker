// Upstream (FastAPI) answers 422 for an empty, malformed or non-JSON request body.
// Observed against upstream bc2e875 on 2026-11-08; before this fix the Worker answered 500.
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { encodeCredentials, TEST_ENV } from '../bdd/steps/common';
import { createFakeSubstack } from '../support/fakeSubstack';

const TOKEN = encodeCredentials({
  publication_url: 'https://example.substack.com',
  substack_sid: 's',
  connect_sid: 'c',
});

async function send(
  method: string,
  path: string,
  body: string,
  contentType?: string,
  length?: number | null,
) {
  const fake = createFakeSubstack({});
  const app = createApp({ fetcher: fake });
  const headers: Record<string, string> = { 'x-gateway-token': TOKEN };
  if (contentType) headers['content-type'] = contentType;
  if (length !== null) headers['content-length'] = String(length ?? Buffer.byteLength(body));
  const res = await app.request(path, { method, headers, body }, TEST_ENV);
  return { status: res.status, json: (await res.json()) as { detail: unknown }, calls: fake.calls };
}

const ROUTES: [string, string][] = [
  ['POST', '/api/v1/notes'],
  ['POST', '/api/v1/drafts'],
  ['PUT', '/api/v1/drafts/1'],
];

describe.each(ROUTES)('%s %s with a bad body', (method, path) => {
  it('empty JSON body -> 422 missing body', async () => {
    const r = await send(method, path, '', 'application/json');
    expect(r.status).toBe(422);
    expect(r.json.detail).toEqual([
      { type: 'missing', loc: ['body'], msg: 'Field required', input: null },
    ]);
    expect(r.calls).toHaveLength(0);
  });

  it('malformed JSON -> 422 json_invalid with the error position', async () => {
    const r = await send(method, path, '{', 'application/json');
    expect(r.status).toBe(422);
    expect(r.json.detail).toEqual([
      {
        type: 'json_invalid',
        loc: ['body', 1],
        msg: 'JSON decode error',
        input: {},
        ctx: { error: expect.any(String) },
      },
    ]);
    expect(r.calls).toHaveLength(0);
  });

  it('non-JSON content type -> 422 model_attributes_type echoing the input', async () => {
    const r = await send(method, path, 'x', 'application/x-www-form-urlencoded');
    expect(r.status).toBe(422);
    expect(r.json.detail).toEqual([
      {
        type: 'model_attributes_type',
        loc: ['body'],
        msg: 'Input should be a valid dictionary or object to extract fields from',
        input: 'x',
      },
    ]);
    expect(r.calls).toHaveLength(0);
  });
});

describe('body reads stay bounded', () => {
  it('a non-multipart upload to /images still meets the size guard first (411/413)', async () => {
    const big = 'x'.repeat(2048);
    const noLength = await send('POST', '/api/v1/images', big, 'application/json', null);
    expect(noLength.status).toBe(411);
    const tooBig = await send('POST', '/api/v1/images', big, 'text/plain', 50 * 1024 * 1024);
    expect(tooBig.status).toBe(413);
  });

  it('a JSON-typed upload to /images meets the size guard before any body read', async () => {
    const r = await send('POST', '/api/v1/images', '{', 'application/json', 50 * 1024 * 1024);
    expect(r.status).toBe(413);
  });

  it('a non-JSON body over 64 KiB is a 422 without echoing the input', async () => {
    const r = await send('POST', '/api/v1/notes', 'y'.repeat(70 * 1024), 'text/plain');
    expect(r.status).toBe(422);
    expect(r.json.detail).toEqual([
      {
        type: 'model_attributes_type',
        loc: ['body'],
        msg: 'Input should be a valid dictionary or object to extract fields from',
      },
    ]);
  });
});
