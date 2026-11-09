# substack-gateway-worker

A TypeScript port, for Cloudflare Workers, of
[substack-gateway-oss](https://github.com/jakub-k-slys/substack-gateway-oss) by
Jakub Slys (MIT, Copyright (c) 2025 Jakub Slys), pinned at commit `bc2e875`.
Behaviour, messages and defaults follow upstream; port changes are listed under
"Differences from upstream" and in `NOTICE.md`. Port copyright (c) 2026 Jd Fiscus.

Unofficial. Not affiliated with Substack.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/iamfiscus/substack-gateway-worker)

Deploy URL: `https://deploy.workers.cloudflare.com/?url=https://github.com/iamfiscus/substack-gateway-worker`

It exposes 51 REST endpoints under `/api/v1` (OpenAPI at `/api/openapi.json`,
Swagger UI at `/api/docs`) and 49 MCP tools at `/mcp`. See
[API reference](docs/api-reference.md), [MCP](docs/mcp.md),
[Authentication](docs/authentication.md), [Draft Markdown](docs/drafts-markdown.md),
[Extensions](docs/extensions.md) and [Deploy](docs/deploy.md).

## Credential modes

**Pass-through (default).** No secrets. Each caller sends their own Substack
credentials: `x-gateway-token` on REST, `token` argument on MCP, as
base64-encoded JSON `{publication_url, substack_sid, connect_sid}`. With
`GATEWAY_API_KEYS` unset the Worker is open, exactly like upstream.

**Owner mode.** Set `GATEWAY_API_KEYS` (comma list of `label:key` or
`label:sha256:<hex>`) plus `OWNER_PUBLICATION_URL` and `OWNER_SUBSTACK_SID`
(and `OWNER_CONNECT_SID` if your browser has that cookie; Substack no longer
always sets it) as Worker secrets. Callers send `Authorization: Bearer <key>`
and use your cookies without ever seeing them. Everything except
`/api/v1/health/live` and `/` needs the key. An explicit token still wins and is
not feature-gated. Resolved credentials are never logged or echoed (`show=true`
returns `403`).

Owner feature list (`OWNER_ALLOWED_FEATURES`, comma list, unset = default): by
default only reads (`get`/`list` and all stats), `drafts:create`,
`drafts:update`, `drafts:prepublish`, `drafts:ai-detection`, image upload and
`health:ready` work with your cookies, as `api:` and `mcp:` names. Creating
notes, comments, likes, deletes, scheduling and restacking are off until you list
them. Prefix entries with `+` to add them to the default, for example
`+api:notes:create,+mcp:notes:create`; a list without `+` replaces the default
entirely. Mixing the two forms is rejected as a misconfiguration. See
[Authentication](docs/authentication.md). The Worker never publishes or
schedules anything on its own, and has no crons.

## Getting your cookies

Log into Substack in a browser, open developer tools, Application (or Storage),
Cookies, and copy the values of `substack.sid` and `connect.sid`.

**Warning: these are full-account credentials.** Anyone holding them can act as
you on Substack: read, post, change settings. Never commit them, paste them into
issues or chats, or send them to a Worker you do not control. Prefer a
throwaway publication while you try this out.

## Terms of Service risk

This uses Substack's internal, undocumented API with your session cookies. It is
not an official integration. Substack's Terms of Service (check
`substack.com/tos` yourself; this is not legal advice) restrict crawling and
scraping, copying or storing significant portions of content, processes that run
while you are not logged in, and sharing account credentials. Violations can
lead to account termination. Automation that runs on a schedule with your
cookies, bulk downloads and handing your cookies to other people are the
likeliest to cross those lines. This project ships no crons and no cookie-health
checker for that reason; keep volume low and human-triggered. Internal endpoints
can also change or vanish without notice. You use this at your own risk.

## Trust model

In pass-through mode the operator's Worker sees callers' cookies: it decodes
every request's token in memory to call Substack. That is upstream's trust model
too. Only send your cookies to a Worker you run. In owner mode your cookies live
in Worker secrets (encrypted, not readable back through wrangler) and callers
never see them, but anyone with a gateway key can use the allowed features as
you. MCP tool arguments can land in agent transcripts, so avoid passing `token`
from an MCP client.

## Limits

Measured in workerd by `test/workers/runtime.test.ts`, with the Cloudflare plan
limits as published at
<https://developers.cloudflare.com/workers/platform/limits/> (checked
2026-11-07; re-check, they change):

| Item                                                      | Measured or counted                                                                                                           | Workers Free          | Workers Paid              |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------- |
| CPU to convert a ~5,000-word draft (`markdownToDraftDoc`) | about 2 to 3 ms (the workerd timer is coarse, treat as approximate)                                                           | 10 ms CPU per request | 30 s default, up to 5 min |
| Subrequests per draft write                               | createDraft: N `POST image` + 1 `user-settings` (byline) + 1 draft POST; updateDraft: N `POST image` + optional 1 GET + 1 PUT | 50 per request        | 10,000 default, up to 10M |
| 1 MB multipart image upload (`POST /api/v1/images`)       | 1 subrequest to Substack                                                                                                      | counts against 50     | counts against 10,000     |
| Memory per isolate                                        | image bytes are base64-encoded in memory                                                                                      | 128 MB                | 128 MB                    |

So creating a draft with 12 external images makes 12 + 1 + 1 = 14 subrequests (updating one makes 12 + 1 GET when `expected_updated_at` is sent + 1 PUT = 14, or 13 without it), which fits
the free plan's 50 but not far beyond it. The free plan's 10 ms CPU cap leaves
little room above the converter's few ms plus parsing and JSON; large drafts may
need Workers Paid. The maintainer's instance runs on Workers Paid.

## Rotating cookies

Cookies expire or get rotated, and static secrets go stale. When requests start
returning `401`, log into Substack, copy fresh values and run:

```sh
pbpaste | npx wrangler secret put OWNER_SUBSTACK_SID
pbpaste | npx wrangler secret put OWNER_CONNECT_SID   # only if you have one
```

Piping the value avoids a non-interactive shell silently uploading an empty
secret; a blank `OWNER_SUBSTACK_SID` makes owner routes answer `500 gateway
misconfigured`.

A `403` from Substack can be a bot-challenge page rather than an expired
session; try the same cookies in a browser first. Rotate `GATEWAY_API_KEYS` the
same way. Note: a raw gateway key that literally starts with `sha256:` is read as
a hash entry, so choose keys that do not.

## Differences from upstream

Dropped (cannot work in a bundled Worker or ToS-driven):

- lifespan hooks (Workers have no lifespan)
- httpx connection pool settings
- loading extensions from environment variables or entry points (extensions are
  listed statically in `src/index.ts`)
- the optional cookie-health cron (it would be a process running while you are
  not logged in)

Changed behaviour:

- Malformed Substack responses (HTML bot-challenge pages, empty bodies, non-JSON)
  surface as `502`, not upstream's `500`.
- Note content is capped at 50,000 characters (`422` on REST, a tool error on
  MCP), because pathological Markdown costs real CPU on Workers.
- Replying to a target that has no post returns a distinct `404`.
- Redirects are never followed, so cookies are never sent off-host.
- MCP tool-argument validation wording differs (zod, not pydantic).
- Draft dialect, JS number limits: `1.0` round-trips as `1`, integers above 2^53
  lose precision, and attribute keys that look like integers are ordered first.
- Owner mode, the feature gate, hashed gateway keys and the optional KV caches are
  additions.
- `POST /api/v1/images` and the `upload_image` MCP tool refuse images over
  10 MB (`413 {"detail":"Image too large (max 10 MB)"}` on REST, checked from
  `Content-Length` before the body is read and again on the file size; an upload
  without a numeric `Content-Length`, such as a chunked one, is
  `411 {"detail":"Content-Length required"}`; a tool
  error on MCP, whose transport already caps a request at 4 MB). Upstream has
  no cap.
- An incoming `X-Request-ID` is reused only if it is at most 128 characters of
  `[A-Za-z0-9._-]`; anything else gets a fresh UUID.
- `scheduled_at` given as a numeric string (`"1767225600"`) is a `422`; pydantic
  accepts it as a unix timestamp. Send a JSON number or an ISO-8601 string.
- A Substack user-settings entry without a `type` is accepted (only `user_id` is
  read); upstream's model requires `type` and answers `500`.
- With a value cache installed (for example `kvValueCache`), the public profile
  lookup behind the profile routes is fetched anonymously (empty cookies, as the
  MCP profile tools do), so a cached profile never depends on one caller's
  session and one caller's auth error is never served to another. Without a
  cache the caller's credentials are used, as upstream does.

## Develop

```sh
npm install
scripts/fetch-upstream.sh   # clones the pinned upstream reference into upstream/
npm test && npm run test:workers && npm run typecheck && npm run lint
```
