# Deploy

Unofficial. Not affiliated with Substack. Read the Terms of Service risk and trust
model sections of the [README](../README.md) first.

## Deploy button

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/iamfiscus/substack-gateway-worker)

The button clones the repository into your account and prompts for the values
described under `cloudflare.bindings` in `package.json`. Leave them all blank for
pass-through mode. Fill in `GATEWAY_API_KEYS` and the `OWNER_*` values for owner
mode. You can also set or change them afterwards with `wrangler secret put`.

## By hand

```sh
npm install
npm run typecheck && npm test
npx wrangler deploy
```

The Worker is named `substack-gateway`; there are no crons and no required
bindings.

### Owner mode secrets

```sh
npx wrangler secret put GATEWAY_API_KEYS          # label:key or label:sha256:<hex>
npx wrangler secret put OWNER_PUBLICATION_URL     # https://yourpub.substack.com
npx wrangler secret put OWNER_SUBSTACK_SID
npx wrangler secret put OWNER_CONNECT_SID
```

Make a hashed key entry with `printf '%s' "$KEY" | shasum -a 256` and store
`ci:sha256:<hex>`. Do not use a raw key that itself starts with `sha256:`.

Optional var `OWNER_ALLOWED_FEATURES` (in `wrangler.jsonc` `vars`): a comma list of
`api:...` / `mcp:...` feature names usable with the owner's cookies. See
[Authentication](authentication.md).

### Local development

Copy `.dev.vars.example` to `.dev.vars` (never commit it), then `npm run dev`.

### Optional KV cache

See [Extensions](extensions.md#enabling-the-kv-binding).

## Check it

```sh
curl https://<worker>/api/v1/health/live
curl -H "Authorization: Bearer <key>" https://<worker>/api/v1/health/ready
```

`/api/docs` serves Swagger UI and `/api/openapi.json` the OpenAPI document.
