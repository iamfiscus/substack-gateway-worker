<!--
MIT License. Copyright (c) 2025 Jakub Slys.
Adapted from https://github.com/jakub-k-slys/substack-gateway-oss at commit bc2e875
(docs/mcp.md) for the Cloudflare Worker port. CHANGED from upstream: the intro,
authentication and error sections are rewritten for this Worker; the endpoint/tool
list is the same inventory, checked against the live code by test/docs.test.ts.
See ../LICENSE and ../NOTICE.md. Unofficial. Not affiliated with Substack.
-->

Credit: adapted from jakub-k-slys/substack-gateway-oss @ bc2e875.

# MCP

The MCP server is mounted at `/mcp` (and `/mcp/`, which behaves the same) and
served over streamable HTTP, stateless. It exposes 49 tools.

## Credentials and the `token` argument

Every authenticated tool takes an optional `token` argument: a
base64-encoded JSON object of `publication_url`, `substack_sid`, and
`connect_sid`, the same shape used for the REST `x-gateway-token` header
(see [Authentication](authentication.md)).

- If `token` is supplied, it is always used (and is not feature-gated).
- If it is omitted, the Worker asks its credential resolver to map the
  authenticated MCP caller to Substack credentials. In owner mode that is the
  built-in resolver reading the `OWNER_*` secrets, restricted to
  `OWNER_ALLOWED_FEATURES`. An extension may install its own resolver (see
  [Extensions](extensions.md)).
- With no resolver, or no authenticated caller, an omitted `token` raises
  `MissingCredentialsError`, whose message tells the caller to pass `token`.
- Tool arguments can end up in agent transcripts. Passing a `token` through an
  MCP client puts full-account cookies there.

**The three `profiles` tools need no credentials at all**:
`get_profile`, `get_profile_posts`, and `get_profile_notes` read Substack's
public global API directly and take no `token` parameter. Every other tool
in this reference is authenticated in the sense above.

## Notes (7)

- `get_note(note_id, token=None)` — return a single note by ID.
- `create_note(content, token=None, attachment=None)` — convert Markdown
  `content` to a Substack note and publish it; `attachment` is an optional
  URL.
- `delete_note(note_id, token=None)` — delete a note.
- `like_note(note_id, token=None)` — like a note.
- `unlike_note(note_id, token=None)` — remove a like from a note.
- `reply_to_note(note_id, body, token=None)` — reply to a note or to any
  comment in its thread.
- `list_note_replies(note_id, token=None)` — list direct replies to a note
  (or any node in its thread).

## Posts (4)

- `get_post(post_id, token=None)` — return a post with its full content
  (HTML converted to Markdown).
- `like_post(post_id, token=None)` — like a post.
- `unlike_post(post_id, token=None)` — remove a like from a post.
- `restack_post(post_id, token=None)` — restack a post.

## Profiles (3) — no credentials required

- `get_profile(slug)` — return a public profile by handle.
- `get_profile_posts(slug, limit=25, cursor=None)` — return a page of posts
  for the profile.
- `get_profile_notes(slug, cursor=None)` — return a page of notes for the
  profile.

## Following (1)

- `get_my_following(token=None)` — list the profiles the authenticated user
  follows.

## Me (3)

- `get_me(token=None)` — return the authenticated user's own profile.
- `get_my_notes(token=None, cursor=None)` — return a page of the
  authenticated user's own notes.
- `get_my_posts(token=None, limit=25, cursor=None)` — return a page of the
  authenticated user's own posts.

## Comments (8)

- `get_post_comments(post_id, token=None)` — return the comments for a post.
- `create_post_comment(post_id, body, token=None)` — create a top-level
  comment on a post.
- `reply_to_post_comment(comment_id, body, token=None)` — reply to an
  existing comment.
- `get_post_comment(comment_id, token=None)` — return a single comment by
  ID.
- `delete_post_comment(comment_id, token=None)` — delete a comment.
- `list_post_comment_replies(comment_id, token=None)` — list replies to a
  comment.
- `like_post_comment(comment_id, token=None)` — like a comment.
- `unlike_post_comment(comment_id, token=None)` — remove a like from a
  comment.

## Drafts (10)

- `list_drafts(token=None, next=None)` — list drafts newest first, in pages
  of 10; `next` is an opaque cursor from a previous call.
- `get_draft(draft_id, token=None)` — fetch a draft by ID. The `body` is
  returned as lossless dialect Markdown (see
  [Draft Markdown dialect](drafts-markdown.md)) together with `updated_at`.
- `create_draft(token=None, title=None, subtitle=None, body=None)` — create
  a new draft; `body` is dialect Markdown.
- `update_draft(draft_id, token=None, title=None, subtitle=None, body=None, expected_updated_at=None)`
  — update only the fields actually passed. Pass the `updated_at` from
  `get_draft` as `expected_updated_at` to refuse the update (tool error, nothing
  written) if the draft changed since you read it. Returns the new
  `updated_at`.
- `delete_draft(draft_id, token=None)` — delete a draft.
- `get_ai_detection(draft_id, token=None)` — run Substack's Pangram
  AI-writing detection on a draft.
- `check_draft(draft_id, token=None)` — run Substack's pre-publish
  validation on a draft.
- `schedule_draft(draft_id, scheduled_at, token=None, post_audience="only_paid", email_audience="only_paid")`
  — schedule a draft for timed release.
- `unschedule_draft(draft_id, token=None)` — cancel a draft's scheduled
  release.
- `upload_image(image_base64, token=None, content_type="image/png")` —
  upload a base64-encoded image to Substack and return its hosted URL and
  dimensions. More than 10 MB decoded is a tool error (a port addition).

### Draft bodies

Draft `body` values (the argument of `create_draft` / `update_draft`, and what
`get_draft` returns) use a Markdown dialect with extensions for horizontal
rules, `::button[...]{href=subscribe|share|comment}` buttons, image
`{size=normal|large|full}` and `{watermark=N%}`, `::defaults{align=...}` and
`:::align{...}` alignment, `:::callout` blocks, and verbatim `substack-node`
fences for anything else. Reading a draft and writing it back is lossless.
Malformed dialect is rejected with a tool error naming the line. The full syntax
is in [Draft Markdown dialect](drafts-markdown.md).

## Stats (8)

- `get_subscriber_timeseries(token=None, from_date=None)` — daily subscriber
  counts (paid / comps / free trials / total). If a cache extension is
  installed, only the tail beyond the last stored day is re-fetched from
  Substack on later calls. The default install has no such cache (`kvStatsCache` is opt-in, owner mode only; see [Extensions](extensions.md)), so every call fetches the full window.
- `get_30d_views(token=None)` — trailing-30-day publication views and their
  delta.
- `get_arr_timeseries(token=None, from_date=None)` — daily annualized recurring
  revenue; each point keeps the raw money string next to the parsed number. If
  a cache extension is installed, only the tail beyond the last stored day is
  re-fetched from Substack on later calls. The default install has no such cache (`kvStatsCache` is opt-in, owner mode only; see [Extensions](extensions.md)), so every call fetches the full window.
- `get_email_timeseries(token=None, from_date=None)` — daily email subscriber
  counts. If a cache extension is installed, only the tail beyond the last
  stored day is re-fetched from Substack on later calls. The default install has no such cache (`kvStatsCache` is opt-in, owner mode only; see [Extensions](extensions.md)), so every call fetches the full window.
- `get_dashboard_summary(token=None)` — the publish dashboard's headline
  numbers.
- `get_dashboard_period(token=None, range_days=365)` — dashboard summary over
  the trailing `range_days` days (1–3650).
- `get_recommendation_stats(direction, token=None, offset=0, limit=20)` —
  recommendation stats, `outgoing` or `incoming`, paginated (`limit` 1–100).
- `get_post_counts(token=None)` — post counts by state (published, drafts,
  scheduled, ...).

## Post Stats (5)

- `get_post_engagement(post_id, token=None)` — likes, comment summary, and
  commenters for a post.
- `get_post_traffic(post_id, token=None)` — referrers, devices, and category
  breakdown of a post's views.
- `get_post_recipients(post_id, token=None, limit=20, offset=0)` —
  per-recipient email delivery / open / click rows.
- `get_post_growth(post_id, token=None)` — subscriber growth attributed to a
  post.
- `get_post_discussion(post_id, token=None, cursor=None)` — comment /
  discussion thread for a post.

## Transport Notes

- Path: `/mcp` and `/mcp/`
- Transport: streamable HTTP
- HTTP mode: stateless. GET and DELETE are not served (405).
- Tool-argument validation errors are produced by zod, so their wording differs
  from upstream's pydantic messages.

## Extension Hooks

Extensions can register additional MCP tools, an `authenticate` function and a
credential resolver, through the `GatewayExtension` interface. See
[Extensions](extensions.md).
