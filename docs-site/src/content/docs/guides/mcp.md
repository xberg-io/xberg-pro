---
title: Private MCP listener
description: Let a local MCP client list collections, read documents, retrieve passages or run extractions through a private listener that has no public route.
sidebar:
  order: 10
---

**Available in:** Pro, Enterprise

The private MCP listener gives a Model Context Protocol client access to a project's RAG collections or to inline extraction, using the project API key. The listener is off by default, binds to loopback when you enable it, and is never reachable through the public REST API or the default ingress. The service answers `server/discover` and `tools/list` for MCP version 2026-07-28.

## Modes

One listener serves one mode. Pick the mode with `mcp.mode` in the chart values. On Pro, `mcp.mode` requires chart 0.7.5 or later, and chart 0.7.4 serves `rag` mode only.

| Mode            | Tools                                                                        | Deployment it needs                                                                                                                                                                               |
| --------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rag` (default) | `list_collections`, `list_documents`, `retrieve`                             | The standard data policy and RAG enabled. Pro runs as a singleton with its in-process RAG. Enterprise runs the API and the RAG worker.                                                            |
| `extraction`    | `extract_document`, `get_extraction_job_status`, `get_extraction_job_result` | A replicated, extraction-only deployment. Pro needs S3 or Azure Blob storage with versioning, and Pro chart 0.7.5 or later. Enterprise needs its protected extraction runtime and result storage. |

The two modes need different deployment shapes. The chart refuses `rag` mode on a replicated deployment and `extraction` mode on a singleton, and names the missing condition. Protected RAG collections require a separate authorization path and are not served by this listener.

## Enable the listener

The listener needs a cursor signing key: a secret that holds 32 random bytes as unpadded base64url. Use the same key on every replica behind one listener. Create it in the release namespace:

```shell
kubectl -n REPLACE_WITH_NAMESPACE create secret generic existing-mcp-secret \
  --from-literal=cursor-signing-key="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')"
```

### RAG mode on Pro

Set the listener and, for the first rollout, the disclosure grants:

```yaml
mcp:
  enabled: true
  mode: rag
  port: 8095
  cursorSigningKeySecret:
    name: existing-mcp-secret
    key: cursor-signing-key
migrations:
  mcpRagReleaseExecute: true
```

On chart 0.7.4, omit `mode`. Pro must run as a singleton with `dataPolicy: standard` and `PRO_RAG_ENABLED` left at its default of `true`. See [RAG](/guides/rag/).

### RAG mode on Enterprise

Enterprise adds the RAG retrieve call between the API and the RAG worker:

```yaml
mcp:
  enabled: true
  mode: rag
  port: 8095
  cursorSigningKeySecret:
    name: existing-mcp-secret
    key: cursor-signing-key
rag:
  enabled: true
  mcpRetrieveRpcEnabled: true
migrations:
  mcpRagReleaseExecute: true
```

The API and RAG worker must be enabled, and `dataPolicy` must be `standard`.

### Disclosure grants

`migrations.mcpRagReleaseExecute: true` lets the regular maintenance Job grant the application database role the exact routines the listener needs to disclose data. The default `false` revokes them, so a maintenance run with the default removes the grants and the listener stops serving. The chart requires enabled maintenance migrations, and refuses the value during a contract rollback. If you manage the database outside Helm, run the operator maintenance grant phase with `MCP_RAG_RELEASE_EXECUTE=true` instead. While the grants are missing, the service keeps serving REST, the listener waits, and data calls fail closed.

### Extraction mode

Extraction mode applies to a registered replicated generation with `dataPolicy: extraction_only`. On Pro it requires Pro chart 0.7.5 or later, because chart 0.7.4 has no `mcp.mode` value. Set `mcp.mode: extraction` and `mcp.enabled: true` with the same port and Secret reference, and keep RAG and its RPC disabled. Record the settings in the new generation's configuration before you register it. See the [deployment operator](/operate/deployment-operator/).

On Pro, also set:

```yaml
configMap:
  STORAGE_PROVIDER: s3
  PRO_RESULT_ACCESS_POLICY_EPOCH: "1"
  PRO_RESULT_ACCESS_LIFETIME_SECS: "86400"
```

`STORAGE_PROVIDER` must be `s3` or `azure`, with bucket or container versioning enabled. The epoch is a positive integer, and the lifetime is between 1 and 315,360,000 seconds. See [Result access lifetime](/operate/result-access-lifetime/). Enterprise needs its protected extraction runtime and accessible result storage.

### Chart checks

The chart fails the render when:

- `mcp.cursorSigningKeySecret.name` or `.key` is empty while the listener is enabled.
- `mcp.port` equals another port of the release, such as the API port or `PRO_BIND_ADDR`.
- `MCP_LISTENER_*`, `MCP_ALLOWED_*` or `MCP_CURSOR_SIGNING_KEY` appear in `configMap` (Pro) or `api.env` and `api.extraEnv` (Enterprise). The `mcp` values own them.

## Security posture

- **Private by default.** `mcp.enabled` is `false`. The chart adds no Service, ingress or route for the listener.
- **Loopback only.** The chart binds `127.0.0.1:<port>` inside the Pod and accepts only the `127.0.0.1:<port>` and `localhost:<port>` host authorities. Clients that send an `Origin` header are refused, because the chart sets no allowed origins.
- **Project API keys.** Each request carries an `Authorization: Bearer` project API key. Each tool uses the matching REST permission of that key, and the endpoint refuses project selectors in headers and query parameters.
- **Fail closed.** The listener rechecks the project's policy epoch, admission and permissions before it sends data. A revoked permission, a retired generation or an expired result returns an error instead of data.
- **Signed continuations.** Paging tokens are bound to the project and its policy epoch, so rotating the signing key or requalifying the project invalidates open continuations.

The chart manages the listener's environment variables, so Helm installs set only the `mcp` values. If you run the services without the chart, set these on each process that serves MCP:

| Variable                 | Value                                                                                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------------- |
| `MCP_LISTENER_ENABLED`   | `true` enables the listener.                                                                              |
| `MCP_LISTENER_MODE`      | `rag` or `extraction` (Pro: `extraction` needs chart 0.7.5 or later).                                     |
| `MCP_LISTENER_ADDR`      | A socket address with a fixed port, such as `127.0.0.1:8095`.                                             |
| `MCP_ALLOWED_HOSTS`      | Comma-separated host and port pairs the client may send, such as `127.0.0.1:8095`.                        |
| `MCP_ALLOWED_ORIGINS`    | Comma-separated HTTP or HTTPS origins with explicit ports. Leave unset for clients that send no `Origin`. |
| `MCP_CURSOR_SIGNING_KEY` | The signing key, 32 bytes as unpadded base64url.                                                          |

If you place your own TLS proxy in front, keep the backend listener private and add the authority the proxy forwards to `MCP_ALLOWED_HOSTS`.

## Connect a client

The listener is not exposed, so forward its port to an eligible Pod and keep the local and Pod ports equal:

```shell
kubectl -n REPLACE_WITH_NAMESPACE port-forward pod/REPLACE_WITH_POD_NAME 8095:8095
```

Point an MCP client that supports HTTP transport at `http://127.0.0.1:8095/mcp` and send the project API key as `Authorization: Bearer REPLACE_WITH_PROJECT_API_KEY`. The client then discovers the tools of the configured mode.

## Tools

### RAG mode

- `list_collections` returns qualified collection IDs and names, a count and an optional continuation. The offset limit is 1,000,000, as in REST.
- `list_documents` takes a collection name, an optional limit and an optional continuation, and returns live document summaries in ascending document ID order. It uses the same summary fields as REST.
- `retrieve` runs a RAG retrieval against a collection with the key's read permission.

A document summary may hold up to 4,096 UTF-8 bytes across external ID, title and MIME type. If one item exceeds that limit, or the encoded page exceeds the response budget, the tool returns `rag.document_page_too_large` with no rows and no continuation. A smaller `limit` can resolve a page-size error, but the per-summary limit still applies to a single document.

### Extraction mode

Submit one bounded, base64-encoded inline document with `extract_document`. Poll `get_extraction_job_status` with the returned job ID, then read the bounded inline result with `get_extraction_job_result`. A result past its retention window returns the applicable expiry error.
