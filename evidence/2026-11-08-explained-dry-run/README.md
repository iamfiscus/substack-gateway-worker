# Evidence receipt: 2026-11-08-explained-dry-run

Receipt for the nerding.io "Explained: hands-on" dry-run post about this port.
Run id: `2026-11-08-explained-dry-run`. Gateway commit: `d5d0a1a` (v0.1.0) for the
local checks; harness fixes `1a6c77a`, `02e1ef0` for the Sandbox run.

Where things ran:

- **Cloudflare Sandbox (container):** the differential parity harness, upstream Python vs
  this Worker against a fake Substack, container internet disabled. 8 runs; run 8 passed
  519 cases with 0 mismatches (66 allowed differences). Runs 1-7 failed or were cut short,
  and their raw responses are kept here: provisioning, image-pull errors, an offline `uv`
  sync, unstable `tools/list` order, a redeploy SIGTERM.
- **Local machine (`wrangler dev`):** live read-only checks with the owner's Substack
  account, the test suites, the 429 egress comparison and the screenshots. Workers egress
  gets 429 from Substack (see `docs/known-issues.md`), so live calls ran locally.

No secrets: the gateway key appears as `Bearer <redacted>`, cookies were never captured,
and the harness used a random throwaway token. Everything Cloudflare-side was deleted
after the run (`sandbox/cleanup.log`). Local paths are shortened to `~` and `<scratch>`.

| Path | Contents |
|---|---|
| `local/manifest.md` | Every local artifact, the exact command that made it, timestamp |
| `local/01*.png` | Screenshots: root JSON, Swagger UI, key-gated docs 401, GitHub repo |
| `local/02a-egress-429.txt` | workers.dev 9x429 / 1x200 vs local 10x200 |
| `local/02b`, `local/02c` | Authenticated read statuses; MCP tools/list (49 tools) |
| `local/03*` | Unit, Workers and read-only e2e test output |
| `local/04-repo-facts.txt`, `local/timeline.md` | Repo counts; timeline of the port, failures included |
| `sandbox/run{1..8}-*` | Raw `/run` responses and timings for every Sandbox attempt |
| `sandbox/run8-summary.txt` | The passing run's summary |
| `sandbox/npm-*.log`, `sandbox/cleanup.log` | Lint/test before the harness commits; teardown record |
