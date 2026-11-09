# Changelog

## Unreleased

- Fix: an empty, malformed or non-JSON request body on a JSON route (notes, drafts,
  comments, schedule, ...) answered `500`; it now answers upstream's `422` bodies
  (`missing`, `json_invalid` with the error position, `model_attributes_type`). Found while
  editing a draft live; the harness only ever sent `{}`. 9 new harness cases (528 total,
  0 mismatches locally).
- Parity harness ran on Cloudflare Sandbox: 519 cases, 0 mismatches (66 allowed
  differences). Receipt with every attempt, failures included:
  `evidence/2026-11-08-explained-dry-run/`.
- Harness fixes for Sandbox: start upstream with `uv run --frozen --no-sync` (the container
  has no internet), restart the container on retry and return 503 JSON instead of error
  1101, and compare `tools/list` by tool name (upstream's order follows filesystem
  entry-point order and differs between hosts).

## 0.1.0 - 2026-11-08

First release: an unofficial Cloudflare Worker port of
[substack-gateway-oss](https://github.com/jakub-k-slys/substack-gateway-oss) (upstream
commit `bc2e875`). Not affiliated with Substack.

- REST API with parity to upstream: 51 endpoints, OpenAPI document and Swagger UI.
- MCP server over streamable HTTP at `/mcp`: 49 tools, matching upstream names and schemas.
- Draft Markdown dialect converter (Markdown to Substack draft doc and back), including
  CRLF handling, rich elements and image upload with watermark sizing.
- Owner mode: set `GATEWAY_API_KEYS` plus `OWNER_*` secrets; callers use a gateway key and
  the Worker supplies the owner's Substack credentials. A feature gate
  (`OWNER_ALLOWED_FEATURES`) keeps writes such as Notes, comments, deletes and publishing off
  by default. Explicit `x-gateway-token` callers bypass the gate.
- Extension API (`createGateway`, `GatewayExtension`): custom routes, MCP tools,
  authentication, credential resolvers, fetchers, and KV-backed value and stats caches.
- Differential parity harness that runs upstream and the Worker side by side and diffs
  their responses: run locally; Sandbox-ready, not yet run on Cloudflare. Plus golden
  fixtures generated from upstream.
- Test suites: node unit and BDD tests, workerd runtime tests, and a live e2e suite
  (`npm run test:e2e`, gated on `E2E_BASE_URL` and `E2E_GATEWAY_KEY`, offline by default).
- Docs: README, API and MCP references, authentication, deploy and extension guides.
- CI on GitHub Actions: lint, typecheck, node tests and workerd tests; no secrets and no
  live calls.
- In owner mode `OWNER_CONNECT_SID` is optional (unlike upstream): Substack does not always
  set a `connect.sid` cookie any more. Without it, owner requests send `substack.sid` alone.
  Pass-through `x-gateway-token` credentials still require both, as upstream.
- Owner secrets are trimmed, and a blank `OWNER_SUBSTACK_SID` is rejected as a
  misconfiguration instead of being sent to Substack.
- Known issues documented in `docs/known-issues.md`: Substack rate-limits Workers egress
  (429), and two upstream endpoints (`/me/notes`, `/me/following`) fail on Substack's side.
