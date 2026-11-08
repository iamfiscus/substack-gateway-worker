# Changelog

## 0.1.0 - 2026-11-07

First release: an unofficial Cloudflare Worker port of
[substack-gateway-oss](https://github.com/jakubslys/substack-gateway-oss) (upstream
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
- Differential parity harness running upstream and the Worker side by side on Cloudflare
  Sandbox, plus golden fixtures generated from upstream.
- Test suites: node unit and BDD tests, workerd runtime tests, and a live e2e suite
  (`npm run test:e2e`, gated on `E2E_BASE_URL` and `E2E_GATEWAY_KEY`, offline by default).
- Docs: README, API and MCP references, authentication, deploy and extension guides.
- CI on GitHub Actions: lint, typecheck, node tests and workerd tests; no secrets and no
  live calls.
