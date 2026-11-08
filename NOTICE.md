# Notice

This project is a TypeScript / Cloudflare Workers port of
[jakub-k-slys/substack-gateway-oss](https://github.com/jakub-k-slys/substack-gateway-oss),
pinned at commit `bc2e875`. The upstream project is MIT licensed
(Copyright (c) 2025 Jakub Slys); see `LICENSE`.

Documentation: `docs/authentication.md`, `docs/api-reference.md` and `docs/mcp.md` are
adapted from upstream's docs of the same names (changed, see each file's header);
`docs/drafts-markdown.md` is copied unchanged apart from its header notice (its
body is byte-exact). `docs/extensions.md` and `docs/deploy.md` are new.

Behaviour, messages and defaults are reproduced from upstream. Test material:

- `test/fixtures/samples/` (upstream `packages/gateway_oss/samples/api/v1/`),
  `test/fixtures/drafts/` (upstream `packages/gateway_drafts/tests/fixtures/`),
  `test/fixtures/upstream-docs/` (upstream `docs/mcp.md` and `docs/api-reference.md`)
  and the Gherkin feature files in `test/features/` are copied from upstream
  unchanged.
- `test/fixtures/golden/` is generated from upstream's converters by
  `scripts/golden/generate.py`; it is upstream output, not hand-written.

Unofficial. Not affiliated with Substack.
