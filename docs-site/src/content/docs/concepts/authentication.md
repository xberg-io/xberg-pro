---
title: Authentication
description: How API keys authenticate requests to Xberg Pro and Enterprise, including scopes, project scoping and failure modes.
sidebar:
  order: 3
---

Every request to the Xberg API carries an API key as a bearer token. Create live keys in the console under **API keys**; they start with `kz_`. Pro and Enterprise issue the same key format with the same `read` and `write` scopes.

A live key is 32 characters (`kz_` plus 29 Base62 characters) and belongs to a single project. The console shows the plaintext once, at creation, so store it somewhere safe. Keys support an optional expiry, and a key is refused after its expiry time.

## Key scopes

Each key has a scope that you choose at creation and see in the key list.

| Scope   | Allowed requests                                                        |
| ------- | ----------------------------------------------------------------------- |
| `write` | Every request. This is the default.                                     |
| `read`  | `GET`, `HEAD`, `OPTIONS` and `TRACE` only. Any other method gets `403`. |

Give a reporting integration a `read` key, so a leaked credential cannot submit jobs, change webhooks or create keys. The scope is fixed for the life of a key. To change it, create a new key and revoke the old one.

The rule follows the HTTP method, not the endpoint. A few endpoints read data but use `POST`, such as `POST /v1/rag/collections/{name}/retrieve`. A `read` key cannot call them, so use a `write` key for an integration that needs them.

A refused request is recorded in the project's audit log with the key as the actor. The log keeps one row per key per reason per five minutes, so a client that retries with a refused key does not flood it.

## Use the key

Keep the key out of source and read it from the environment.

```bash
export XBERG_API_KEY="kz_..."
```

`https://xberg.example.com` below is a placeholder for your deployment's base URL.

```bash title="curl"
curl -H "Authorization: Bearer $XBERG_API_KEY" \
  https://xberg.example.com/v1/extract \
  -F file=@invoice.pdf \
  -F 'webhook={"url":"https://example.com/webhooks/xberg"}'
```

The SDKs also need your deployment's base URL. See [SDKs](/start/sdks/) for the exact constructor options.

```python title="Python"
import os
from xberg_io_sdk import XbergClient

with XbergClient(
    api_key=os.environ["XBERG_API_KEY"],
    base_url="https://xberg.example.com",
) as client:
    ...
```

```ts title="TypeScript"
import { XbergClient } from "@xberg-io/sdk";

const client = new XbergClient({
  apiKey: process.env.XBERG_API_KEY!,
  baseUrl: "https://xberg.example.com",
});
```

See the [SDK documentation](https://docs.sdks.xberg.io) for the full client API and [SDKs](/start/sdks/) for setup. Manage keys in [Projects and API keys](/guides/projects-and-api-keys/).

## How it works

- The server hashes the bearer token with SHA-256 and compares it with the stored key hash.
- Enterprise caches validation for fast reads on the hot path. Pro validates against PostgreSQL directly.
- Each authenticated request resolves to a project. PostgreSQL row-level security then restricts every query to that project, so a key cannot read another project's data.

## Sign-in for people

API keys authenticate programs. People sign in to the web console through any OIDC provider, with optional email-domain allowlisting. An API key cannot create a browser session. Enterprise adds SAML 2.0 and SCIM provisioning. See [SAML single sign-on](/guides/saml-sso/).

## Failure modes

- `401 Unauthorized`: the bearer token is missing, malformed or matches no active key.
- `403 Forbidden`: the key is valid, but the project does not own the requested resource, or a `read` key attempted a write.
- `429 Too Many Requests`: the caller exceeded a rate limit, a project exhausted its monthly quota, or a RAG collection reached its document quota on ingest.

On Pro, a project's monthly job and page quotas also produce `429` with error code `quota_exceeded`. The response carries `Retry-After` with the seconds until the next UTC calendar month. A quota is unlimited when unset.
