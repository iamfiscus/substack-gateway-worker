# Timeline: porting substack-gateway-oss to a Cloudflare Worker

Sources: the SDD ledger (`site/.superpowers/sdd/2026-11-07-substack-gateway-worker/progress.md`) and `git log` of the gateway repo. Times are local (US Eastern) commit times.

## Day 1: 2026-11-07, the offline port (about 4 hours of commits)

- **Plan and pre-flight.** The plan had 22 tasks plus a Task 0 "spike" to check whether Substack accepts requests from Cloudflare Worker egress. The spike needed real cookies, which were not available yet. **Decision:** build Tasks 1 to 19 offline against a fake Substack while waiting. Task 0 still had to pass before any live work. The cost if wrong was writing code first and only then finding out Workers egress is blocked. The code would still work behind a proxy.
- **15:29 Scaffold** (`c67e392`). New local repo pinned to upstream `bc2e875`. Work committed straight to `main` because nothing was shared yet.
- **Tasks 2 to 5: auth, HTTP base, app shell.** A security review reopened Task 3 because cookies could follow redirects, which upstream httpx does not allow. Fixed with `redirect: 'manual'`. Ruling: every fetcher must pass the Request through unchanged so that setting holds.
- **16:07 Owner allow-list ruling** (`984ebb0`). The plan's default feature list came from an incomplete grep. The fix allows every upstream read feature by default and still blocks writes such as `notes:create`.
- **Tasks 7 and 8: notes, comments and stats read paths.** One plan error fixed: recommendations take `outgoing|incoming` as upstream does, not `from|to`.
- **16:32 to 17:53: converters and the draft dialect** (Tasks 9 to 15). Golden outputs were generated from upstream Python. Results: 566 note goldens byte-identical; 477 draft-doc and 98 draft-error goldens match; 688 of 692 draft-markdown goldens are exact, and the other 4 are documented float or big-int differences. A random check of 125k documents found 0 mismatches. Rulings: a port of CPython's JSON encoder and decoder (`pyJson.ts`) was accepted. Note content is capped at 50,000 characters because runs of `[` cost about 4s of CPU per 100k characters on Workers.
- **18:06 Full inventory** (`3177cdf`): 51 REST operations and 49 MCP tools. **18:21** OpenAPI document and Swagger UI (`67c1f02`).
- **Task 19: workerd perf tests.** Converting a 5,049-word post to a draft takes about 2 to 3 ms in workerd. A 1 MB upload uses 1 subrequest.
- **Task 20: differential parity harness**, upstream vs Worker. The first run found 1,934 mismatches: MCP error text, `isError`, tools/list shape and order, 405 bodies and similar. After fixes: 519 cases, 0 mismatches. The Docker path was blocked (an arm64 SIGILL in `cryptography`, and a full disk). Deploying a Sandbox needed approval, so the harness ran locally.
- **Task 22 and final review.** The final review found 0 Critical and 6 Important issues. The fix wave added a host-bound write guard for e2e, `+`-additive `OWNER_ALLOWED_FEATURES`, anonymous profile fetches when cached, a pinned MCP SDK, and a 411 response for image uploads without Content-Length. **19:26** the final review was clean (`a88d491`).
- **Evening: publish.** Pushed to the public repo `iamfiscus/substack-gateway-worker` and deployed `substack-gateway-nerding`.
- **Task 0 finding: NO-GO.** Substack sits behind Cloudflare and answered **429 Too Many Requests** to most requests from Worker egress. Only about 1 in 4 to 8 requests got a 200, whatever the User-Agent. The same requests from a Mac got 200. The plan treats this as a stop condition, so live work paused.

## Day 2: 2026-11-08, the live check

- **Empty-secret upload.** The first `wrangler secret put` runs came from a non-TTY shell, never prompted for a value, and uploaded **empty** secrets. The earlier reading, "500 misconfigured means cookies are absent", was wrong. The resolver was rejecting blank values. The cookie was set again from the clipboard.
- **connect.sid missing.** The browser session had no `connect.sid` cookie at all. Fix `7e87aff` (20:13): `OWNER_CONNECT_SID` is optional in owner mode, owner secrets are trimmed, and a blank `substack.sid` is rejected. Token mode keeps upstream's two-cookie rule. 4,366 node tests and 8 workers tests pass.
- **429 confirmed with authentication.** Owner reads from Worker egress returned 429 on 15 of 15 requests, and `/health/ready` reported `connected:false`. Authentication does not lift the limit. **Final verdict: Task 0 is NO-GO for direct Workers egress.** Options left open: a relay, upstream hosted elsewhere, or running locally.
- **Local works.** `wrangler dev` with Mac egress returned 200 for health/ready, me, me/posts, stats/subscribers and drafts.
- **Upstream drift.** `/me/notes` returns 404 and `/me/following` returns 403. Plain curl straight to Substack gets the same results, and upstream has not changed since `bc2e875`. This is drift on Substack's side, not a porting bug. The e2e tests now skip both with a reason, and both are recorded in `docs/known-issues.md`.
- **Post comments** e2e fails by design: comments are read from the owner's publication host, and the fixture post is not on that publication.
- **20:22 v0.1.0** (`17311e5`, `d5d0a1a`). The tag first pointed at `17311e5`, which failed the Biome Markdown table format check. It was moved to `d5d0a1a` after CI went green. The empty `OWNER_CONNECT_SID` secret was deleted from the deployed Worker.

## Numbers at a glance

43 commits over about 29 hours. 10,292 lines of TypeScript in `src/` and 11,731 in `test/`. 51 REST endpoints and 49 MCP tools. Tests: 4,366 node and 8 workerd passing. The parity harness runs 519 cases with 0 mismatches.
