# Differential parity harness

Runs upstream [substack-gateway-oss](https://github.com/jakub-k-slys/substack-gateway-oss)
at `bc2e875` and this Worker side by side against the same fake Substack,
replays one request matrix against both, and diffs the results.

| File                          | Role                                                                                                                                                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fakeSubstackServer.ts`       | `createFakeSubstack` route table (test/support) served over HTTP on `127.0.0.1:7000`, plus `/__control/mode` (answer every route 404/500) and `/__control/reset` (return and clear the recorded Substack calls)         |
| `matrix.ts`                   | `MATRIX`: every REST operation (51) and MCP tool (49), each as happy path, missing token, invalid token, Substack 404 and Substack 500, plus transport cases. `ALLOWED_DIFFS`: accepted differences, each with a reason |
| `run.ts`                      | Replays `MATRIX` against both gateways and diffs them                                                                                                                                                                   |
| `start.sh`                    | Starts the fake (:7000), upstream (`uv run python -m substack_gateway.main`, :5001) and the Worker (`wrangler dev`, :8787), then runs `run.ts`                                                                          |
| `Dockerfile`                  | Node 22, uv, Python 3.12, upstream at `bc2e875`, this repo. Its command is `start.sh`                                                                                                                                   |
| `worker.ts`, `wrangler.jsonc` | The private `substack-gateway-harness` Worker: `POST /run` execs `start.sh` in a Durable Object-managed container built from the same Dockerfile                                                                        |

Every gateway request carries a token for the publication URL
`http://127.0.0.1:7000/pub`, and both gateways use
`SUBSTACK_BASE_URL=http://127.0.0.1:7000`. Global API calls land on `/api/v1/*`
and publication calls on `/pub/api/v1/*`. No real Substack credentials are
involved anywhere.

## What is compared

For each case, on each side: the HTTP status, the `content-type` (lowercased),
the body as parsed JSON (an MCP SSE stream is reduced to its JSON-RPC message,
and tool-result text is parsed as JSON when it is JSON), and the list of calls
the gateway made to the fake Substack (method, path, sorted query, JSON body).
Object key order is ignored; array order is not, except that the `tools/list`
result is sorted by tool name on both sides (upstream's tool order follows
`importlib.metadata.entry_points()`, i.e. the host filesystem's directory order). Other headers, including
`X-Request-ID`, are not compared.

The result is `{ total, mismatches, allowed, happyFailures }`.
`happyFailures` lists happy-path cases where either side failed, since a case
that fails the same way on both sides proves nothing. `run.ts` exits non-zero
if either list is non-empty.

## Running it

Locally with Docker (from the repository root):

```sh
docker build -f harness/Dockerfile -t substack-gateway-harness .
docker run --rm substack-gateway-harness
```

Without Docker (needs Node 22, uv, and `scripts/fetch-upstream.sh` run once):

```sh
harness/start.sh
```

Against servers you already started, or for one case at a time:

```sh
node harness/run.ts --only 'get_note' --show   # print both raw observations
node harness/run.ts --only '^REST '            # diff a subset
```

`start.sh` runs `wrangler dev` hermetically: it passes an empty `--env-file`, so a
repo-root `.dev.vars` (which may hold your owner cookies) is never loaded, and
sets `CLOUDFLARE_INCLUDE_PROCESS_ENV=false` so shell variables stay out too.

On Cloudflare (optional; deploying it requires your own Cloudflare account):

```sh
npx wrangler secret put HARNESS_TOKEN -c harness/wrangler.jsonc
npx wrangler deploy -c harness/wrangler.jsonc
curl -X POST -H "Authorization: Bearer $HARNESS_TOKEN" https://substack-gateway-harness.<subdomain>.workers.dev/run
```

`test/harness/matrix.test.ts` (part of `npm test`) checks that the matrix
still covers every operation and tool with all five variants.

Upstream substack-gateway-oss is MIT licensed, Copyright (c) 2025 Jakub Slys.
