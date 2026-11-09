// The request matrix the parity harness replays against upstream (bc2e875) and
// this Worker. Every REST operation (51) and every MCP tool (49) gets five
// cases: a happy path, a missing token, an invalid token, Substack 404 and
// Substack 500. A few extra cases pin transport behaviour (`/`, tools/list,
// GET/DELETE /mcp, validation errors).

import { IDS, PUBLICATION_URL } from './fakeSubstackServer.ts';

export type Variant = 'happy' | 'missing-token' | 'invalid-token' | 'substack-404' | 'substack-500';

export type MatrixCase = {
  name: string;
  method: string;
  path: string;
  headers?: Record<string, string>;
  /** JSON request body. */
  body?: unknown;
  /** A raw request body sent as-is with its own content type (empty, malformed, non-JSON). */
  rawBody?: { content: string; contentType: string };
  /** Multipart form fields (a `Blob` value becomes a file part). */
  form?: Record<string, { content: string; type: string; filename: string } | string>;
  /** A JSON-RPC `tools/call` (sent as POST `path`, usually /mcp). */
  mcp?: { tool: string; args: Record<string, unknown> };
  /** Raw JSON-RPC method/params, for non-tool MCP calls. */
  rpc?: { method: string; params: Record<string, unknown> };
  /** HTTP status the fake Substack answers every call with (default 200). */
  substackStatus?: number;
  /** The happy path must succeed on both sides, or the case proves nothing. */
  expectSuccess?: boolean;
};

/** base64 of the credential JSON, as a shell `base64` would make it. */
export function encodeToken(creds: Record<string, string>): string {
  return Buffer.from(JSON.stringify(creds), 'utf8').toString('base64');
}

export const TOKEN = encodeToken({
  publication_url: PUBLICATION_URL,
  substack_sid: 'harness-sid',
  connect_sid: 'harness-connect',
});
export const INVALID_TOKEN = 'not-valid-base64!!!';

const { slug, noteId, commentId, postId, draftId } = IDS;

// 1x1 transparent PNG.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const FUTURE = '2099-09-16T18:24:00Z';
const DRAFT_BODY = '# Heading\n\nSome **bold** text and a [link](https://example.com).\n';

type RestOp = {
  op: string;
  method: string;
  path: string;
  body?: unknown;
  form?: MatrixCase['form'];
  /** Public routes take no token: missing/invalid token cases still run. */
  public?: boolean;
};

const REST: RestOp[] = [
  { op: 'GET /api/v1/health/live', method: 'GET', path: '/api/v1/health/live', public: true },
  { op: 'GET /api/v1/health/ready', method: 'GET', path: '/api/v1/health/ready' },
  { op: 'GET /api/v1/me', method: 'GET', path: '/api/v1/me' },
  { op: 'GET /api/v1/me/notes', method: 'GET', path: '/api/v1/me/notes' },
  { op: 'GET /api/v1/me/posts', method: 'GET', path: '/api/v1/me/posts?limit=5' },
  { op: 'GET /api/v1/me/following', method: 'GET', path: '/api/v1/me/following' },
  { op: 'GET /api/v1/notes/{note_id}', method: 'GET', path: `/api/v1/notes/${noteId}` },
  {
    op: 'POST /api/v1/notes',
    method: 'POST',
    path: '/api/v1/notes',
    body: { content: 'Hello **world** from the _harness_ 🎉', attachment: 'https://example.com' },
  },
  { op: 'DELETE /api/v1/notes/{note_id}', method: 'DELETE', path: `/api/v1/notes/${noteId}` },
  { op: 'PUT /api/v1/notes/{note_id}/like', method: 'PUT', path: `/api/v1/notes/${noteId}/like` },
  {
    op: 'DELETE /api/v1/notes/{note_id}/like',
    method: 'DELETE',
    path: `/api/v1/notes/${noteId}/like`,
  },
  {
    op: 'POST /api/v1/notes/{note_id}/comments',
    method: 'POST',
    path: `/api/v1/notes/${noteId}/comments`,
    body: { body: 'A *reply*' },
  },
  {
    op: 'GET /api/v1/notes/{note_id}/comments',
    method: 'GET',
    path: `/api/v1/notes/${noteId}/comments`,
  },
  { op: 'GET /api/v1/posts/{post_id}', method: 'GET', path: `/api/v1/posts/${postId}` },
  { op: 'PUT /api/v1/posts/{post_id}/like', method: 'PUT', path: `/api/v1/posts/${postId}/like` },
  {
    op: 'DELETE /api/v1/posts/{post_id}/like',
    method: 'DELETE',
    path: `/api/v1/posts/${postId}/like`,
  },
  {
    op: 'POST /api/v1/posts/{post_id}/restack',
    method: 'POST',
    path: `/api/v1/posts/${postId}/restack`,
  },
  { op: 'GET /api/v1/profiles/{slug}', method: 'GET', path: `/api/v1/profiles/${slug}` },
  {
    op: 'GET /api/v1/profiles/{slug}/posts',
    method: 'GET',
    path: `/api/v1/profiles/${slug}/posts?limit=3`,
  },
  {
    op: 'GET /api/v1/profiles/{slug}/notes',
    method: 'GET',
    path: `/api/v1/profiles/${slug}/notes`,
  },
  {
    op: 'POST /api/v1/posts/{post_id}/comments',
    method: 'POST',
    path: `/api/v1/posts/${postId}/comments`,
    body: { body: 'Great post' },
  },
  {
    op: 'POST /api/v1/comments/{comment_id}/comments',
    method: 'POST',
    path: `/api/v1/comments/${commentId}/comments`,
    body: { body: 'Agreed' },
  },
  { op: 'GET /api/v1/comments/{comment_id}', method: 'GET', path: `/api/v1/comments/${commentId}` },
  {
    op: 'DELETE /api/v1/comments/{comment_id}',
    method: 'DELETE',
    path: `/api/v1/comments/${commentId}`,
  },
  {
    op: 'GET /api/v1/comments/{comment_id}/comments',
    method: 'GET',
    path: `/api/v1/comments/${commentId}/comments`,
  },
  {
    op: 'POST /api/v1/comments/{comment_id}/reaction',
    method: 'POST',
    path: `/api/v1/comments/${commentId}/reaction`,
  },
  {
    op: 'DELETE /api/v1/comments/{comment_id}/reaction',
    method: 'DELETE',
    path: `/api/v1/comments/${commentId}/reaction`,
  },
  {
    op: 'GET /api/v1/posts/{post_id}/comments',
    method: 'GET',
    path: `/api/v1/posts/${postId}/comments`,
  },
  { op: 'GET /api/v1/drafts', method: 'GET', path: '/api/v1/drafts' },
  { op: 'GET /api/v1/drafts/{draft_id}', method: 'GET', path: `/api/v1/drafts/${draftId}` },
  {
    op: 'PUT /api/v1/drafts/{draft_id}',
    method: 'PUT',
    path: `/api/v1/drafts/${draftId}`,
    body: { title: 'New title', body: DRAFT_BODY },
  },
  { op: 'DELETE /api/v1/drafts/{draft_id}', method: 'DELETE', path: `/api/v1/drafts/${draftId}` },
  {
    op: 'POST /api/v1/drafts',
    method: 'POST',
    path: '/api/v1/drafts',
    body: { title: 'Harness draft', subtitle: 'Sub', body: DRAFT_BODY },
  },
  {
    op: 'GET /api/v1/drafts/{draft_id}/ai-detection',
    method: 'GET',
    path: `/api/v1/drafts/${draftId}/ai-detection`,
  },
  {
    op: 'GET /api/v1/drafts/{draft_id}/prepublish',
    method: 'GET',
    path: `/api/v1/drafts/${draftId}/prepublish`,
  },
  {
    op: 'POST /api/v1/drafts/{draft_id}/schedule',
    method: 'POST',
    path: `/api/v1/drafts/${draftId}/schedule`,
    body: { scheduled_at: FUTURE, post_audience: 'everyone' },
  },
  {
    op: 'DELETE /api/v1/drafts/{draft_id}/schedule',
    method: 'DELETE',
    path: `/api/v1/drafts/${draftId}/schedule`,
  },
  {
    op: 'POST /api/v1/images',
    method: 'POST',
    path: '/api/v1/images',
    form: {
      file: {
        content: Buffer.from(PNG_BASE64, 'base64').toString('latin1'),
        type: 'image/png',
        filename: 'pixel.png',
      },
    },
  },
  { op: 'GET /api/v1/stats/subscribers', method: 'GET', path: '/api/v1/stats/subscribers' },
  { op: 'GET /api/v1/stats/30d-views', method: 'GET', path: '/api/v1/stats/30d-views' },
  {
    op: 'GET /api/v1/stats/arr',
    method: 'GET',
    path: '/api/v1/stats/arr?from=2024-01-01T00:00:00Z',
  },
  { op: 'GET /api/v1/stats/emails', method: 'GET', path: '/api/v1/stats/emails' },
  { op: 'GET /api/v1/stats/dashboard', method: 'GET', path: '/api/v1/stats/dashboard' },
  {
    op: 'GET /api/v1/stats/dashboard/period',
    method: 'GET',
    path: '/api/v1/stats/dashboard/period?range_days=30',
  },
  {
    op: 'GET /api/v1/stats/recommendations/{direction}',
    method: 'GET',
    path: '/api/v1/stats/recommendations/outgoing?limit=5',
  },
  { op: 'GET /api/v1/stats/posts/counts', method: 'GET', path: '/api/v1/stats/posts/counts' },
  ...(['engagement', 'traffic', 'recipients', 'growth', 'discussion'] as const).map((tab) => ({
    op: `GET /api/v1/posts/{post_id}/stats/${tab}`,
    method: 'GET',
    path: `/api/v1/posts/${postId}/stats/${tab}`,
  })),
];

type McpOp = { tool: string; args: Record<string, unknown>; anonymous?: boolean };

const MCP: McpOp[] = [
  { tool: 'get_note', args: { note_id: noteId } },
  {
    tool: 'create_note',
    args: { content: 'Hello **world** 🎉', attachment: 'https://example.com' },
  },
  { tool: 'delete_note', args: { note_id: noteId } },
  { tool: 'like_note', args: { note_id: noteId } },
  { tool: 'unlike_note', args: { note_id: noteId } },
  { tool: 'reply_to_note', args: { note_id: noteId, body: 'A *reply*' } },
  { tool: 'list_note_replies', args: { note_id: noteId } },
  { tool: 'get_post', args: { post_id: postId } },
  { tool: 'like_post', args: { post_id: postId } },
  { tool: 'unlike_post', args: { post_id: postId } },
  { tool: 'restack_post', args: { post_id: postId } },
  { tool: 'get_profile', args: { slug }, anonymous: true },
  { tool: 'get_profile_posts', args: { slug, limit: 3 }, anonymous: true },
  { tool: 'get_profile_notes', args: { slug }, anonymous: true },
  { tool: 'get_my_following', args: {} },
  { tool: 'get_me', args: {} },
  { tool: 'get_my_notes', args: {} },
  { tool: 'get_my_posts', args: { limit: 5 } },
  { tool: 'get_post_comments', args: { post_id: postId } },
  { tool: 'create_post_comment', args: { post_id: postId, body: 'Great post' } },
  { tool: 'reply_to_post_comment', args: { comment_id: commentId, body: 'Agreed' } },
  { tool: 'get_post_comment', args: { comment_id: commentId } },
  { tool: 'delete_post_comment', args: { comment_id: commentId } },
  { tool: 'list_post_comment_replies', args: { comment_id: commentId } },
  { tool: 'like_post_comment', args: { comment_id: commentId } },
  { tool: 'unlike_post_comment', args: { comment_id: commentId } },
  { tool: 'list_drafts', args: {} },
  { tool: 'get_draft', args: { draft_id: draftId } },
  { tool: 'create_draft', args: { title: 'Harness draft', subtitle: 'Sub', body: DRAFT_BODY } },
  { tool: 'update_draft', args: { draft_id: draftId, title: 'New title', body: DRAFT_BODY } },
  { tool: 'delete_draft', args: { draft_id: draftId } },
  { tool: 'get_ai_detection', args: { draft_id: draftId } },
  { tool: 'check_draft', args: { draft_id: draftId } },
  {
    tool: 'schedule_draft',
    args: { draft_id: draftId, scheduled_at: FUTURE, post_audience: 'everyone' },
  },
  { tool: 'unschedule_draft', args: { draft_id: draftId } },
  { tool: 'upload_image', args: { image_base64: PNG_BASE64, content_type: 'image/png' } },
  { tool: 'get_subscriber_timeseries', args: {} },
  { tool: 'get_30d_views', args: {} },
  { tool: 'get_arr_timeseries', args: { from_date: '2024-01-01T00:00:00Z' } },
  { tool: 'get_email_timeseries', args: {} },
  { tool: 'get_dashboard_summary', args: {} },
  { tool: 'get_dashboard_period', args: { range_days: 30 } },
  { tool: 'get_recommendation_stats', args: { direction: 'incoming', limit: 5 } },
  { tool: 'get_post_counts', args: {} },
  { tool: 'get_post_engagement', args: { post_id: postId } },
  { tool: 'get_post_traffic', args: { post_id: postId } },
  { tool: 'get_post_recipients', args: { post_id: postId, limit: 5 } },
  { tool: 'get_post_growth', args: { post_id: postId } },
  { tool: 'get_post_discussion', args: { post_id: postId } },
];

export const REST_OPERATIONS = REST.map((r) => r.op);
export const MCP_TOOLS = MCP.map((m) => m.tool);

const VARIANTS: Variant[] = [
  'happy',
  'missing-token',
  'invalid-token',
  'substack-404',
  'substack-500',
];

function tokenHeader(v: Variant): Record<string, string> {
  if (v === 'missing-token') return {};
  return { 'x-gateway-token': v === 'invalid-token' ? INVALID_TOKEN : TOKEN };
}

function substackStatus(v: Variant): number | undefined {
  if (v === 'substack-404') return 404;
  if (v === 'substack-500') return 500;
  return undefined;
}

function restCases(r: RestOp): MatrixCase[] {
  return VARIANTS.map((v) => ({
    name: `REST ${r.op} [${v}]`,
    method: r.method,
    path: r.path,
    headers: tokenHeader(v),
    ...(r.body !== undefined ? { body: r.body } : {}),
    ...(r.form !== undefined ? { form: r.form } : {}),
    substackStatus: substackStatus(v),
    expectSuccess: v === 'happy',
  }));
}

function toolArgs(m: McpOp, v: Variant): Record<string, unknown> {
  if (v === 'missing-token') return m.args;
  // Anonymous tools take no token; an invalid one still checks argument validation.
  if (m.anonymous && v !== 'invalid-token') return m.args;
  return { ...m.args, token: v === 'invalid-token' ? INVALID_TOKEN : TOKEN };
}

function mcpCases(m: McpOp): MatrixCase[] {
  return VARIANTS.map((v) => ({
    name: `MCP ${m.tool} [${v}]`,
    method: 'POST',
    path: '/mcp',
    mcp: { tool: m.tool, args: toolArgs(m, v) },
    substackStatus: substackStatus(v),
    expectSuccess: v === 'happy',
  }));
}

const token = { 'x-gateway-token': TOKEN };

const EXTRA: MatrixCase[] = [
  { name: 'GET / (root)', method: 'GET', path: '/', expectSuccess: true },
  {
    name: 'MCP initialize',
    method: 'POST',
    path: '/mcp',
    rpc: {
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'parity-harness', version: '1' },
      },
    },
    expectSuccess: true,
  },
  {
    name: 'MCP tools/list',
    method: 'POST',
    path: '/mcp',
    rpc: { method: 'tools/list', params: {} },
    expectSuccess: true,
  },
  {
    name: 'MCP tools/list via /mcp/',
    method: 'POST',
    path: '/mcp/',
    rpc: { method: 'tools/list', params: {} },
    expectSuccess: true,
  },
  ...['ping', 'prompts/list', 'resources/list', 'resources/templates/list'].map((method) => ({
    name: `MCP ${method}`,
    method: 'POST',
    path: '/mcp',
    rpc: { method, params: {} },
    expectSuccess: true,
  })),
  {
    name: 'MCP logging/setLevel',
    method: 'POST',
    path: '/mcp',
    rpc: { method: 'logging/setLevel', params: { level: 'info' } },
  },
  {
    name: 'MCP get_note via /mcp/',
    method: 'POST',
    path: '/mcp/',
    mcp: { tool: 'get_note', args: { note_id: noteId, token: TOKEN } },
    expectSuccess: true,
  },
  { name: 'GET /mcp', method: 'GET', path: '/mcp', headers: { accept: 'text/event-stream' } },
  { name: 'DELETE /mcp', method: 'DELETE', path: '/mcp' },
  {
    name: 'MCP unknown tool',
    method: 'POST',
    path: '/mcp',
    mcp: { tool: 'no_such_tool', args: {} },
  },
  {
    name: 'MCP get_post missing required argument',
    method: 'POST',
    path: '/mcp',
    mcp: { tool: 'get_post', args: { token: TOKEN } },
  },
  {
    name: 'REST GET /api/v1/posts/abc (422)',
    method: 'GET',
    path: '/api/v1/posts/abc',
    headers: token,
  },
  ...(
    [
      ['POST', '/api/v1/notes'],
      ['POST', '/api/v1/drafts'],
      ['PUT', '/api/v1/drafts/1'],
    ] as const
  ).flatMap(([method, path]) =>
    (
      [
        ['zero-byte JSON body', '', 'application/json'],
        ['malformed JSON body', '{', 'application/json'],
        ['non-JSON content type', 'x', 'application/x-www-form-urlencoded'],
      ] as const
    ).map(([what, content, contentType]) => ({
      name: `REST ${method} ${path} ${what} (422)`,
      method,
      path,
      headers: token,
      rawBody: { content, contentType },
    })),
  ),
  {
    name: 'REST POST /api/v1/notes empty body (422)',
    method: 'POST',
    path: '/api/v1/notes',
    headers: token,
    body: {},
  },
  {
    name: 'REST GET /api/v1/stats/recommendations/sideways (422)',
    method: 'GET',
    path: '/api/v1/stats/recommendations/sideways',
    headers: token,
  },
  {
    name: 'REST GET /api/v1/health/ready?show=true',
    method: 'GET',
    path: '/api/v1/health/ready?show=true',
    headers: token,
    expectSuccess: true,
  },
  { name: 'REST unknown route', method: 'GET', path: '/api/v1/nope', headers: token },
];

export const MATRIX: MatrixCase[] = [
  ...REST.flatMap(restCases),
  ...MCP.flatMap(mcpCases),
  ...EXTRA,
];

/**
 * Known, accepted differences. `field` is the diff field ("status",
 * "content-type", "body", "substack-calls"); `match` selects case names.
 */
export type AllowedDiff = {
  match: RegExp;
  field: string;
  reason: string;
  /** Narrower check on the differing values; the diff is allowed only when true. */
  applies?: (m: { field: string; upstream: unknown; worker: unknown }) => boolean;
};

const isString = (v: unknown): v is string => typeof v === 'string';
const squash = (v: string) => v.replace(/\s+/g, ' ').trim();

export const ALLOWED_DIFFS: AllowedDiff[] = [
  {
    match: /./,
    field: 'body',
    reason:
      'Inner array of a 422 `detail`: FastAPI/pydantic and zod word, type and count validation errors differently (brief: allowed). Status, content-type and the `detail` array itself still compare.',
    applies: (m) => /^body \$\.detail\.(length|\d+)/.test(m.field),
  },
  {
    match: /./,
    field: 'body',
    reason:
      'Version strings (brief: allowed). Upstream FastMCP reports its own library version (4.1.6) as serverInfo.version; the Worker reports the ported gateway-oss version.',
    applies: (m) => /\.version$/.test(m.field),
  },
  {
    match: /^MCP /,
    field: 'body',
    reason:
      'MCP tool-argument validation text: pydantic `validate_call` vs zod wording, the MCP twin of the 422 `detail` inner array. Both sides still return `isError: true` with no structuredContent, and those fields compare.',
    applies: (m) =>
      m.field === 'body $.result.content.0.text' &&
      isString(m.upstream) &&
      isString(m.worker) &&
      /^\d+ validation errors? for call\[\w+\]\n/.test(m.upstream) &&
      /^Input validation error: Invalid arguments for tool \w+: /.test(m.worker),
  },
  {
    match: /./,
    field: 'body',
    reason:
      'htmlToMarkdown whitespace (brief: allowed): markdownify and node-html-markdown differ in blank lines and spacing only.',
    applies: (m) =>
      /markdown/.test(m.field) &&
      isString(m.upstream) &&
      isString(m.worker) &&
      squash(m.upstream) === squash(m.worker),
  },
];
