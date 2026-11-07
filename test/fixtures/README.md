<!--
MIT License. Copyright (c) 2025 Jakub Slys.
These fixtures are copied from https://github.com/jakub-k-slys/substack-gateway-oss
at commit bc2e875 (packages/gateway_oss/samples/api/v1/ and
packages/gateway_drafts/tests/fixtures/, docs/mcp.md and docs/api-reference.md). See ../../LICENSE and ../../NOTICE.md.
-->
# Test fixtures

Credit: copied from jakub-k-slys/substack-gateway-oss @ bc2e875.

- `samples/` mirrors upstream `packages/gateway_oss/samples/api/v1/`.
- `drafts/` holds `web_editor_draft.json`, `gateway_draft.json`, `legacy_gateway_draft.json`.
- `upstream-docs/` holds upstream `docs/mcp.md` and `docs/api-reference.md`, unchanged;
  `test/app/inventory.test.ts` checks the REST and MCP inventory against them.
