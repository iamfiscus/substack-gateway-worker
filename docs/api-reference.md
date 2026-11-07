<!--
MIT License. Copyright (c) 2025 Jakub Slys.
Adapted from https://github.com/jakub-k-slys/substack-gateway-oss at commit bc2e875
(docs/api-reference.md) for the Cloudflare Worker port. CHANGED from upstream: the intro,
authentication and error sections are rewritten for this Worker; the endpoint/tool
list is the same inventory, checked against the live code by test/docs.test.ts.
See ../LICENSE and ../NOTICE.md. Unofficial. Not affiliated with Substack.
-->

Credit: adapted from jakub-k-slys/substack-gateway-oss @ bc2e875.

# API Reference

The REST API is mounted under `/api/v1`. It totals 51 endpoints across 39
paths. An OpenAPI document is served at `/api/openapi.json` and Swagger UI at
`/api/docs`.

## Authentication

The Worker has two credential modes (see [Authentication](authentication.md)).

- **Pass-through** (no `GATEWAY_API_KEYS`): every route below requires the
  `x-gateway-token` header **except** `GET /api/v1/health/live`, including
  "public-looking" routes such as `GET /api/v1/profiles/{slug}`. A missing
  header returns `422`.
- **Owner mode** (`GATEWAY_API_KEYS` set): every route except
  `GET /api/v1/health/live` (and `GET /`) needs `Authorization: Bearer <key>`,
  or the request gets `401`. With a valid key and no `x-gateway-token`, the
  owner's cookies from Worker secrets are used, limited to the features in
  `OWNER_ALLOWED_FEATURES`; a disabled feature returns
  `403 {"detail":"feature <name> disabled for owner credentials"}`. An explicit
  `x-gateway-token` still wins and is not feature-gated.

## Health (2)

### `GET /api/v1/health/live`

Public liveness probe. No credentials required. Returns `{"status": "ok"}`.

### `GET /api/v1/health/ready`

Authenticated readiness probe that calls Substack to verify connectivity.
Optional query parameter `show` (bool, default `false`): when `true`, echoes
the decoded credential payload back in the response. Credentials resolved from
Worker secrets (owner mode) are never echoed: `show=true` returns `403`.

## Me (3)

### `GET /api/v1/me`

Returns the authenticated user's own profile.

### `GET /api/v1/me/notes`

Returns a page of the authenticated user's own notes. Query parameter:
`cursor` (opaque, optional).

### `GET /api/v1/me/posts`

Returns a page of the authenticated user's own posts. Query parameters:
`limit` (default `25`, max `100`), `cursor` (opaque, optional).

## Following (1)

### `GET /api/v1/me/following`

Returns the list of profiles the authenticated user follows.

## Notes (7)

### `GET /api/v1/notes/{note_id}`

Returns a single note by numeric ID.

### `POST /api/v1/notes`

Converts Markdown content to a Substack note and publishes it. Body:
`content` (string, required), `attachment` (URL, optional). Returns
`201 Created` with the new note's `id`.

### `DELETE /api/v1/notes/{note_id}`

Deletes a note by numeric ID. Returns `204 No Content`.

### `PUT /api/v1/notes/{note_id}/like`

Adds a like to a note. Returns `204 No Content`.

### `DELETE /api/v1/notes/{note_id}/like`

Removes a like from a note. Returns `204 No Content`.

### `POST /api/v1/notes/{note_id}/comments`

Replies to a note, or to any comment inside its thread (`note_id` may name
either). Body: `body` (string, required). Returns `201 Created`.

### `GET /api/v1/notes/{note_id}/comments`

Lists direct replies to a note (or any node in its thread).

## Posts (4)

### `GET /api/v1/posts/{post_id}`

Returns a single post with its full content (HTML converted to Markdown).

### `PUT /api/v1/posts/{post_id}/like`

Adds a like to a post. Returns `204 No Content`.

### `DELETE /api/v1/posts/{post_id}/like`

Removes a like from a post. Returns `204 No Content`.

### `POST /api/v1/posts/{post_id}/restack`

Restacks a post. Returns `204 No Content`.

## Profiles (3)

### `GET /api/v1/profiles/{slug}`

Returns a public profile by handle slug.

### `GET /api/v1/profiles/{slug}/posts`

Returns a page of posts for the profile. Query parameters: `limit` (default
`25`, max `100`), `cursor` (opaque, optional).

### `GET /api/v1/profiles/{slug}/notes`

Returns a page of notes for the profile. Query parameter: `cursor` (opaque,
optional).

## Comments (8)

### `POST /api/v1/posts/{post_id}/comments`

Creates a top-level comment on a post. Body: `body` (string, required).
Returns `201 Created`.

### `POST /api/v1/comments/{comment_id}/comments`

Replies to an existing comment. Body: `body` (string, required). Returns
`201 Created`, or `404` if the parent comment does not exist.

### `GET /api/v1/comments/{comment_id}`

Returns a single comment by ID (the rich comment shape).

### `DELETE /api/v1/comments/{comment_id}`

Deletes a comment. Returns `204 No Content`.

### `GET /api/v1/comments/{comment_id}/comments`

Lists replies to a comment.

### `POST /api/v1/comments/{comment_id}/reaction`

Likes a comment. Returns `204 No Content`.

### `DELETE /api/v1/comments/{comment_id}/reaction`

Removes a like from a comment. Returns `204 No Content`.

### `GET /api/v1/posts/{post_id}/comments`

Returns the comments for a post.

## Drafts (10)

### `GET /api/v1/drafts`

Lists post drafts, newest first, in pages of 10. Query parameter: `next`
(opaque cursor from a previous response). Returns `400` on an invalid
cursor.

### `GET /api/v1/drafts/{draft_id}`

Fetches a single draft by ID. Returns `title`, `subtitle`, `body` and
`updated_at`. `body` is dialect Markdown that reproduces the stored draft
losslessly (see [Draft Markdown dialect](drafts-markdown.md)); pass `updated_at`
back as `expected_updated_at` on `PUT` to detect concurrent edits.

### `PUT /api/v1/drafts/{draft_id}`

Updates specific fields of a draft. Body: any of `title`, `subtitle`, `body`
— only the fields actually set in the request are applied — and the optional
`expected_updated_at`, the `updated_at` from a previous read. When it is given
and the draft's current `updated_at` differs, the update is refused with `409
Conflict` and nothing is written; fetch the draft again and retry. `body` is
dialect Markdown; malformed dialect is rejected with `400` (the `detail` names
the line, e.g. `line 4: unclosed :::callout container ...`). The response is the
updated draft, including its new `updated_at`.

### `DELETE /api/v1/drafts/{draft_id}`

Deletes a draft. Returns `204 No Content`.

### `POST /api/v1/drafts`

Creates a new draft. Body: `title`, `subtitle`, `body` (all optional; `body`
is dialect Markdown, see [Draft Markdown dialect](drafts-markdown.md)). Returns
`201 Created`, or `400` for malformed dialect.

### `GET /api/v1/drafts/{draft_id}/ai-detection`

Runs Substack's Pangram AI-writing detection on a draft.

### `GET /api/v1/drafts/{draft_id}/prepublish`

Runs Substack's pre-publish validation on a draft.

### `POST /api/v1/drafts/{draft_id}/schedule`

Schedules a draft for timed release. Body: `scheduled_at` (datetime,
required), `post_audience` and `email_audience` (optional, default
`"only_paid"`).

### `DELETE /api/v1/drafts/{draft_id}/schedule`

Cancels a draft's scheduled release. Returns `204 No Content`.

### `POST /api/v1/images`

Uploads an image file (multipart `file`) to Substack and returns its hosted
URL and dimensions. Returns `201 Created`.

## Stats (8)

### `GET /api/v1/stats/subscribers`

Daily subscriber counts (paid / comps / free trials / total) as a
timeseries. Query parameter: `from` (ISO timestamp, defaults to the last 7
days). If a cache extension is installed, only the tail beyond the last
stored day is re-fetched from Substack on subsequent calls. The default install has no such cache (`kvStatsCache` is opt-in, owner mode only; see [Extensions](extensions.md)), so every call fetches the full window.

### `GET /api/v1/stats/30d-views`

Trailing-30-day publication views and their delta versus the prior period.

### `GET /api/v1/stats/arr`

Daily annualized recurring revenue as a timeseries. Each point carries the
parsed `arr` number and `arr_display`, the amount exactly as Substack sent it.
Query parameter: `from` (ISO timestamp, defaults to the last 7 days). If a
cache extension is installed, only the tail beyond the last stored day is
re-fetched from Substack on subsequent calls. The default install has no such cache (`kvStatsCache` is opt-in, owner mode only; see [Extensions](extensions.md)), so every call fetches the full window.

### `GET /api/v1/stats/emails`

Daily email subscriber counts as a timeseries. Query parameter: `from` (ISO
timestamp, defaults to the last 7 days). If a cache extension is installed,
only the tail beyond the last stored day is re-fetched from Substack on
subsequent calls. The default install has no such cache (`kvStatsCache` is opt-in, owner mode only; see [Extensions](extensions.md)), so every call fetches the full window.

### `GET /api/v1/stats/dashboard`

Headline dashboard numbers: subscribers, app subscribers, email totals, ARR,
views, open rate, and pledges.

### `GET /api/v1/stats/dashboard/period`

Start and end values of total subscribers, paid subscribers, ARR, views, and
pledged ARR over a trailing window. Query parameter: `range_days` (default
`365`, min `1`, max `3650`).

### `GET /api/v1/stats/recommendations/{direction}`

Recommendation signup stats. `direction` is `outgoing` (publications this one
recommends) or `incoming` (publications recommending this one); any other
value returns `422`. Query parameters: `limit` (default `20`, max `100`),
`offset` (default `0`). `next_offset` is `null` when the page is not full.

### `GET /api/v1/stats/posts/counts`

Post counts by state (published, drafts, scheduled), each with a flag
indicating whether the count is capped by Substack.

## Post Stats (5)

### `GET /api/v1/posts/{post_id}/stats/engagement`

Likes, comment summary, and commenters for a post.

### `GET /api/v1/posts/{post_id}/stats/traffic`

Referrers, devices, and category breakdown of a post's views.

### `GET /api/v1/posts/{post_id}/stats/recipients`

Per-recipient email delivery / open / click rows. Query parameters: `limit`
(default `20`, max `100`), `offset` (default `0`).

### `GET /api/v1/posts/{post_id}/stats/growth`

Subscriber growth attributed to a post.

### `GET /api/v1/posts/{post_id}/stats/discussion`

Comment/discussion thread for a post. Query parameter: `cursor` (opaque
discussion cursor, optional).

## Common Error Semantics

- `400`: invalid request payload (e.g. invalid note content, invalid cursor)
- `401`: invalid or malformed `x-gateway-token`, Substack rejected the
  credentials, or (owner mode) a missing or wrong gateway key
- `403`: owner-mode feature disabled, `show=true` with resolved credentials, or
  Substack answered 403 (which can be a bot-challenge page, not only an auth
  failure)
- `404`: upstream not found, passed through where applicable
- `422`: missing `x-gateway-token` header, or request validation failure
  (including note content over 50,000 characters)
- `429`: upstream rate limiting, passed through where applicable
- `502`: upstream API failure that doesn't map to one of the above, including a
  malformed (HTML, empty or non-JSON) Substack response. Upstream answers `500`
  there. See the README's "Differences from upstream".
