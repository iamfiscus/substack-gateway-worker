<!--
MIT License. Copyright (c) 2025 Jakub Slys.
Adapted from https://github.com/jakub-k-slys/substack-gateway-oss at commit bc2e875
(docs/authentication.md) for the Cloudflare Worker port. CHANGED from upstream: the
gateway-key and owner-mode sections are new; the credential shape, encoding and
REST/MCP token rules are adapted. See ../LICENSE and ../NOTICE.md.
Unofficial. Not affiliated with Substack.
-->

Credit: adapted from jakub-k-slys/substack-gateway-oss @ bc2e875.

# Authentication

Gateway authentication and Substack authentication are separate. Substack
credentials are two session cookies plus the publication URL. They are full
account bearer credentials: anyone holding them can act as you on Substack.

The Worker has two modes.

## Pass-through mode (default, upstream behaviour)

No secrets are set. Each request carries its own Substack credentials, as a
base64-encoded JSON object.

- REST: send it as the `x-gateway-token` header. Every route under `/api/v1`
  requires it **except** `GET /api/v1/health/live`, including read-only routes
  such as `GET /api/v1/profiles/{slug}`. A missing header returns `422`; a
  malformed one returns `401`.
- MCP: pass the same value as the optional `token` argument. The three
  `profiles` tools take no token. With no token and no resolver, the call fails
  with `MissingCredentialsError`.

If `GATEWAY_API_KEYS` is unset the Worker is open to anyone who can reach it,
as upstream's public deployment is.

**Trust model:** the Worker decodes every caller's cookies in memory to call
Substack. The operator of the Worker can see them. Only send your cookies to a
Worker you run yourself.

## Owner mode

Turned on by Worker secrets. Callers authenticate with a gateway key; the Worker
supplies the owner's Substack cookies.

| Name                                                               | Kind    | Purpose                                                                                                                                              |
| ------------------------------------------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GATEWAY_API_KEYS`                                                 | secret  | Comma list of `label:key` or `label:sha256:<hex>`. The label appears in logs.                                                                        |
| `OWNER_PUBLICATION_URL`, `OWNER_SUBSTACK_SID`, `OWNER_CONNECT_SID` | secrets | The owner's credentials, returned by the built-in resolver. `OWNER_CONNECT_SID` is optional; without it the cookie header is `substack.sid=…` alone. |
| `OWNER_ALLOWED_FEATURES`                                           | var     | Optional comma list of feature names usable with **resolved** credentials. Unset means the default list below.                                       |

Rules:

- With keys set, every route except `GET /api/v1/health/live` and `GET /`
  requires `Authorization: Bearer <key>`; otherwise `401`. `/mcp` is gated the
  same way.
- A request with a valid key and no `x-gateway-token` (REST) or `token` (MCP)
  uses the owner's cookies.
- A request with a valid key and an explicit token uses the token. The key is
  still required, and the feature gate does not apply to the token.
- Resolved credentials are never echoed: `GET /api/v1/health/ready?show=true`
  returns `403`. They are never logged.
- A feature outside the allow-list returns
  `403 {"detail":"feature <name> disabled for owner credentials"}` on REST and a
  tool error on MCP.
- Hashed keys: `label:sha256:<hex>` stores only the SHA-256 of the key.
  A raw key that literally starts with `sha256:` is therefore read as a hash
  entry (and rejected if it is not 64 hex characters). Pick keys that do not
  start with `sha256:`.

Default `OWNER_ALLOWED_FEATURES`: every read (`*:get`, `*:list`, all stats) and
the safe draft writes (`drafts:create`, `drafts:update`, `drafts:prepublish`,
`drafts:ai-detection`), each as `api:` and `mcp:` names, plus these exact names:
`api:health:ready` (REST only; there is no MCP readiness tool),
`api:images:create` and `mcp:images:upload`. Notes creation, replies, comments,
likes, deletes, scheduling and restacking are off unless you list them. The full
default list is in `src/auth/features.ts`.

`OWNER_ALLOWED_FEATURES` takes one of two forms:

- **Additive.** Every entry starts with `+`, and each is added to the default
  list. `+api:notes:create,+mcp:notes:create` keeps all the defaults and also
  lets the owner's cookies create notes over REST and MCP.
- **Replacing.** No entry starts with `+`. The list replaces the default
  entirely, so spell out everything you want, reads included.

Mixing the forms (`+api:notes:create,api:notes:get`) is a configuration error:
every route except the public ones answers `500 {"detail":"gateway misconfigured"}`
and the value is never echoed. A blank value means the default list.

## Credential shape

```json
{
  "publication_url": "https://example.substack.com",
  "substack_sid": "s%3A...",
  "connect_sid": "s%3A..."
}
```

The Substack request carries exactly `Cookie: substack.sid=<substack_sid>; connect.sid=<connect_sid>`.

## Encode credentials

```bash
echo '{"publication_url":"https://example.substack.com","substack_sid":"s%3A...","connect_sid":"s%3A..."}' | base64
```

Tokens made with a shell `base64` carry a trailing newline or wrapped lines; the
decoder accepts both, and UTF-8 content.

```text
x-gateway-token: <base64-encoded-json>
```

## REST example

```bash
curl -H "x-gateway-token: <base64-encoded-json>" https://<your-worker>/api/v1/me
# owner mode:
curl -H "Authorization: Bearer <gateway-key>" https://<your-worker>/api/v1/me
```

## MCP example

```json
{ "token": "<base64-encoded-json>" }
```

## Security notes

- Do not commit real cookies, publication URLs, or secrets.
- Treat `substack_sid` and `connect_sid` as bearer credentials.
- A 403 from Substack can be a bot-challenge page rather than an auth failure.
  The Worker maps it to a `403`; check that your cookies work in a browser
  before assuming they expired.
- Tool arguments can end up in agent transcripts; prefer owner mode over passing
  `token` from an MCP client.
- Use `wrangler secret put` for secrets; they cannot be read back.
