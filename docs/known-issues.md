# Known issues

## Upstream endpoint drift (Substack side)

Checked live on 2026-11-08 against upstream commit `bc2e875` behaviour. These come
from Substack, not from the port: the same requests fail directly with `curl`, with or
without a `connect.sid` cookie. The port stays faithful to upstream until upstream
changes.

| Gateway route              | MCP tool           | Substack call                                                         | Substack answers |
| -------------------------- | ------------------ | --------------------------------------------------------------------- | ---------------- |
| `GET /api/v1/me/notes`     | `get_my_notes`     | `GET {publication}/api/v1/notes`                                      | `404`            |
| `GET /api/v1/me/following` | `get_my_following` | `GET {publication}/api/v1/user/{id}/subscriber-lists?lists=following` | `403`            |

`GET /api/v1/health/ready` reports `connected: true` when Substack answers `401`/`403`
(reachable, upstream semantics), so it is not a cookie-validity check. Use
`GET /api/v1/me` for that.

## Cloudflare Workers egress to Substack

Substack sits behind Cloudflare and answers most requests from Cloudflare Workers
egress with `429 Too Many Requests`, authenticated or not (measured 2026-11-08: 15/15
authenticated reads, and most anonymous reads). The same requests from a home
connection return `200`. Until a relay is in place, run the gateway with
`wrangler dev` (local egress) or route Substack calls through a non-Cloudflare
egress with a custom `fetcher` extension (see [extensions](extensions.md)).
