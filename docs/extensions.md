# Extensions

Adapted from the `GatewayExtension` interface in upstream
([substack-gateway-oss](https://github.com/jakub-k-slys/substack-gateway-oss) at
`bc2e875`, MIT, Copyright (c) 2025 Jakub Slys). The Worker version is new text.
Unofficial. Not affiliated with Substack.

Extensions are listed statically in your entry file. A bundled Worker has no
entry points or env-var module lists, and no lifespan hooks.

In `src/index.ts`, replace the default export:

```ts
export default createGateway({
  extensions: [
    kvValueCache('GATEWAY_CACHE', 300),
    kvStatsCache('GATEWAY_CACHE'),
    pacedFetcher({ minIntervalMs: 250, retry429: 2 }),
  ],
});
```

The same file exports `createGateway`, `createApp`, `composeExtensions`,
`kvValueCache`, `kvStatsCache`, `pacedFetcher`, `GatewayExtension` and
`GatewayContext`.

## The interface

| Field                      | Purpose                                                     |
| -------------------------- | ----------------------------------------------------------- |
| `name`                     | Required.                                                   |
| `moduleInfo`               | Added to the `/` root endpoint.                             |
| `registerApi(api, ctx)`    | Add REST routes to the `/api` OpenAPI app.                  |
| `registerApp(app, ctx)`    | Add routes or middleware to the root Hono app.              |
| `registerMcp(server, ctx)` | Add MCP tools; runs inside the per-request factory.         |
| `authenticate(req, env)`   | Replace the gateway-key check. Return `AuthInfo` or `null`. |
| `credentialResolver`       | Map an authenticated caller to Substack credentials.        |
| `fetcher`                  | Wrap outbound calls (pacing, retry, tracing).               |
| `valueCache`, `statsCache` | Caches. May be a value or `(env) => value`.                 |

Each of `authenticate`, `credentialResolver`, `fetcher`, `valueCache`,
`statsCache` is a single provider: two extensions offering the same one throw at
startup. A fetcher must hand the original `Request` to the network unchanged,
because the client sets `redirect: 'manual'` and an abort signal; redirects are
never followed so cookies are never sent to another host.

## `authenticate` replaces the gateway-key check

Read this before using it. An `authenticate` extension **replaces** the built-in
`GATEWAY_API_KEYS` check. It does not run alongside it. Consequences:

- `GATEWAY_API_KEYS` is ignored for authentication.
- Every caller your function authenticates is handed the **owner's resolved
  cookies** (if `OWNER_*` or a resolver is configured), subject to
  `OWNER_ALLOWED_FEATURES`. Authenticating loosely is handing out your account.
- Token-only pass-through for strangers then needs your function to allow it
  (return an `AuthInfo` for them). Returning `null` gives them `401` even though
  they brought their own `x-gateway-token`.
- If `authenticate` throws, the request fails with the generic misconfigured error.
- Owner mode needs `GATEWAY_API_KEYS` set (plus the three `OWNER_*` secrets), even
  though the key check is replaced. With an `authenticate` extension and
  `GATEWAY_API_KEYS` unset, owner mode is off, so an extension that needs it
  (such as `kvStatsCache`) fails every request. Set `GATEWAY_API_KEYS` to any
  valid entry to keep owner mode on.

## `ADMIN_TOKEN`

`ADMIN_TOKEN` is a reserved secret name. The core Worker never reads it. It exists
so an extension can protect its own admin routes (registered with `registerApp`)
without inventing a new binding. If you add no such extension, leave it unset.

## Caches

- `kvValueCache(binding, ttlSec)`: caches public profile lookups, coalescing
  concurrent calls per isolate; KV adds cross-isolate reuse. TTL below 60 s is
  raised to KV's minimum of 60.
- `kvStatsCache(binding)`: caches stats timeseries and snapshots (5-minute TTL for
  snapshots). Rules:
  - **Owner mode only.** Upstream keys its stats cache by publication URL alone,
    so serving it to a caller who merely names that URL would leak one tenant's
    stats to another. The cache is only given to requests whose credentials were
    resolved from the owner secrets; requests with an explicit token bypass it.
  - Without owner mode, `createGateway` throws if you pass `env`. Otherwise
    (a Worker's env exists only per request) **every request fails** with
    `kvStatsCache requires owner mode (GATEWAY_API_KEYS and OWNER_*)`.
  - The timeseries upsert is read-merge-write and **not atomic**: concurrent writers
    race and the last writer wins. Fine for one owner; do not rely on it for exact
    history.

### Enabling the KV binding

The binding is commented out in `wrangler.jsonc`. Create a namespace, then
uncomment and set the id:

```sh
npx wrangler kv namespace create GATEWAY_CACHE
```

```jsonc
"kv_namespaces": [{ "binding": "GATEWAY_CACHE", "id": "<kv-namespace-id>" }]
```

Without the binding the caches silently do nothing (reads miss, writes are skipped).

## `pacedFetcher({ minIntervalMs, retry429, backoffMs? })`

Port of upstream's e2e `_PacedTransport`. It spaces request starts at least
`minIntervalMs` apart (per isolate) and retries a `429` up to `retry429` times.

- Only `GET`, `HEAD` and `OPTIONS` are retried; writes are never retried.
- A numeric `Retry-After` (whole seconds) is honoured and **not capped**. A
  hostile or buggy value can hold the request for that long, so keep
  `retry429` small and watch Worker wall-time.
- Otherwise the wait is `backoffMs * 2^attempt`; `backoffMs` defaults to 1000 ms.
- Pacing keeps the Worker alive while it sleeps; it spaces calls within one
  isolate only.

## Dropped from upstream

`get_lifespan_hooks` (Workers have no lifespan), httpx pool settings, and loading
extensions from an environment variable or entry points.
