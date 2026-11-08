// Ports of upstream packages/gateway_drafts/tests/{test_drafts_build_body,
// test_drafts_conflict, test_drafts_scheduling, test_images_endpoint,
// test_mcp_upload_image, test_mcp_descriptions}.py (bc2e875), plus the worker's
// own checks (byline from user-settings, list paging, serializer warnings).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ownerFeatures } from '../../src/auth/features';
import { loadConfig } from '../../src/config';
import { type GatewayContext, NullValueCache } from '../../src/context';
import { DraftMarkdownError } from '../../src/converters/dialect/errors';
import { markdownToDraftBody } from '../../src/converters/draftMarkdown';
import { encodeOffset } from '../../src/drafts/cursor';
import { createLogger } from '../../src/log';
import { draftResponse, providedUpdates, UpdateDraftRequest } from '../../src/schemas/drafts';
import {
  aiDetection,
  buildDraftBody,
  createDraft,
  DraftConflictError,
  getDraft,
  listDrafts,
  prepublishDraft,
  scheduleDraft,
  toTriggerAt,
  unscheduleDraft,
  updateDraft,
} from '../../src/services/drafts';
import {
  dataUri,
  decodeImageBase64,
  IMAGE_TOO_LARGE,
  MAX_IMAGE_BYTES,
} from '../../src/services/images';
import { createWorld, encodeCredentials, send, type World } from '../bdd/steps/common';
import { callTool, mcpRequest } from '../bdd/steps/mcp';
import { createFakeSubstack } from '../support/fakeSubstack';

const PUB = 'example.substack.com/api/v1';
const CURRENT = '2026-03-01T09:53:35.569Z';
const STALE = '2026-01-01T00:00:00.000Z';
const creds = {
  publication_url: 'https://example.substack.com',
  substack_sid: 's',
  connect_sid: 'c',
};

function ctxWith(routes: Record<string, unknown>, sink?: (line: string) => void) {
  const env = { SUBSTACK_BASE_URL: 'https://substack.com' };
  const fake = createFakeSubstack(routes);
  const ctx: GatewayContext = {
    env,
    config: loadConfig(env),
    fetcher: fake,
    valueCache: new NullValueCache(),
    statsCache: null,
    resolver: null,
    requestId: 'r',
    authInfo: null,
    ownerFeatures: ownerFeatures({}),
    log: createLogger('debug', sink ?? (() => {})),
  };
  return { ctx, fake };
}

const paths = (calls: Request[], method?: string) =>
  calls
    .filter((r) => method === undefined || r.method === method)
    .map((r) => `${r.method} ${new URL(r.url).pathname}${new URL(r.url).search}`);

/** Drop the random latex_block ids so two independently built docs compare equal. */
function stripLatexIds(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(stripLatexIds);
  if (obj === null || typeof obj !== 'object') return obj;
  const o = obj as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) out[k] = stripLatexIds(v);
  if (o.type === 'latex_block' && out.attrs && typeof out.attrs === 'object') {
    const { id: _id, ...rest } = out.attrs as Record<string, unknown>;
    out.attrs = rest;
  }
  return out;
}

describe('test_drafts_build_body', () => {
  it('buildBodyMatchesTheSyncConverter', async () => {
    const { ctx, fake } = ctxWith({});
    const built = await buildDraftBody(ctx, creds, '# Title\n\n$$E = mc^2$$');
    const expected = markdownToDraftBody('# Title\n\n$$E = mc^2$$');
    expect(stripLatexIds(JSON.parse(built))).toEqual(stripLatexIds(JSON.parse(expected)));
    expect(fake.calls).toHaveLength(0);
  });
});

describe('test_drafts_conflict', () => {
  const routes = () => ({
    [`GET ${PUB}/drafts/1`]: { draft_title: 'old', draft_updated_at: CURRENT },
    [`PUT ${PUB}/drafts/1`]: async (req: Request) => ({
      ...((await req.json()) as object),
      draft_updated_at: '2026-03-02T00:00:00.000Z',
    }),
  });

  it('staleExpectedUpdatedAtRaisesAndSkipsPut', async () => {
    const { ctx, fake } = ctxWith(routes());
    const err = await updateDraft(ctx, creds, {
      draftId: 1,
      updates: { title: 'x' },
      expectedUpdatedAt: STALE,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DraftConflictError);
    expect(paths(fake.calls)).toEqual(['GET /api/v1/drafts/1']);
    expect((err as Error).message).toBe(
      `Draft 1 changed since it was read (now ${CURRENT}); fetch it again before updating.`,
    );
    expect((err as DraftConflictError).draftId).toBe(1);
    expect((err as DraftConflictError).current).toBe(CURRENT);
  });

  it('matchingExpectedUpdatedAtPuts', async () => {
    const { ctx, fake } = ctxWith(routes());
    const draft = await updateDraft(ctx, creds, {
      draftId: 1,
      updates: { title: 'x' },
      expectedUpdatedAt: CURRENT,
    });
    const puts = fake.calls.filter((r) => r.method === 'PUT');
    expect(paths(puts)).toEqual(['PUT /api/v1/drafts/1']);
    expect(await puts[0]?.json()).toEqual({ draft_title: 'x' });
    expect(draft.draft_title).toBe('x');
    expect(draft.draft_updated_at).toBe('2026-03-02T00:00:00.000Z');
  });

  it('noExpectedUpdatedAtSkipsTheGet', async () => {
    const { ctx, fake } = ctxWith(routes());
    await updateDraft(ctx, creds, { draftId: 1, updates: { title: 'x' } });
    expect(paths(fake.calls, 'GET')).toEqual([]);
    expect(paths(fake.calls, 'PUT')).toHaveLength(1);
  });

  it('malformedBodyRaisesMarkdownErrorBeforePut', async () => {
    const { ctx, fake } = ctxWith(routes());
    const err = await updateDraft(ctx, creds, {
      draftId: 1,
      updates: { body: '```substack-node\n{oops\n```' },
      expectedUpdatedAt: CURRENT,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DraftMarkdownError);
    expect((err as DraftMarkdownError).line).toBe(1);
    expect(paths(fake.calls, 'PUT')).toEqual([]);
  });

  it('providedUpdatesExcludesExpectedUpdatedAt', () => {
    const req = UpdateDraftRequest.parse({ title: 't', expected_updated_at: STALE });
    expect(req.expected_updated_at).toBe(STALE);
    expect(providedUpdates(req)).toEqual({ title: 't' });
    expect(JSON.parse(JSON.stringify(req)).expected_updated_at).toBe(STALE);
  });

  it('draftResponseExposesUpdatedAt', () => {
    expect(draftResponse({ draft_updated_at: 'u' }, () => {}).updated_at).toBe('u');
  });

  it('sends explicit nulls, field order title/subtitle/body, body built as JSON', async () => {
    const { ctx, fake } = ctxWith(routes());
    await updateDraft(ctx, creds, {
      draftId: 1,
      updates: providedUpdates(
        UpdateDraftRequest.parse({ body: 'Hello', subtitle: null, title: 'T' }),
      ),
    });
    const put = fake.calls.find((r) => r.method === 'PUT') as Request;
    const sent = (await put.json()) as Record<string, unknown>;
    expect(Object.keys(sent)).toEqual(['draft_title', 'draft_subtitle', 'draft_body']);
    expect(sent).toEqual({
      draft_title: 'T',
      draft_subtitle: null,
      draft_body: markdownToDraftBody('Hello'),
    });
  });
});

describe('test_drafts_scheduling', () => {
  it('aiDetectionParsesPangramFields', async () => {
    const { ctx, fake } = ctxWith({
      [`GET ${PUB}/drafts/208563951/pangram_detection`]: {
        type: 'success',
        header: 'Fully AI-assisted text',
        details: 'Analysis by Pangram ...',
        fraction_ai: 1,
        fraction_ai_assisted: 0,
        fraction_human: 0,
        can_disable: true,
        can_modify_disclosure: true,
        disclosure: { pub: { x: 1 } },
      },
    });
    const result = await aiDetection(ctx, creds, { draftId: 208563951 });
    expect(paths(fake.calls)).toEqual(['GET /api/v1/drafts/208563951/pangram_detection']);
    expect(result.fraction_ai).toBe(1);
    expect(result.header).toBe('Fully AI-assisted text');
    expect(result.can_disable).toBe(true);
  });

  it('prepublishDraftParsesErrorsAndSuggestions', async () => {
    const { ctx, fake } = ctxWith({
      [`GET ${PUB}/drafts/208563951/prepublish`]: { errors: [], suggestions: ['add a subtitle'] },
    });
    const result = await prepublishDraft(ctx, creds, { draftId: 208563951 });
    expect(paths(fake.calls)).toEqual(['GET /api/v1/drafts/208563951/prepublish']);
    expect(result.errors).toEqual([]);
    expect(result.suggestions).toEqual(['add a subtitle']);
  });

  it('scheduleDraftPostsScheduledReleasePayload', async () => {
    const { ctx, fake } = ctxWith({ [`POST ${PUB}/drafts/208563951/scheduled_release`]: {} });
    const when = new Date(Date.UTC(2026, 8, 16, 18, 24));
    const release = await scheduleDraft(ctx, creds, { draftId: 208563951, scheduledAt: when });
    expect(paths(fake.calls)).toEqual(['POST /api/v1/drafts/208563951/scheduled_release']);
    expect(await fake.calls[0]?.json()).toEqual({
      trigger_at: '2026-09-16T18:24:00.000Z',
      post_audience: 'only_paid',
      email_audience: 'only_paid',
    });
    expect(release.trigger_at).toBe('2026-09-16T18:24:00.000Z');
  });

  it('scheduleDraftAcceptsIsoStringAndCustomAudience', async () => {
    const { ctx, fake } = ctxWith({ [`POST ${PUB}/drafts/1/scheduled_release`]: {} });
    await scheduleDraft(ctx, creds, {
      draftId: 1,
      scheduledAt: '2026-09-16T18:24:00Z',
      postAudience: 'everyone',
      emailAudience: 'everyone',
    });
    expect(await fake.calls[0]?.json()).toEqual({
      trigger_at: '2026-09-16T18:24:00.000Z',
      post_audience: 'everyone',
      email_audience: 'everyone',
    });
  });

  it('unscheduleDraftDeletesScheduledRelease', async () => {
    const { ctx, fake } = ctxWith({
      [`DELETE ${PUB}/drafts/208563951/scheduled_release`]: () => new Response(null),
    });
    await unscheduleDraft(ctx, creds, { draftId: 208563951 });
    expect(paths(fake.calls)).toEqual(['DELETE /api/v1/drafts/208563951/scheduled_release']);
  });
});

describe('toTriggerAt', () => {
  it.each([
    ['2026-09-16T18:24:00Z', '2026-09-16T18:24:00.000Z'],
    ['2026-09-16T18:24:00', '2026-09-16T18:24:00.000Z'], // naive is UTC
    ['2026-09-16T18:24:59.987654Z', '2026-09-16T18:24:59.000Z'], // fraction dropped
    ['2026-09-16T20:24:00+02:00', '2026-09-16T18:24:00.000Z'],
    ['2026-09-16T00:30:00-01:00', '2026-09-16T01:30:00.000Z'],
    ['2026-09-16 18:24', '2026-09-16T18:24:00.000Z'],
    ['2026-09-16', '2026-09-16T00:00:00.000Z'],
    ['20260916T182400Z', '2026-09-16T18:24:00.000Z'],
    ['2026-12-31T23:30:00-01:00', '2027-01-01T00:30:00.000Z'],
  ])('%s -> %s', (input, expected) => {
    expect(toTriggerAt(input)).toBe(expected);
  });

  it('keeps years 1-99 as written (Date.UTC would map them to 19xx)', () => {
    expect(toTriggerAt('0026-09-16T00:00:00')).toBe('0026-09-16T00:00:00.000Z');
    expect(toTriggerAt('0004-02-29')).toBe('0004-02-29T00:00:00.000Z');
    expect(() => toTriggerAt('0026-02-29')).toThrow(/^Invalid isoformat string: /);
  });

  it("rejects year 0 with Python's message", () => {
    expect(() => toTriggerAt('0000-01-01')).toThrow(/^year 0 is out of range$/);
    expect(() => toTriggerAt('0000-01-01T00:00:00Z')).toThrow('year 0 is out of range');
  });

  it('formats a Date in UTC', () => {
    expect(toTriggerAt(new Date('2026-09-16T18:24:00.500Z'))).toBe('2026-09-16T18:24:00.000Z');
  });

  it.each(['bogus', '2026-13-01T00:00:00', '2026-02-30', '2026-09-16T25:00', ''])(
    'rejects %j',
    (input) => {
      expect(() => toTriggerAt(input)).toThrow(/^Invalid isoformat string: /);
    },
  );
});

describe('createDraft', () => {
  it('takes the byline from user-settings and sends the full upstream payload', async () => {
    const { ctx, fake } = ctxWith({
      'GET substack.com/api/v1/user-settings': {
        userSettings: [{ user_id: 254824415, type: 'last_home_tab' }],
      },
      [`POST ${PUB}/drafts`]: { id: 7, uuid: 'u-7' },
    });
    const created = await createDraft(ctx, creds, { title: 'T', body: 'Hello' });
    expect(created).toEqual({ id: 7, uuid: 'u-7' });
    expect(fake.calls.map((r) => `${r.method} ${r.url}`)).toEqual([
      'GET https://substack.com/api/v1/user-settings',
      'POST https://example.substack.com/api/v1/drafts',
    ]);
    const sent = (await fake.calls[1]?.json()) as Record<string, unknown>;
    expect(Object.keys(sent)).toEqual([
      'draft_title',
      'draft_subtitle',
      'draft_podcast_url',
      'draft_podcast_duration',
      'draft_body',
      'section_chosen',
      'draft_section_id',
      'draft_bylines',
      'audience',
      'type',
    ]);
    expect(sent).toEqual({
      draft_title: 'T',
      draft_subtitle: '',
      draft_podcast_url: null,
      draft_podcast_duration: null,
      draft_body: markdownToDraftBody('Hello'),
      section_chosen: false,
      draft_section_id: null,
      draft_bylines: [{ id: 254824415, is_guest: false }],
      audience: 'only_paid',
      type: 'newsletter',
    });
  });

  it('an empty body is sent as "" without parsing', async () => {
    const { ctx, fake } = ctxWith({
      'GET substack.com/api/v1/user-settings': { userSettings: [{ user_id: 1 }] },
      [`POST ${PUB}/drafts`]: { id: 7, uuid: 'u-7' },
    });
    await createDraft(ctx, creds, { body: '' });
    const sent = (await fake.calls[1]?.json()) as Record<string, unknown>;
    expect(sent.draft_title).toBe('');
    expect(sent.draft_body).toBe('');
  });

  it('a user-settings failure sends no draft', async () => {
    const { ctx, fake } = ctxWith({
      'GET substack.com/api/v1/user-settings': { userSettings: [] },
    });
    await expect(createDraft(ctx, creds, { title: 'T' })).rejects.toThrow(
      'Substack returned no user settings',
    );
    expect(paths(fake.calls, 'POST')).toEqual([]);
  });
});

describe('listDrafts', () => {
  const page = (n: number, total?: number) => ({
    posts: Array.from({ length: n }, (_, i) => ({ id: i + 1, uuid: `u${i}` })),
    ...(total === undefined ? {} : { total }),
  });

  it('asks for 10 drafts newest first at the cursor offset', async () => {
    const { ctx, fake } = ctxWith({ [`GET ${PUB}/post_management/drafts`]: page(10, 25) });
    const { drafts, nextCursor } = await listDrafts(ctx, creds, { cursor: encodeOffset(10) });
    expect(paths(fake.calls)).toEqual([
      'GET /api/v1/post_management/drafts?offset=10&limit=10&order_by=draft_updated_at&order_direction=desc',
    ]);
    expect(drafts).toHaveLength(10);
    expect(nextCursor).toBe(encodeOffset(20));
  });

  it('stops at the total, on a short page, and accepts a bare list', async () => {
    const at = async (body: unknown) => {
      const { ctx } = ctxWith({ [`GET ${PUB}/post_management/drafts`]: body });
      return (await listDrafts(ctx, creds, {})).nextCursor;
    };
    expect(await at(page(10, 10))).toBeNull();
    expect(await at(page(9))).toBeNull();
    expect(await at(page(10))).toBe(encodeOffset(10));
    expect(await at(page(10).posts)).toBe(encodeOffset(10));
  });

  it('REST answers 400 for an invalid cursor', async () => {
    const w = restWorld();
    await send(w, 'GET', '/api/v1/drafts?next=bm9wZQ');
    expect(w.response?.status).toBe(400);
    expect(JSON.parse(w.bodyText)).toEqual({ detail: 'Invalid cursor' });
    expect(w.fake?.calls).toHaveLength(0);
  });
});

describe('serializer warnings', () => {
  // A non-string node type makes the serializer fall back with a warning.
  const odd = JSON.stringify({ type: 'doc', content: [{ type: 1 }] });
  afterEach(() => vi.restoreAllMocks());

  it('go to the context logger, never the console', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const lines: string[] = [];
    const { ctx } = ctxWith(
      { [`GET ${PUB}/drafts/5`]: { draft_body: odd, draft_updated_at: 'u' } },
      (l) => lines.push(l),
    );
    const draft = await getDraft(ctx, creds, { draftId: 5 });
    const response = draftResponse(draft, ctx.log.warn);
    expect(response.body).toContain('```substack-node');
    expect(warn).not.toHaveBeenCalled();
    expect(lines.map((l) => JSON.parse(l))).toContainEqual({
      level: 'warn',
      msg: 'draft serializer failed (DraftMarkdownError); writing every block as a substack-node fence',
    });
  });

  it('REST GET logs the warning with the request id', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const w = restWorld();
    w.env = { ...w.env, LOG_LEVEL: 'warn' };
    w.routes[`GET ${PUB}/drafts/5`] = { draft_body: odd, draft_updated_at: 'u' };
    w.headers['x-request-id'] = 'req-42';
    await send(w, 'GET', '/api/v1/drafts/5');
    expect(w.response?.status).toBe(200);
    expect(warn).not.toHaveBeenCalled();
    const lines = log.mock.calls.map((c) => JSON.parse(String(c[0])));
    expect(lines).toContainEqual(expect.objectContaining({ level: 'warn', request_id: 'req-42' }));
  });
});

function restWorld(): World {
  const w = createWorld();
  w.publicationUrl = creds.publication_url;
  w.headers = { 'x-gateway-token': encodeCredentials(creds) };
  return w;
}

const IMAGE_RESPONSE = {
  id: 1,
  url: 'https://substack-post-media.s3.amazonaws.com/x.png',
  contentType: 'image/png',
  bytes: 3,
  imageWidth: 10,
  imageHeight: 20,
};

describe('test_images_endpoint', () => {
  it('dataUriBuildsABase64DataUri', () => {
    expect(dataUri('image/png', new TextEncoder().encode('ABC'))).toBe(
      'data:image/png;base64,QUJD',
    );
  });

  async function upload(w: World, form: FormData): Promise<void> {
    const { createApp } = await import('../../src/app');
    w.fake = createFakeSubstack(w.routes);
    const app = createApp({ fetcher: w.fake });
    w.response = await app.request(
      '/api/v1/images',
      { method: 'POST', headers: w.headers, body: form },
      w.env,
    );
    w.bodyText = await w.response.text();
  }

  it('endpointUploadsFileAsDataUri', async () => {
    const w = restWorld();
    w.routes[`POST ${PUB}/image`] = IMAGE_RESPONSE;
    const form = new FormData();
    form.append(
      'file',
      new File([new TextEncoder().encode('ABC')], 'cat.png', { type: 'image/png' }),
    );
    await upload(w, form);
    expect(w.response?.status, w.bodyText).toBe(201);
    expect(await w.fake?.calls[0]?.json()).toEqual({ image: 'data:image/png;base64,QUJD' });
    expect(JSON.parse(w.bodyText)).toEqual({
      id: 1,
      url: 'https://substack-post-media.s3.amazonaws.com/x.png',
      width: 10,
      height: 20,
      bytes: 3,
      content_type: 'image/png',
    });
  });

  it('a file without a content type is sent as application/octet-stream', async () => {
    const w = restWorld();
    w.routes[`POST ${PUB}/image`] = IMAGE_RESPONSE;
    const form = new FormData();
    form.append('file', new File([new TextEncoder().encode('ABC')], 'blob'));
    await upload(w, form);
    expect(w.response?.status, w.bodyText).toBe(201);
    expect(await w.fake?.calls[0]?.json()).toEqual({
      image: 'data:application/octet-stream;base64,QUJD',
    });
  });

  it('a file over 10 MB is a 413 and nothing is uploaded', async () => {
    const w = restWorld();
    w.routes[`POST ${PUB}/image`] = IMAGE_RESPONSE;
    const form = new FormData();
    form.append('file', new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.png'));
    await upload(w, form);
    expect(w.response?.status).toBe(413);
    expect(JSON.parse(w.bodyText ?? '')).toEqual({ detail: 'Image too large (max 10 MB)' });
    expect(w.fake?.calls).toHaveLength(0);
  });

  it('a file of exactly 10 MB is accepted', async () => {
    const w = restWorld();
    w.routes[`POST ${PUB}/image`] = IMAGE_RESPONSE;
    const form = new FormData();
    form.append('file', new File([new Uint8Array(10 * 1024 * 1024)], 'max.png'));
    await upload(w, form);
    expect(w.response?.status, w.bodyText).toBe(201);
  });

  it('an over-large Content-Length is a 413 before the body is read', async () => {
    const { createApp } = await import('../../src/app');
    const w = restWorld();
    const fake = createFakeSubstack(w.routes);
    const app = createApp({ fetcher: fake });
    let pulled = false;
    const body = new ReadableStream(
      {
        pull(controller) {
          pulled = true;
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    const res = await app.request(
      '/api/v1/images',
      {
        method: 'POST',
        headers: {
          ...w.headers,
          'content-type': 'multipart/form-data; boundary=x',
          'content-length': String(50 * 1024 * 1024),
        },
        body,
        duplex: 'half',
      } as RequestInit,
      w.env,
    );
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ detail: 'Image too large (max 10 MB)' });
    expect(pulled).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });

  it('a missing file is a 422 and nothing is uploaded', async () => {
    const w = restWorld();
    const form = new FormData();
    form.append('other', 'x');
    await upload(w, form);
    expect(w.response?.status).toBe(422);
    expect(w.fake?.calls).toHaveLength(0);
  });
});

function mcpWorld(): World {
  const w = createWorld();
  w.publicationUrl = creds.publication_url;
  w.mcpToken = encodeCredentials(creds);
  return w;
}

describe('test_mcp_upload_image', () => {
  it('uploadImageToolUploadsAndReturnsResult', async () => {
    const w = mcpWorld();
    w.routes[`POST ${PUB}/image`] = IMAGE_RESPONSE;
    const out = await callTool(w, 'upload_image', { image_base64: btoa('ABC') });
    expect(out.isError, out.text ?? '').toBe(false);
    expect(w.fake?.calls.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      'POST /api/v1/image',
    ]);
    expect(await w.fake?.calls[0]?.json()).toEqual({ image: 'data:image/png;base64,QUJD' });
    expect(out.result?.url).toBe('https://substack-post-media.s3.amazonaws.com/x.png');
    expect(out.result?.width).toBe(10);
    expect(out.result?.content_type).toBe('image/png');
  });
});

describe('upload_image size cap', () => {
  it('decodeImageBase64 rejects decoded bytes over 10 MB', () => {
    // "AAAA" decodes to 3 zero bytes.
    const over = 'AAAA'.repeat(Math.floor(MAX_IMAGE_BYTES / 3) + 1);
    expect(() => decodeImageBase64(over)).toThrow(IMAGE_TOO_LARGE);
    const atCap = 'AAAA'.repeat(Math.floor(MAX_IMAGE_BYTES / 3));
    expect(decodeImageBase64(atCap).length).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
    expect(decodeImageBase64('QUJD\n')).toEqual(new TextEncoder().encode('ABC'));
  });

  it('an oversized upload_image call is refused before reaching Substack', async () => {
    // The MCP transport caps a request body at 4 MB, below the 10 MB image cap.
    const w = mcpWorld();
    w.routes[`POST ${PUB}/image`] = IMAGE_RESPONSE;
    const b64 = 'AAAA'.repeat(Math.floor(MAX_IMAGE_BYTES / 3) + 1);
    const { res } = await mcpRequest(w, 'tools/call', {
      name: 'upload_image',
      arguments: { image_base64: b64, token: w.mcpToken },
    });
    expect(res.status).toBe(413);
    expect(w.fake?.calls ?? []).toHaveLength(0);
  });
});

describe('test_mcp_descriptions', () => {
  const TOKEN_SENTENCE = 'The `token` argument is optional';
  const DOC =
    'https://github.com/jakub-k-slys/substack-gateway-oss/blob/main/docs/drafts-markdown.md';

  async function description(name: string): Promise<string> {
    const { payload } = await mcpRequest(mcpWorld(), 'tools/list', {});
    const tools = (payload.result as { tools: { name: string; description?: string }[] }).tools;
    const tool = tools.find((t) => t.name === name);
    expect(tool, name).toBeDefined();
    return tool?.description ?? '';
  }

  it('updateDraftDescriptionMentionsDialectAndConflicts', async () => {
    const d = await description('update_draft');
    expect(d).toContain('::button');
    expect(d).toContain('substack-node');
    expect(d).toContain('expected_updated_at');
  });

  it.each(['get_draft', 'create_draft', 'update_draft'])(
    'draftBodyToolsKeepTokenSentenceAndPointToDocs (%s)',
    async (name) => {
      const d = await description(name);
      expect(d).toContain(TOKEN_SENTENCE);
      expect(d).toContain(DOC);
      expect(d).toContain('::defaults{align=left|center|right|justify|default}');
      expect(d).toContain(':::align');
      expect(d).toContain(':::callout');
      expect(d).toContain('{size=normal|large|full}');
      expect(d).toContain('{watermark=N%}');
    },
  );

  it.each(['get_draft', 'update_draft'])(
    'readAndUpdateDescriptionsExplainUpdatedAtRoundTrip (%s)',
    async (name) => {
      const d = await description(name);
      expect(d).toContain('updated_at');
      expect(d).toContain('expected_updated_at');
    },
  );
});

describe('REST routes', () => {
  it('schedule posts the release and answers the normalized trigger time', async () => {
    const w = restWorld();
    w.routes[`POST ${PUB}/drafts/9/scheduled_release`] = {};
    await send(w, 'POST', '/api/v1/drafts/9/schedule', {
      scheduled_at: '2026-09-16T20:24:00+02:00',
      post_audience: '',
      email_audience: 'everyone',
    });
    expect(w.response?.status, w.bodyText).toBe(200);
    expect(JSON.parse(w.bodyText)).toEqual({
      scheduled_at: '2026-09-16T18:24:00.000Z',
      post_audience: 'only_paid',
      email_audience: 'everyone',
    });
    expect(await w.fake?.calls[0]?.json()).toEqual({
      trigger_at: '2026-09-16T18:24:00.000Z',
      post_audience: 'only_paid',
      email_audience: 'everyone',
    });
  });

  it('schedule accepts a unix timestamp and rejects a non-datetime with 422', async () => {
    const w = restWorld();
    w.routes[`POST ${PUB}/drafts/9/scheduled_release`] = {};
    await send(w, 'POST', '/api/v1/drafts/9/schedule', { scheduled_at: 1789583040 });
    expect(JSON.parse(w.bodyText).scheduled_at).toBe('2026-09-16T18:24:00.000Z');
    await send(w, 'POST', '/api/v1/drafts/9/schedule', { scheduled_at: 'next tuesday' });
    expect(w.response?.status).toBe(422);
    expect(JSON.parse(w.bodyText).detail[0].loc).toEqual(['body', 'scheduled_at']);
    expect(w.fake?.calls).toHaveLength(0);
  });

  it('unschedule, ai-detection and prepublish hit their Substack endpoints', async () => {
    const w = restWorld();
    w.routes[`DELETE ${PUB}/drafts/9/scheduled_release`] = () => new Response(null);
    w.routes[`GET ${PUB}/drafts/9/pangram_detection`] = { fraction_ai: 0.5, header: 'h' };
    w.routes[`GET ${PUB}/drafts/9/prepublish`] = { errors: ['e'] };
    await send(w, 'DELETE', '/api/v1/drafts/9/schedule');
    expect(w.response?.status).toBe(204);
    await send(w, 'GET', '/api/v1/drafts/9/ai-detection');
    expect(JSON.parse(w.bodyText)).toEqual({
      type: null,
      header: 'h',
      details: null,
      fraction_ai: 0.5,
      fraction_ai_assisted: null,
      fraction_human: null,
      can_disable: null,
      can_modify_disclosure: null,
    });
    await send(w, 'GET', '/api/v1/drafts/9/prepublish');
    expect(JSON.parse(w.bodyText)).toEqual({ errors: ['e'], suggestions: [] });
  });

  it('a stale expected_updated_at is a 409 naming the current stamp', async () => {
    const w = restWorld();
    w.routes[`GET ${PUB}/drafts/9`] = { draft_updated_at: CURRENT };
    await send(w, 'PUT', '/api/v1/drafts/9', { title: 'x', expected_updated_at: STALE });
    expect(w.response?.status).toBe(409);
    expect(JSON.parse(w.bodyText)).toEqual({
      detail: `Draft 9 changed since it was read (now ${CURRENT}); fetch it again before updating.`,
    });
  });

  it('owner credentials may create but not delete, schedule or unschedule', async () => {
    const w = createWorld({
      env: {
        GATEWAY_API_KEYS: 'ci:abc',
        OWNER_PUBLICATION_URL: 'https://example.substack.com',
        OWNER_SUBSTACK_SID: 's',
        OWNER_CONNECT_SID: 'c',
      },
    });
    w.headers = { authorization: 'Bearer abc' };
    w.routes[`GET ${PUB}/drafts/9`] = { draft_title: 't' };
    await send(w, 'GET', '/api/v1/drafts/9');
    expect(w.response?.status, w.bodyText).toBe(200);
    for (const [method, path, feature] of [
      ['DELETE', '/api/v1/drafts/9', 'api:drafts:delete'],
      ['POST', '/api/v1/drafts/9/schedule', 'api:drafts:schedule'],
      ['DELETE', '/api/v1/drafts/9/schedule', 'api:drafts:unschedule'],
    ] as const) {
      const body = method === 'POST' ? { scheduled_at: '2026-09-16T18:24:00Z' } : undefined;
      await send(w, method, path, body);
      expect(w.response?.status, path).toBe(403);
      expect(JSON.parse(w.bodyText).detail).toBe(
        `feature ${feature} disabled for owner credentials`,
      );
    }
    const mcp = await callTool(w, 'delete_draft', { draft_id: 9 }, { withToken: false });
    expect(mcp.isError).toBe(true);
    expect(mcp.text).toContain('feature mcp:drafts:delete disabled for owner credentials');
  });
});

describe('MCP draft tools', () => {
  it('schedule_draft, unschedule_draft, check_draft and get_ai_detection', async () => {
    const w = mcpWorld();
    w.routes[`POST ${PUB}/drafts/9/scheduled_release`] = {};
    w.routes[`DELETE ${PUB}/drafts/9/scheduled_release`] = () => new Response(null);
    w.routes[`GET ${PUB}/drafts/9/prepublish`] = { errors: [], suggestions: ['s'] };
    w.routes[`GET ${PUB}/drafts/9/pangram_detection`] = { fraction_human: 1 };
    const scheduled = await callTool(w, 'schedule_draft', {
      draft_id: 9,
      scheduled_at: '2026-09-16T18:24:00Z',
    });
    expect(scheduled.result).toEqual({
      scheduled_at: '2026-09-16T18:24:00.000Z',
      post_audience: 'only_paid',
      email_audience: 'only_paid',
    });
    const bad = await callTool(w, 'schedule_draft', { draft_id: 9, scheduled_at: 'soon' });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("Invalid isoformat string: 'soon'");
    expect((await callTool(w, 'unschedule_draft', { draft_id: 9 })).text).toBe(
      'Draft 9 unscheduled successfully.',
    );
    expect((await callTool(w, 'check_draft', { draft_id: 9 })).result).toEqual({
      errors: [],
      suggestions: ['s'],
    });
    expect((await callTool(w, 'get_ai_detection', { draft_id: 9 })).result?.fraction_human).toBe(1);
  });

  it('list_drafts pages with an opaque cursor and rejects a bad one', async () => {
    const w = mcpWorld();
    w.routes[`GET ${PUB}/post_management/drafts`] = {
      posts: Array.from({ length: 10 }, (_, i) => ({ id: i, uuid: `u${i}` })),
      total: 30,
    };
    const first = await callTool(w, 'list_drafts', {});
    expect(first.result?.next).toBe(encodeOffset(10));
    await callTool(w, 'list_drafts', { next: first.result?.next });
    expect(new URL(w.fake?.calls[0]?.url ?? '').searchParams.get('offset')).toBe('10');
    const bad = await callTool(w, 'list_drafts', { next: 'bm9wZQ' });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain('invalid cursor');
  });

  it('update_draft drops null arguments instead of sending them', async () => {
    const w = mcpWorld();
    w.routes[`PUT ${PUB}/drafts/9`] = { draft_title: 'T' };
    await callTool(w, 'update_draft', { draft_id: 9, title: 'T', subtitle: null });
    expect(await w.fake?.calls[0]?.json()).toEqual({ draft_title: 'T' });
  });
});
