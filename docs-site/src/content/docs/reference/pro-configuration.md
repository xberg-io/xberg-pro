---
title: Xberg Pro configuration
description: Environment variable reference for the Xberg Pro container, grouped by task, with code and Helm chart defaults.
sidebar:
  order: 2
---

**Available in:** Pro

Pro reads its configuration from environment variables at startup, plus an optional TOML file for the auto-tune search space. Set variables on the container (`docker run -e`, Compose `environment`) or in the Helm chart's `configMap` and `secrets` values. See [Run Pro with Docker](/start/pro-docker/) and [Install Pro with Helm](/start/pro-helm/).

A malformed or out-of-range value stops startup and names the variable. Pro never falls back silently to a default.

**Default column.** One value means the code default and the chart default agree. Where the Helm chart sets a different value, the cell reads `code / chart`.

| Task                                          | Section                                                                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Start Pro for the first time                  | [Required](#required), [Storage](#storage)                                                                                                  |
| Sign users in and protect the API             | [Authentication](#authentication)                                                                                                           |
| Connect source systems                        | [Integration hub](#integration-hub), [Integration sync](#integration-sync)                                                                  |
| Size and tune the instance                    | [Tuning](#tuning), [Caching](#caching), [Database connections](#database-connections)                                                       |
| Allow long extractions                        | [Timeouts and shutdown](#timeouts-and-shutdown), [Long extractions](#long-extractions)                                                      |
| Use models for RAG, OCR and structured output | [RAG runtime](#rag-runtime), [Structured extraction](#structured-extraction), [Extraction models and limits](#extraction-models-and-limits) |
| Serve a private MCP endpoint                  | [Private MCP listener](#private-mcp-listener)                                                                                               |
| Monitor and log                               | [OTLP export](#otlp-trace-log-and-metric-export), [Logging](#logging)                                                                       |

## Required

| Variable                   | Default     | Description                                                                                                                               |
| -------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`             | none        | PostgreSQL URL of the application login, which must be a member of `xberg_application`. Example: `postgresql://app:pass@host:5432/xberg`. |
| `MAINTENANCE_DATABASE_URL` | none        | PostgreSQL URL of a separate login that is a member of `xberg_maintenance`. Pro uses it for retention and cleanup.                        |
| `XBERG_LICENSE_KEY`        | none        | Signed license token. Pro refuses to start without a valid one. See [Licensing](/reference/licensing/).                                   |
| `STORAGE_PROVIDER`         | none / `fs` | Object storage backend: `s3`, `gcs`, `azure` or `fs`. See [Storage](#storage).                                                            |
| `STORAGE_BUCKET`           | none        | Bucket or container name. Ignored for `fs`.                                                                                               |

Use different logins for the two database URLs. Do not use the role administrator or a superuser for either. Pro validates both identities at startup and refuses to start when a membership is missing, crossed or unsafe.

### Database roles and upgrades

Pro supports PostgreSQL 15 to 18. A bring-your-own server needs four roles:

- **Application login** (`DATABASE_URL`): a member of `xberg_application`. Membership selects the row-level security policies. It grants no table privileges, which the bootstrap sets directly.
- **Maintenance login** (`MAINTENANCE_DATABASE_URL`): an unprivileged login that is a member of `xberg_maintenance`.
- **Schema owner**: applies extensions and the schema. The bootstrap transfers schema ownership to the fixed `xberg_schema_owner` role.
- **Role administrator**: creates the fixed `NOLOGIN` capability roles and grants each runtime login its membership. Never give this credential to the Pro process.

The Helm chart runs this bootstrap as ordered hooks when `migrations.enabled=true`. Supply the role administrator, schema owner and maintenance credentials as separate Secrets: `migrations.roleAdminDatabaseUrlSecret`, `migrations.databaseUrlSecret` and `maintenance.databaseUrlSecret`. If you run migrations outside the chart, keep the same order: role provisioning, then extensions and schema, then grants. Back up the database before every upgrade. See [Backup and restore](/operate/backup-and-restore/) and [Upgrades](/operate/upgrades/).

A change to the policy roles rolls out in two releases. Deploy the first, replace every old Pro pod, then deploy the second.

To downgrade across the schema-owner boundary, stop every database writer. Then run the current chart once with `migrations.contractRollback=true` and `migrations.schemaOwnershipRollback=true`, and only then select the older chart. A failed rollback leaves Pro stopped until the same operation succeeds. `helm rollback` alone cannot do this, because it renders hooks from the older chart.

To rotate the maintenance login, create a new `LOGIN INHERIT` role without superuser or `BYPASSRLS`, grant it membership in `xberg_maintenance`, publish its URL and restart Pro. On Helm, also bump `maintenance.credentialRevision`. When the new instance is healthy and the old login has no sessions, drop the old login.

## Storage

Pick a provider with `STORAGE_PROVIDER`, then set the provider's credentials. See [Storage](/operate/storage/) for sizing and layout.

| Variable                     | Default | Description                                                                                                                                                                            |
| ---------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STORAGE_ROOT`               | none    | Path prefix inside the bucket. For `fs`, it replaces `STORAGE_FS_ROOT` instead of nesting under it.                                                                                    |
| `STORAGE_REGION`             | none    | Cloud region, where the provider needs one.                                                                                                                                            |
| `STORAGE_PRESIGN_TTL_SECS`   | 3600    | Lifetime of presigned URLs in seconds.                                                                                                                                                 |
| `STORAGE_ENDPOINT_ALLOWLIST` | none    | Comma-separated host names. Required when you set `GCS_ENDPOINT`, `S3_ENDPOINT` or `AZURE_ENDPOINT`.                                                                                   |
| `PRO_PUBLIC_API_URL`         | none    | Externally reachable origin of the API, such as `https://api.example.com`. Required for `/v1/uploads/presign` on `fs` storage. Credentials, paths, queries and fragments are rejected. |

With `fs` storage, Pro builds upload URLs from `PRO_PUBLIC_API_URL` and never from the request host or forwarded headers. Cloud providers use their own signed upload URLs. An upload URL expires and accepts one `PUT`. Confirming an upload snapshots the bytes before jobs are created, so changing the staged object afterwards cannot alter an accepted job. Retrying a confirmation returns the same job IDs. A concurrent confirmation can return `409` while the first is still running.

### Storage provider-specific

Set only the group that matches `STORAGE_PROVIDER`.

#### Filesystem

| Variable          | Default       | Description                                            |
| ----------------- | ------------- | ------------------------------------------------------ |
| `STORAGE_FS_ROOT` | `/data/xberg` | Root directory for local storage. Mount a volume here. |

#### GCS

| Variable         | Default | Description                                                                                                                     |
| ---------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `GCS_CREDENTIAL` | empty   | Service account JSON (base64) or a key file path. Empty uses Application Default Credentials, such as Workload Identity on GKE. |
| `GCS_ENDPOINT`   | none    | Endpoint override for an emulator or proxy. It disables request signing and presigned URLs. Do not set it to an empty string.   |

#### S3

| Variable               | Default | Description                                                                              |
| ---------------------- | ------- | ---------------------------------------------------------------------------------------- |
| `S3_ACCESS_KEY_ID`     | none    | Access key. Required.                                                                    |
| `S3_SECRET_ACCESS_KEY` | none    | Secret key. Required.                                                                    |
| `S3_ENDPOINT`          | none    | Endpoint for an S3-compatible server such as RustFS or MinIO. Leave it unset for AWS S3. |
| `S3_PATH_STYLE`        | `false` | Use path-style addressing. Set it to `true` for most self-hosted S3-compatible servers.  |

#### Azure Blob Storage

| Variable                   | Default | Description                                              |
| -------------------------- | ------- | -------------------------------------------------------- |
| `AZURE_STORAGE_ACCOUNT`    | none    | Storage account name.                                    |
| `AZURE_STORAGE_ACCESS_KEY` | none    | Storage account access key.                              |
| `AZURE_ENDPOINT`           | none    | Endpoint override, for example for the Azurite emulator. |

## Authentication

See [Authentication](/concepts/authentication/) for how API keys, the bootstrap admin key and web console sign-in fit together.

| Variable                | Default    | Description                                                                                                                                                                               |
| ----------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `XBERG_ADMIN_KEY`       | none       | Bearer token for control-plane requests such as preset management and the audit log. Without it, control endpoints return `401`. Use the `kz_` prefix.                                    |
| `PRO_AUTH_MODE`         | `required` | `required` enforces API keys and, when configured, OIDC sign-in. `disabled` serves one unauthenticated local workspace. Use `disabled` only for evaluation and restrict network access.   |
| `SESSION_COOKIE_SECURE` | `true`     | Send the web console session cookie over HTTPS only. Set `false` only for a plain-HTTP evaluation. Pro logs a warning while it is off.                                                    |
| `PRO_RAG_ENABLED`       | `true`     | Start the RAG runtime at boot. `false` makes every `/v1/rag/*` request return `404` with `rag.disabled`. A valid license grants RAG, so this saves startup cost and does not gate access. |
| `PRO_AUTO_TUNE_ENABLED` | `true`     | Start the auto-tune runtime at boot. `false` makes `/v1/auto-tune` and `/v1/tuning-profiles` return `404` with `auto_tune.disabled`.                                                      |

<a id="dashboard-sign-in-with-oidc"></a>

### Web console sign-in with OIDC

The bootstrap API key authenticates REST requests. Human web console access needs an identity provider. An API-only install says so on its sign-in page.

| Variable                    | Default | Description                                                                                                                                                            |
| --------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OIDC_ISSUER_URL`           | none    | Issuer URL. Set it together with `OIDC_AUDIENCE` and `JWT_SECRET`. Setting only one of issuer and audience stops startup.                                              |
| `OIDC_AUDIENCE`             | none    | Expected audience or client ID.                                                                                                                                        |
| `OIDC_JWKS_URI`             | none    | Explicit JWKS URI. Skips OIDC discovery.                                                                                                                               |
| `JWT_SECRET`                | none    | Secret of at least 32 characters that signs session tokens. Required once OIDC sign-in is on.                                                                          |
| `JWT_EXPIRATION_SECS`       | 604800  | Session lifetime in seconds (7 days).                                                                                                                                  |
| `PRO_ALLOWED_EMAILS`        | empty   | Comma-separated addresses allowed to sign in.                                                                                                                          |
| `PRO_ALLOWED_EMAIL_DOMAINS` | empty   | Comma-separated email domains allowed to sign in.                                                                                                                      |
| `PRO_ADMIN_EMAILS`          | empty   | Comma-separated instance admins. No first sign-in becomes admin. With this empty, only `XBERG_ADMIN_KEY` reaches the control plane, and Pro logs a warning at startup. |
| `OIDC_HTTP_TIMEOUT_SECS`    | 5       | Timeout for each discovery and JWKS request, 1 to 120. Raise it for a slow identity provider or egress proxy.                                                          |

Register a public OIDC client with the authorization-code flow and PKCE at your identity provider. Register the web console's exact `/auth/callback` URL as an allowed redirect. The issuer must be reachable from both the browser and Pro, and must allow the web console origin.

With Docker Compose, save this override as `compose.oidc.yml`. Replace the example addresses and client ID, and use the service name from your Compose file in place of `pro`:

```yaml
services:
  pro:
    environment:
      OIDC_ISSUER_URL: https://identity.example.com
      OIDC_AUDIENCE: xberg-dashboard
      JWT_SECRET: ${JWT_SECRET:?Set a session signing secret of at least 32 characters}
      NEXT_PUBLIC_OIDC_ISSUER_URL: https://identity.example.com
      NEXT_PUBLIC_OIDC_CLIENT_ID: xberg-dashboard
      NEXT_PUBLIC_OIDC_REDIRECT_URI: https://app.example.com/auth/callback
      PRO_ALLOWED_EMAILS: alice@example.com,bob@example.com
```

Apply it with your normal Compose file:

```bash
docker compose -f compose.yml -f compose.oidc.yml up -d
```

The three `NEXT_PUBLIC_OIDC_*` values are public client settings that the browser reads from `/runtime-env.js`. The signing secret and admin key stay on the server.

## Integration hub

Source connectors and their OAuth flows. See [Source connectors](/guides/source-connectors/).

| Variable                   | Default                         | Description                                                                                                                                                                                |
| -------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `INTEGRATION_KEK`          | empty                           | Base64 key of 32 bytes that encrypts stored credentials (AES-256-GCM). Set it together with `INTEGRATION_STATE_SECRET`. With both unset, the hub is off and its OAuth routes return `503`. |
| `INTEGRATION_STATE_SECRET` | empty                           | Base64 key of 32 bytes that signs OAuth state tokens. Pro refuses to start when only one of the two keys is set or either is not 32 bytes of base64.                                       |
| `INTEGRATION_KEK_PREVIOUS` | empty                           | The outgoing key during a rotation. See [Rotating the integration KEK](#rotating-the-integration-kek).                                                                                     |
| `OAUTH_CALLBACK_BASE_URL`  | `http://localhost:8080` / empty | Public base URL for OAuth redirects, such as `https://api.example.com`. The callback is `/v1/oauth/callback` under it. Register that exact URL at the provider.                            |
| `FRONTEND_BASE_URL`        | `http://localhost:3000`         | Web console URL that users return to after OAuth.                                                                                                                                          |

### Integration sync

Scheduled source-connector sync is off by default. Each integration also needs an explicit opt-in through the API. Replicated deployments do not support it.

| Variable                             | Default | Description                                                                                                  |
| ------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------ |
| `PRO_INTEGRATION_SYNC_ENABLED`       | `false` | Run the sync scheduler. Requires `PRO_INTEGRATION_SYNC_CURSOR_KEY`.                                          |
| `PRO_INTEGRATION_SYNC_CURSOR_KEY`    | none    | Stable base64 key of 32 bytes that protects sync cursors. Keep it in a Secret, not a ConfigMap.              |
| `PRO_INTEGRATION_SYNC_INTERVAL_SECS` | 300     | Default gap between syncs of one integration, 60 to 2592000.                                                 |
| `PRO_INTEGRATION_SYNC_POLL_SECS`     | 5       | How often the scheduler looks for due work, 1 to 3600.                                                       |
| `PRO_INTEGRATION_SYNC_LEASE_SECS`    | 300     | Lease an instance holds while syncing one integration, 1 to 3600.                                            |
| `PRO_INTEGRATION_SYNC_CLAIM_LIMIT`   | 4       | Integrations claimed per poll, 1 to 1000.                                                                    |
| `PRO_INTEGRATION_SYNC_PAGE_LIMIT`    | 100     | Items fetched per provider page, 1 to 10000.                                                                 |
| `SFTP_HOST_ALLOWLIST`                | empty   | Comma-separated `host:port` destinations the SFTP connector may reach. Empty refuses every SFTP integration. |

### Rotating the integration KEK

`INTEGRATION_KEK` encrypts every stored OAuth token and client secret. Rotate it in three steps. Do not skip the check in step 3, because destroying the old key while a credential still needs it makes that credential unreadable.

1. Set `INTEGRATION_KEK` to the new key and `INTEGRATION_KEK_PREVIOUS` to the old one, then restart. Each stored credential names the key that wrapped it, so a read opens it with the previous key and writes it back under the new one.
2. Wait. A background sweep re-wraps every credential that no read has touched, in batches, every five minutes.
3. Watch `integration_kek_rewrap_complete`. It reads `1` only when no row is readable by the previous key alone. Then remove `INTEGRATION_KEK_PREVIOUS` and restart.

| Metric                                  | Meaning                                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `integration_kek_rows_on_previous_key`  | Rows the sweep has not migrated. This is the whole backlog, and it must reach zero.                                      |
| `integration_kek_rows_unreadable`       | Rows in the last batch that neither key opens. Retiring the previous key does not worsen them, but they stay unmigrated. |
| `integration_kek_rewrap_complete`       | `1` when `INTEGRATION_KEK_PREVIOUS` can be removed.                                                                      |
| `integration_kek_rewrap_failures_total` | Count of failing rows, labeled `reason` (`unreadable`, `write_conflict`).                                                |

The sweep logs one warning per stuck row while the backlog is above zero and counts failures by `reason` in `integration_kek_rewrap_failures_total`.

An `unreadable` row predates the previous key or names a key the deployment no longer holds. Re-enter its credentials, which stores a fresh key under the current one and clears the error on the next pass. A `write_conflict` row lost a race with a concurrent write and normally clears on the next pass. If a key rotation keeps reporting errors after that, contact support.

## Tuning

Defaults suit a small single node. Change these to size the instance, set listeners and limit abusive traffic.

### Listeners, concurrency and limits

| Variable                   | Default            | Description                                                                                                                                                                                                                                                          |
| -------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PRO_BIND_ADDR`            | `0.0.0.0:8080`     | HTTP listen address.                                                                                                                                                                                                                                                 |
| `PRO_METRICS_ADDR`         | `0.0.0.0:9090`     | Prometheus `/metrics` listen address.                                                                                                                                                                                                                                |
| `PRO_MAX_CONCURRENCY`      | `min(CPUs, 8)` / 4 | Documents extracted at once. `0` derives it from the CPU count, capped at 8. Each running document holds a slot, so long jobs queue the rest.                                                                                                                        |
| `PRO_ENGINE_MAX_THREADS`   | from CPU quota     | Extraction thread budget shared by all running documents. Pro derives it from the container CPU quota, or all logical CPUs when there is no quota. An explicit value must be at least 1. Memory grows with each thread, so raise the container memory limit with it. |
| `PRO_MAX_UPLOAD_BYTES`     | 104857600          | Largest document accepted, in bytes (100 MiB). A base64 JSON request carries roughly 75 MiB of raw document at this value.                                                                                                                                           |
| `PRO_RAW_BODY_LIMIT_BYTES` | derived            | Raw request body ceiling. Derived from `PRO_MAX_UPLOAD_BYTES` plus base64 overhead. Set it only to pin the limit. Pro rejects values far out of proportion to `PRO_MAX_UPLOAD_BYTES`.                                                                                |
| `MAINTENANCE_DB_POOL_SIZE` | 16                 | Connections in the maintenance pool. Must be above 0.                                                                                                                                                                                                                |
| `CORS_ALLOWED_ORIGINS`     | empty              | Comma-separated browser origins (`scheme://host[:port]`) allowed to call the API. Empty sends no CORS headers, which suits the bundled UI. `*` allows any origin and is for local development only.                                                                  |
| `PRO_TRUSTED_PROXY_CIDRS`  | empty              | Reverse-proxy CIDRs trusted to supply the client IP. The OAuth callback and the login rate limit use that IP. Set it together with `PRO_TRUSTED_PROXY_HOPS`.                                                                                                         |
| `PRO_TRUSTED_PROXY_HOPS`   | empty              | Number of trusted proxy hops, including the direct peer. At least 1.                                                                                                                                                                                                 |

### HTTP timeouts and rate limits

| Variable                             | Default | Description                                                                                                                                                                                                       |
| ------------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HTTP_REQUEST_TIMEOUT_SECS`          | 30      | Handler timeout, from the body being fully received to the response head. A slower handler gets `504` with `gateway_timeout`. `0` disables it. Maximum 86400. Upload time and streamed responses are not limited. |
| `HTTP_BODY_IDLE_TIMEOUT_SECS`        | 60      | Longest silence while a request body streams. A stalled upload gets `408` with `request_timeout`. An upload that keeps arriving is never cut off. `0` disables it. Maximum 86400.                                 |
| `RATE_LIMIT_BURST`                   | 300     | Requests one caller may send at once on authenticated routes. `0` disables the limit. A rejected request gets `429` with `Retry-After` and `x-ratelimit-*` headers.                                               |
| `RATE_LIMIT_PER_SECS`                | 60      | Seconds over which `RATE_LIMIT_BURST` refills evenly.                                                                                                                                                             |
| `LOGIN_RATE_LIMIT_BURST`             | 10      | Per-client-IP burst on `POST /auth/login`.                                                                                                                                                                        |
| `LOGIN_RATE_LIMIT_PER_SECS`          | 60      | Refill window for the login limit.                                                                                                                                                                                |
| `ACCOUNT_DELETE_RATE_LIMIT_BURST`    | 5       | Per-client-IP burst on `DELETE /auth/account`.                                                                                                                                                                    |
| `ACCOUNT_DELETE_RATE_LIMIT_PER_SECS` | 60      | Refill window for the account deletion limit.                                                                                                                                                                     |

### Webhooks and crawling

| Variable                        | Default | Description                                                                                                           |
| ------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------- |
| `PRO_WEBHOOK_MAX_RETRIES`       | 5       | Delivery attempts, 1 to 10. The first attempt is immediate. The retries wait 5 s, 30 s, 5 min and 5 min, plus jitter. |
| `PRO_WEBHOOK_HTTP_TIMEOUT_SECS` | 30      | Timeout for one webhook or callback request, 1 to 300. Raise it for a slow receiver.                                  |
| `CRAWL_WALL_CLOCK_SECS`         | 1500    | Time budget for the page-production phase of one crawl. A crawl that overruns it fails. Must be 300 to 1740.          |

### Fronting Pro with your own proxy

`POST /v1/extract` answers `202` once the upload lands, but the upload itself can take minutes on a slow link. Set the proxy's backend timeout to at least 300 seconds. The Helm chart sets `gke.backendConfig.timeoutSec: 300` for the GKE load balancer, whose default is 30 seconds.

Pro does not cut off an upload that is still arriving. A proxy timeout shorter than the slowest upload still wins, so the AWS ALB idle timeout, an Istio route `timeout` (the chart's `istio.virtualService.timeout`, unset by default) and nginx `proxy-read-timeout` and `proxy-send-timeout` must each be at least `HTTP_BODY_IDLE_TIMEOUT_SECS` and as long as your longest upload.

## Caching

Pro caches extraction results by the hash of the input and config. Caching is opt-in per request: set `options.extraction_config.use_cache: true` to read and write cached results. Use `cache_namespace` to keep datasets apart and `cache_ttl_secs` to shorten an entry's lifetime.

| Variable                     | Default                                    | Description                                                                                                                |
| ---------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `CACHE_ENABLED`              | `true`                                     | Turn the local result cache on.                                                                                            |
| `CACHE_DIR`                  | `{tmpdir}/xberg-pro-cache` / `/data/cache` | Cache directory. Keep it on a persistent volume, or the cache is lost on restart.                                          |
| `CACHE_TTL_SECS`             | 43200 / 604800                             | Entry lifetime in seconds. The code default is 12 hours and the chart default is 7 days.                                   |
| `CACHE_MAX_BYTES`            | 1073741824 / 10737418240                   | Cache size at which Pro evicts the least recently used entries. The code default is 1 GiB and the chart default is 10 GiB. |
| `CACHE_OBJECT_STORE_ENABLED` | `false`                                    | Also write entries to the storage provider, so the cache survives a restart. Reads check the local cache first.            |
| `CACHE_OBJECT_PREFIX`        | `cache`                                    | Key prefix for extraction cache entries in the storage provider. The RAG caches below ignore it.                           |
| `RAG_CACHE_RERANK_ENABLED`   | `true`                                     | Cache reranker results per project in object storage for 1 hour.                                                           |
| `RAG_CACHE_EMBED_ENABLED`    | `true`                                     | Cache query embeddings per project in object storage for 7 days.                                                           |

## RAG runtime

See the [RAG guide](/guides/rag/) for collections, ingest and retrieval, and [RAG configuration](/operate/rag-config/) for deployment guidance.

| Variable                                           | Default                       | Description                                                                                                                                                                   |
| -------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PRO_RAG_MAX_CONCURRENCY`                          | 2                             | RAG ingest, reindex and migrate tasks that run at once. Kept small on purpose, because these tasks load models.                                                               |
| `PRO_RAG_MIGRATE_BATCH_SIZE`                       | 100                           | Documents per batch during an embedding migration.                                                                                                                            |
| `XBERG_RAG_WARMUP_ENABLED`                         | `false`                       | Load RAG models at boot and every 15 minutes. Leave it off when collections use more presets than the engine cache bounds below, or each pass rebuilds and evicts the excess. |
| `RAG_WARMUP_TIMEOUT_SECS`                          | 480                           | Budget for one warmup pass, 10 to 3600, shorter than the interval. Raise it for slow model downloads.                                                                         |
| `RAG_WARMUP_INTERVAL_SECS`                         | 900                           | Gap between warmup passes, 60 to 86400.                                                                                                                                       |
| `RAG_QUERY_EMBED_TIMEOUT_SECS`                     | 30                            | Limit for embedding one interactive query, 1 to 600. Raise it when a cold model load on a small node exceeds 30 s.                                                            |
| `RAG_RETRIEVE_CONCURRENCY_PER_PROJECT`             | 4                             | Retrievals one project may run at once.                                                                                                                                       |
| `XBERG_EMBEDDING_ENGINE_CACHE_MAX_RESIDENT`        | 2                             | Embedding engines kept in memory per backend. Set it at least as high as the number of embedding presets in concurrent use, or alternating traffic rebuilds evicted engines.  |
| `XBERG_RERANKER_ENGINE_CACHE_MAX_RESIDENT`         | 2                             | Reranker engines kept in memory. Same sizing rule.                                                                                                                            |
| `XBERG_LATE_INTERACTION_ENGINE_CACHE_MAX_RESIDENT` | 2                             | Multi-vector embedding engines kept in memory.                                                                                                                                |
| `XBERG_SPARSE_EMBEDDING_ENGINE_CACHE_MAX_RESIDENT` | 2                             | Sparse embedding engines kept in memory.                                                                                                                                      |
| `XBERG_VECTORSTORE_DEFAULT_INDEX_METHOD`           | `hnsw`                        | Index method for new collections. Keep `hnsw`: `diskann` needs the `pgvectorscale` extension, which your PostgreSQL may not have.                                             |
| `HF_HOME`                                          | unset / `/data/rag-models/hf` | Hugging Face cache that RAG models load from. Keep it on the persistent volume.                                                                                               |

### Vector index worker

The embedded worker builds vector indexes in a supervised child process. The Helm chart exposes these as `vectorIndexWorker.*` values.

| Variable                                   | Default | Description                                                                                                                                                                     |
| ------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VECTOR_INDEX_DDL_STATEMENT_TIMEOUT_SECS`  | 3600    | Time limit for one index build, at most 43200. Chart value `vectorIndexWorker.ddlStatementTimeoutSeconds`.                                                                      |
| `VECTOR_INDEX_DDL_MAINTENANCE_WORK_MEM_MB` | 64      | PostgreSQL `maintenance_work_mem` per build, 16 to 2048 MiB. Raise it within the database's memory budget. Chart value `vectorIndexWorker.maintenanceWorkMemMb`.                |
| `VECTOR_INDEX_DDL_WAIT_TIMEOUT_SECS`       | derived | How long a caller waits for an index job. The default derives from the build timeout, and a smaller value is refused. Chart value `vectorIndexWorker.ddlWaitTimeoutSeconds`.    |
| `VECTOR_INDEX_WORKER_SHUTDOWN_GRACE_SECS`  | 3660    | Time the worker gets to finish a build on shutdown, at most 43260. It must cover the build timeout plus 60 seconds. Chart value `vectorIndexWorker.shutdownGracePeriodSeconds`. |

## Auto-tune

Auto-tune sweeps extraction settings against your own documents. See the [auto-tune guide](/guides/auto-tune/). These variables cap what one run can consume. `PRO_AUTO_TUNE_ENABLED` turns the feature on or off.

| Variable                            | Default | Description                                                                                    |
| ----------------------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| `PRO_AUTO_TUNE_MAX_CONCURRENCY`     | 2       | Trials evaluated at once within one run.                                                       |
| `PRO_AUTO_TUNE_MAX_TRIALS`          | 64      | Ceiling on candidate configurations per run. Overrides `max_trials` in the configuration file. |
| `PRO_AUTO_TUNE_MAX_DOCUMENTS`       | 50      | Ceiling on documents per run.                                                                  |
| `PRO_AUTO_TUNE_MAX_ACTIVE_JOBS`     | 3       | Runs that may be active at once.                                                               |
| `PRO_AUTO_TUNE_MAX_WALL_CLOCK_SECS` | 900     | Time budget for a whole run, in seconds.                                                       |
| `PRO_AUTO_TUNE_TOLERANCE`           | 0.01    | Scores within this distance of the best count as a tie.                                        |
| `PRO_AUTO_TUNE_HELD_OUT_FRACTION`   | 0.3     | Fraction of documents held back to score the winning configuration.                            |

## Structured extraction

Structured extraction returns fields against a JSON schema and needs a model. One setting names it. With it unset, a curated preset, a saved preset and an inline `structured_extraction.schema` all refuse with the same message. The exception is a hosted provider whose key is already in the environment: `OPENAI_API_KEY` alone lets the delegated path run `openai/gpt-4o`, and `GEMINI_API_KEY` or `VERTEXAI_PROJECT` select the defaults below. See [Structured extraction](/concepts/structured-extraction/).

| Variable                         | Default | Description                                                                                                                                                                                                          |
| -------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `XBERG_STRUCTURED_DEFAULT_MODEL` | unset   | The model structured extraction runs on, for example `qwen25vl`. A request with its own `structured_extraction.llm` keeps that model.                                                                                |
| `PRO_VISION_BASE_URL`            | unset   | OpenAI-compatible chat-completions endpoint you run, for example `http://ollama.xberg-llm.svc.cluster.local:11434/v1`. Set it together with `XBERG_STRUCTURED_DEFAULT_MODEL`. On its own it leaves the pipeline off. |
| `PRO_VISION_API_KEY`             | unset   | Bearer key for that endpoint. Leave it unset for a local model that needs none.                                                                                                                                      |
| `PRO_VLM_ENDPOINT_ALLOWLIST`     | unset   | Comma-separated hosts, exact or `.`-prefixed for a suffix match. Unset: any public destination is reachable and private addresses are refused. Set: egress is limited to exactly these hosts, public or private.     |
| `GEMINI_API_KEY`                 | unset   | Direct Gemini access, used when `PRO_VISION_BASE_URL` is unset. The model defaults to `gemini/gemini-2.5-flash`.                                                                                                     |
| `VERTEXAI_PROJECT`               | unset   | Vertex AI through Application Default Credentials, used when neither of the above is set. The model defaults to `vertex_ai/gemini-2.5-flash`.                                                                        |

### A model running in your cluster

Name the endpoint, the model and the host the egress guard must admit:

```yaml
configMap:
  PRO_VISION_BASE_URL: "http://ollama.xberg-llm.svc.cluster.local:11434/v1"
  XBERG_STRUCTURED_DEFAULT_MODEL: "qwen25vl"
  PRO_VLM_ENDPOINT_ALLOWLIST: "ollama.xberg-llm.svc.cluster.local"
```

Pro sends the model name to that endpoint exactly as written, so use the name the endpoint serves.

A model on your own endpoint runs the curated-preset path. A saved preset and an inline `structured_extraction.schema` take the delegated path, which sends no endpoint and needs a model whose provider authenticates from the environment. That path also refuses a model name containing a colon.

`PRO_VISION_BASE_URL` alone leaves the pipeline off and logs one warning at boot that names `XBERG_STRUCTURED_DEFAULT_MODEL`. Extraction, RAG and the web console keep serving.

## Extraction models and limits

| Variable                                 | Default         | Description                                                                                                                                                                                                                              |
| ---------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `XBERG_DATA_POLICY`                      | `standard`      | `standard` or `extraction_only`. `extraction_only` denies RAG reads and writes. The Helm chart sets it from `dataPolicy`.                                                                                                                |
| `XBERG_SECURITY_LIMITS_CEILING`          | built-in limits | JSON ceiling for client-supplied `security_limits`, for example `{"max_table_cells": 5000000}`. Omitted fields keep the built-in values. A request can only lower the result. Raise the container memory limit before raising a ceiling. |
| `XBERG_VLM_OCR_MODEL`                    | unset           | Default model for VLM OCR and image classification, for example `ollama/qwen2.5vl:7b`.                                                                                                                                                   |
| `XBERG_IMAGE_CLASSIFY`                   | `false`         | Classify images with a vision model. Requires `XBERG_VLM_OCR_MODEL`.                                                                                                                                                                     |
| `XBERG_STRUCTURED_SCAN_MAX_COVERAGE`     | 0.10            | Text coverage at or below which a page counts as a scan.                                                                                                                                                                                 |
| `XBERG_STRUCTURED_DIGITAL_MIN_COVERAGE`  | 0.90            | Text coverage at or above which a page counts as digital text.                                                                                                                                                                           |
| `XBERG_STRUCTURED_DOCX_TEXT_MIN_DENSITY` | 200.0           | Minimum text density for a DOCX to take the text-only path.                                                                                                                                                                              |
| `XBERG_STRUCTURED_ENABLE_FALLBACK`       | `false`         | Escalate a low-confidence text-only run to vision.                                                                                                                                                                                       |
| `XBERG_STRUCTURED_FALLBACK_THRESHOLD`    | 0.6             | Confidence below which the fallback escalates.                                                                                                                                                                                           |
| `XBERG_STRUCTURED_MAX_OUTPUT_TOKENS`     | 8000            | Output-token ceiling per model call.                                                                                                                                                                                                     |
| `XBERG_STRUCTURED_MAX_INPUT_TOKENS`      | 800000          | Input-token ceiling per model call.                                                                                                                                                                                                      |
| `XBERG_STRUCTURED_MAX_PARALLEL_CALLS`    | 4               | Parallel model calls per document.                                                                                                                                                                                                       |
| `XBERG_STRUCTURED_MAX_EXCERPT_CHARS`     | 200000          | Prompt excerpt budget in characters.                                                                                                                                                                                                     |
| `XBERG_STRUCTURED_MAX_PAGE_EDGE`         | 1568            | Longest edge in pixels of a page image sent to a model. `0` disables downscaling.                                                                                                                                                        |

### Local models for VLM OCR and LLM reranking

VLM OCR and the LLM reranker share one rule for a model name and its endpoint.

**The model name.** With a base URL, Pro strips the provider prefix of a local model server and sends the rest. Local model servers are `ollama`, `vllm`, `lmstudio`, `llamacpp`, `llamafile`, `localai`, `lemonade`, `oobabooga`, `xinference`, `infinity`, `docker_model_runner` and `langgraph`, plus the prefixes they declare, such as `ollama_chat/` and `lm_studio/`. So `ollama/qwen2.5vl:7b` reaches the server as `qwen2.5vl:7b`. Every other model ID reaches the base URL unchanged. A gateway such as OpenRouter or NVIDIA NIM receives `openai/gpt-oss-20b` as written. An Ollama server serves the bare name, so `openai/qwen2.5vl:7b` at an Ollama base URL fails with `model not found`. Use `ollama/qwen2.5vl:7b` or `qwen2.5vl:7b`.

**The endpoint.** A local model server without `ocr.vlm_config.base_url` would be called on its loopback default, inside the Pro container. Pro refuses such a request at submit with a `400` that names `ocr.vlm_config.base_url`. The base URL must pass the egress guard. `PRO_VLM_ENDPOINT_ALLOWLIST` admits a private host. Once it names any host, egress is limited to the hosts it names, so list every endpoint a request may use.

**The LLM reranker.** The reranker calls the server's rerank endpoint, so the server must serve one. Infinity does and Ollama does not. With `XBERG_MANAGED_LLM_BASE_URL` set, the model name follows the rule above.

| Variable                     | Default | Description                                                                                                               |
| ---------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------- |
| `XBERG_MANAGED_LLM_PROVIDER` | unset   | Provider of the reranker model, for example `infinity`. Unset leaves the LLM reranker off.                                |
| `XBERG_MANAGED_LLM_MODEL`    | unset   | Model that a rerank request naming none runs on, for example `mixedbread-ai/mxbai-rerank-xsmall-v1`.                      |
| `XBERG_MANAGED_LLM_API_KEY`  | unset   | Provider key. Required unless `XBERG_MANAGED_LLM_BASE_URL` is set.                                                        |
| `XBERG_MANAGED_LLM_BASE_URL` | unset   | Rerank server to call. Required for a local provider such as `infinity`. Its host must pass `PRO_VLM_ENDPOINT_ALLOWLIST`. |

## Text enrichment

Enrichment runs in-process. `POST /v1/enrich` accepts a submission and returns a job ID to poll. A submission that arrives while every worker is busy waits in the queue. Pro refuses it only when the queue is also full, with a `503` and a `Retry-After` header giving the seconds to wait. See [Enrichment](/guides/enrichment/).

| Variable                    | Default | Description                                                                        |
| --------------------------- | ------- | ---------------------------------------------------------------------------------- |
| `PRO_ENRICH_MAX_CONCURRENT` | 8       | Enrichment jobs that run at once. At least 1.                                      |
| `PRO_ENRICH_MAX_QUEUED`     | 32      | Accepted jobs that may wait for a worker. Each holds its request text, up to 1 MB. |

## Database connections

| Variable                            | Default | Description                                                                                                                                                        |
| ----------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DB_POOL_SIZE`                      | 16      | Connections in the application pool. Must be above 0.                                                                                                              |
| `DB_POOL_CHECKOUT_TIMEOUT_SECS`     | 30      | How long a request waits for a free connection, 1 to 300. Lower it to fail fast under saturation.                                                                  |
| `DB_STATEMENT_TIMEOUT_MS`           | 30000   | PostgreSQL `statement_timeout` per application connection. `0` disables it. Vector-index builds are not limited by it.                                             |
| `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS` | 60000   | PostgreSQL `idle_in_transaction_session_timeout`. `0` disables it.                                                                                                 |
| `DB_LOCK_TIMEOUT_MS`                | 5000    | PostgreSQL `lock_timeout`. `0` disables it.                                                                                                                        |
| `DATABASE_TLS_ENABLED`              | unset   | `true` requires certificate-validating TLS on every runtime connection. `false` is refused when a URL says `sslmode=require`. Unset follows `sslmode` in each URL. |
| `SSL_CERT_FILE`                     | unset   | PEM bundle that adds a private CA to the trust store for PostgreSQL TLS. Mount the file into the container.                                                        |
| `SSL_CERT_DIR`                      | unset   | Directory of PEM certificates, as an alternative to `SSL_CERT_FILE`.                                                                                               |

## Timeouts and shutdown

This table lists the shutdown, extraction, outbound-call and SFTP time budgets.

| Variable                                | Default | Description                                                                                                                                                                                                               |
| --------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PRO_SHUTDOWN_DRAIN_SECS`               | 90      | Whole shutdown budget. The HTTP drain spends from it first, then extraction, RAG and auto-tune drain together on the rest. The Helm chart rejects this variable. See [Shutdown on Helm](#shutdown-on-helm).               |
| `PRO_SUPERVISOR_SHUTDOWN_GRACE_SECS`    | 3690    | Time the supervisor waits for its children after a termination signal before it kills them. Must exceed the API drain and `VECTOR_INDEX_WORKER_SHUTDOWN_GRACE_SECS`. Chart value `supervisor.shutdownGracePeriodSeconds`. |
| `XBERG_EXTRACTION_TIMEOUT_CEILING_SECS` | 600     | Most a request's `extraction_timeout_secs` may ask for. A larger value is clamped, with a warning. See [Long extractions](#long-extractions).                                                                             |
| `XBERG_EXTRACTION_TIMEOUT_DEFAULT_SECS` | 600     | Timeout of a request that sends none. Pro wraps the extraction in this value plus 30 s. At most the ceiling. Unset, it is 600, or the ceiling when lower.                                                                 |
| `PRO_ATTEMPT_TIMEOUT_SECS`              | 900     | Replicated deployments only. Deadline of one job attempt, 30 to 86400 and greater than the ceiling. Singleton deployments ignore it.                                                                                      |
| `XBERG_LLM_CALL_TIMEOUT_SECS`           | 300     | Deadline for one LLM provider call (vision, structured extraction), including retries. 30 to 3600. It bounds a hung connection, so keep it above what a working call takes.                                               |
| `XBERG_OCR_CALL_TIMEOUT_SECS`           | 1260    | Deadline for one VLM OCR provider call, including its four attempts of 300 s. 60 to 7200 and not below `XBERG_LLM_CALL_TIMEOUT_SECS`.                                                                                     |
| `SAFE_HTTP_CONNECT_TIMEOUT_SECS`        | 5       | Connect timeout of the outbound client for source connectors and OAuth providers, 1 to 120, not above the total.                                                                                                          |
| `SAFE_HTTP_READ_TIMEOUT_SECS`           | 20      | Read timeout of the same client, 1 to 300, not above the total.                                                                                                                                                           |
| `SAFE_HTTP_TOTAL_TIMEOUT_SECS`          | 30      | Total timeout of the same client, 1 to 600. Webhooks and OIDC have their own timeouts.                                                                                                                                    |
| `SFTP_CONNECT_TIMEOUT_SECS`             | 15      | TCP connect and SSH handshake budget of the SFTP connector, 1 to 120.                                                                                                                                                     |
| `SFTP_OPERATION_TIMEOUT_SECS`           | 8       | Budget for one SFTP operation (open, stat, read directory), 1 to 120 and not above the inventory and fetch budgets.                                                                                                       |
| `SFTP_INVENTORY_TIMEOUT_SECS`           | 120     | Budget for listing one SFTP source, 5 to 3600. Raise it for very large trees.                                                                                                                                             |
| `SFTP_FETCH_TIMEOUT_SECS`               | 45      | Budget for fetching one document, 5 to 1800. It bounds the largest file the connector can pull over a slow link.                                                                                                          |

The rest live next to the feature they limit:

- RAG: `RAG_WARMUP_TIMEOUT_SECS`, `RAG_WARMUP_INTERVAL_SECS` and `RAG_QUERY_EMBED_TIMEOUT_SECS` in [RAG runtime](#rag-runtime).
- Database: `DB_POOL_CHECKOUT_TIMEOUT_SECS` in [Database connections](#database-connections).
- Webhooks: `PRO_WEBHOOK_MAX_RETRIES` and `PRO_WEBHOOK_HTTP_TIMEOUT_SECS` in [Webhooks and crawling](#webhooks-and-crawling).
- Sign-in: `OIDC_HTTP_TIMEOUT_SECS` and `JWT_EXPIRATION_SECS` in [Web console sign-in with OIDC](#web-console-sign-in-with-oidc).
- Storage: `STORAGE_PRESIGN_TTL_SECS` in [Storage](#storage).
- Auto-tune: `PRO_AUTO_TUNE_MAX_WALL_CLOCK_SECS` in [Auto-tune](#auto-tune).
- Uploads: `PRO_UPLOAD_REPLAY_GRACE_SECS` and `PRO_UPLOAD_GC_INTERVAL_SECS` in [Retention](#retention).
- Source sync: `PRO_INTEGRATION_SYNC_*_SECS` in [Integration sync](#integration-sync).
- Vector indexes: `VECTOR_INDEX_*_SECS` in [Vector index worker](#vector-index-worker).

Readiness, liveness and startup probes are chart values (`livenessProbe`, `readinessProbe`, `startupProbe`) or your orchestrator's settings. The in-process readiness check allows each dependency 2 seconds, which stays below the chart's 3-second probe timeout.

### Shutdown on Helm

The chart derives `PRO_SHUTDOWN_DRAIN_SECS` and rejects it as a `configMap` key. Set these values instead:

| Chart value                             | Default | Description                                                                                                                                         |
| --------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `terminationGracePeriodSeconds`         | 3720    | The pod's whole shutdown budget. Raise it when in-flight extractions need longer to finish. It must exceed `supervisor.shutdownGracePeriodSeconds`. |
| `shutdown.killMarginSeconds`            | 10      | Seconds held back for the telemetry flush. The drain is the grace period minus this margin, 3710 s by default. At least 20 s must remain.           |
| `supervisor.shutdownGracePeriodSeconds` | 3690    | See `PRO_SUPERVISOR_SHUTDOWN_GRACE_SECS`.                                                                                                           |

In a replicated generation, the chart reads `deployment.terminationGracePeriodSeconds` (default 60) instead. The drain is that value minus 20 s, and the supervisor grace is that value minus 10 s.

With plain `docker run`, set `PRO_SHUTDOWN_DRAIN_SECS` and the container stop timeout (`docker stop --time`) together.

### Long extractions

A large scanned PDF can need more than the default ten minutes. A job that runs out of time fails with `Extraction timed out after 600000ms`. Raise the limits below together, because each caps the next.

1. **Per request.** Send `extraction_timeout_secs` in the request's `config` (JSON body, or the `config` field of a multipart request). For one file in a multipart request, use that file's `config-<filename>` part. The value is in seconds.
2. **Deployment ceiling.** `XBERG_EXTRACTION_TIMEOUT_CEILING_SECS` (default 600) is the most any request may ask for.
3. **Deployment default.** `XBERG_EXTRACTION_TIMEOUT_DEFAULT_SECS` (default 600) applies to requests that send no value. Raising only the ceiling leaves them at 600 s. It cannot exceed the ceiling.

For 30 minutes on every document, set both:

```yaml
configMap:
  XBERG_EXTRACTION_TIMEOUT_CEILING_SECS: "1800"
  XBERG_EXTRACTION_TIMEOUT_DEFAULT_SECS: "1800"
```

With `docker run`, pass the same two names with `-e`. A request can still ask for less than the default. Pro wraps each extraction in the resolved timeout plus 30 s, so a single container needs no further setting. Check these too:

| Setting                       | Default            | Relationship                                                                                                                                                                                                                                                                |
| ----------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PRO_ATTEMPT_TIMEOUT_SECS`    | 900                | Replicated mode only. Must be greater than the ceiling, or Pro refuses to start. Leave a few minutes of margin for storing the result.                                                                                                                                      |
| Shutdown drain                | 90 / 3710          | A restart waits this long for running extractions, then abandons them. An abandoned job fails with a restart error on the next boot. The chart default covers a 30-minute extraction. With `docker run`, raise `PRO_SHUTDOWN_DRAIN_SECS` and `docker stop --time` together. |
| `XBERG_OCR_CALL_TIMEOUT_SECS` | 1260               | One VLM OCR call, not the document. A page that needs longer fails whatever the extraction timeout. Matters only when VLM OCR is on.                                                                                                                                        |
| `XBERG_LLM_CALL_TIMEOUT_SECS` | 300                | The same for one vision or structured-extraction call.                                                                                                                                                                                                                      |
| `PRO_MAX_CONCURRENCY`         | `min(CPUs, 8)` / 4 | Each long extraction holds a slot for its whole duration, and other jobs queue behind it.                                                                                                                                                                                   |

## Retention

| Variable                                  | Default | Description                                                                                                                                                                                                                                                                       |
| ----------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RAG_AUDIT_RETENTION_DAYS`                | 90      | Days of RAG retrieval audit rows to keep. Pro drops a monthly partition once the whole month is older. 1 to 36500. `0` is rejected and stops startup.                                                                                                                             |
| `PRO_UPLOAD_REPLAY_GRACE_SECS`            | 86400   | Time after an upload expires during which a confirmed batch can still be re-confirmed idempotently. Above 0. Raise it when clients may retry after long outages.                                                                                                                  |
| `PRO_UPLOAD_GC_INTERVAL_SECS`             | 60      | Gap between upload cleanup sweeps. Above 0.                                                                                                                                                                                                                                       |
| `PRO_UPLOAD_GC_BATCH_LIMIT`               | 16      | Expired batches, and separately orphaned objects, claimed per project in one sweep. 1 to 100.                                                                                                                                                                                     |
| `PRO_UPLOAD_GC_PROJECT_LIMIT`             | 16      | Projects examined in one sweep. 1 to 100.                                                                                                                                                                                                                                         |
| `PRO_RESULT_ACCESS_POLICY_EPOCH`          | unset   | Policy version recorded on each newly admitted job, a positive integer. Set it together with `PRO_RESULT_ACCESS_LIFETIME_SECS`. See [Result access lifetime](/operate/result-access-lifetime/).                                                                                   |
| `PRO_RESULT_ACCESS_LIFETIME_SECS`         | unset   | Seconds after completion during which a new job's result stays readable, 1 to 315360000. Setting only one of the two result-access variables stops startup. Expiry limits access and does not delete stored objects.                                                              |
| `PRO_RESULT_S3_CLEANUP_ENABLED`           | `false` | Delete expired main results from AWS S3 by exact object version. Needs an admitted replicated extraction-only generation, bucket versioning and `s3:DeleteObjectVersion` on the result prefix.                                                                                    |
| `PRO_INPUT_S3_CLEANUP_ENABLED`            | `false` | Delete abandoned, never-attached extraction inputs from AWS S3 by exact object version. Same requirements as result cleanup, on the `documents/` prefix.                                                                                                                          |
| `PRO_CONNECTOR_RESULT_REMOVAL_GRACE_SECS` | unset   | Standalone Pro only. Seconds, 0 to 315360000, that results of newly admitted S3 connector documents stay readable after the connector records the source removal. `0` expires access immediately. Unset keeps them readable. See [Source connectors](/guides/source-connectors/). |

On Helm, `migrations.retainedS3ReconciliationGrants` (`verify`, `grant` or `revoke`; default `verify`) controls the maintenance identity's access for reconciling retained S3 objects. It requires Pro chart 0.7.5 or later. Use `grant` and `revoke` in separate maintenance upgrades, as described in [Result access lifetime](/operate/result-access-lifetime/).

Extraction results live in object storage under `results/{project_id}/{job_id}.json` and stay until the project is erased. Pro deletes expired RAG ingest job records 7 days after submission. Upload cleanup removes expired staging data and never removes the recovery source of an accepted job. Raise the batch or project limit only when cleanup falls behind.

## Private MCP listener

Pro can serve MCP (version 2026-07-28) on a private `/mcp` listener. It is off by default, the public REST API never serves it, and each listener serves one mode. Clients send a project API key as an `Authorization: Bearer` credential.

| Mode         | Tools                                                                        | Requires                                                                                                                       |
| ------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `rag`        | `list_collections`, `list_documents`, `retrieve`                             | Singleton Pro, the standard data policy and `PRO_RAG_ENABLED=true`.                                                            |
| `extraction` | `extract_document`, `get_extraction_job_status`, `get_extraction_job_result` | A registered replicated generation with `extraction_only`, result access lifetime, and versioned AWS S3 or Azure Blob storage. |

| Variable                 | Default | Description                                                                                                                                   |
| ------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `MCP_LISTENER_ENABLED`   | `false` | Start the listener.                                                                                                                           |
| `MCP_LISTENER_MODE`      | `rag`   | `rag` or `extraction`.                                                                                                                        |
| `MCP_LISTENER_ADDR`      | none    | Socket address with a fixed port, such as `127.0.0.1:8095`. Required when enabled.                                                            |
| `MCP_ALLOWED_HOSTS`      | none    | Comma-separated `host:port` authorities the listener accepts. Include the authority the client sends. Required when enabled.                  |
| `MCP_ALLOWED_ORIGINS`    | empty   | Comma-separated HTTP or HTTPS origins with explicit ports. Leave it empty for clients that send no `Origin` header.                           |
| `MCP_CURSOR_SIGNING_KEY` | none    | 32 bytes as unpadded base64url, which signs pagination cursors. Use the same key on every replica behind one listener. Required when enabled. |

Invalid values stop startup. On Helm, set the chart values instead. The chart rejects these variables in `configMap`:

| Chart value                               | Default | Description                                                                                                                                         |
| ----------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mcp.enabled`                             | `false` | Enable the listener.                                                                                                                                |
| `mcp.mode`                                | `rag`   | `rag` or `extraction`. `extraction` requires Pro chart 0.7.5 or later. Earlier charts serve `rag` mode only.                                        |
| `mcp.port`                                | 8095    | Listener port. It must differ from the chart's other ports and from `PRO_BIND_ADDR`.                                                                |
| `mcp.cursorSigningKeySecret.name`, `.key` | empty   | Secret and key holding the signing key. Required when enabled.                                                                                      |
| `migrations.mcpRagReleaseExecute`         | `false` | `rag` mode only. Grants the application login the retrieval routines during the maintenance grants Job. A reconciliation with `false` removes them. |

The chart binds the listener to `127.0.0.1:<port>`, allows `127.0.0.1:<port>` and `localhost:<port>`, and sets no origins. It adds no Service or ingress route. Reach it with `kubectl port-forward pod/<pod-name> 8095:8095` and connect to `http://127.0.0.1:8095/mcp`. Outside Helm, apply the grants in your maintenance procedure with `MCP_RAG_RELEASE_EXECUTE=true`. REST keeps serving while the listener waits for the grants.

## OTLP trace, log and metric export

`/metrics` always serves Prometheus metrics. Setting `OTEL_EXPORTER_OTLP_ENDPOINT` also pushes traces, log records and a metrics copy to an OTLP/gRPC collector. Unset, Pro logs one warning at boot, writes readable logs to stdout and keeps serving `/metrics`. See [Observability](/observability/).

| Variable                              | Default                    | Description                                                                                                                                                     |
| ------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT`         | unset                      | gRPC collector endpoint, for example `http://collector:4317`, for every signal. Empty counts as unset. The chart leaves it empty because it ships no collector. |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`  | unset                      | Overrides the endpoint for traces only.                                                                                                                         |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`    | unset                      | Overrides the endpoint for log records only.                                                                                                                    |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | unset                      | Overrides the endpoint for the metrics push only.                                                                                                               |
| `OTEL_METRIC_EXPORT_INTERVAL`         | 15000                      | Metrics push interval in milliseconds, 1000 to 3600000. Does not affect `/metrics` scrapes.                                                                     |
| `OTEL_SERVICE_NAME`                   | `xberg-enterprise` / `pro` | Service name on exported telemetry. Use a distinct value per deployment.                                                                                        |
| `CIRCUIT_BREAKER_OPEN_SECS`           | 30                         | How long a provider circuit (database pool, embedding and LLM providers) sheds calls after 5 consecutive failures, 1 to 600.                                    |

Set the base endpoint alone to export all three signals to one collector. Set per-signal endpoints to split them.

## Logging

| Variable    | Default | Description                                                                   |
| ----------- | ------- | ----------------------------------------------------------------------------- |
| `LOG_LEVEL` | `info`  | `trace`, `debug`, `info`, `warn` or `error`.                                  |
| `RUST_LOG`  | `info`  | Log filter directive, for example `info,pro=debug`. It overrides `LOG_LEVEL`. |

## Bundled web console

| Variable                                                        | Default                 | Description                                                                                                                                                         |
| --------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BACKEND_API_URL`, `DATA_PLANE_API_URL`, `PRO_INTERNAL_API_URL` | `http://127.0.0.1:8080` | Where the bundled web console reaches the API inside the container. The image sets them. Change them only when the console runs apart from the API.                 |
| `NEXT_PUBLIC_*`                                                 | image build             | Browser-visible console settings. The OIDC ones are served from `/runtime-env.js` at run time. See [Web console sign-in with OIDC](#web-console-sign-in-with-oidc). |

## Configuration file

Pro reads an optional TOML file at `/config/xberg-pro.toml`. Set `XBERG_PRO_CONFIG_FILE` to read it from another path. A missing file is not an error. A file that is unreadable, malformed or has an unknown key stops startup.

The file holds one section, `[auto_tune.search]`, which sets the search space that auto-tune sweeps:

```toml
[auto_tune.search]
# OCR backends to sweep, in dominance order. Unset uses the backends this
# deployment can run.
ocr_backends = ["tesseract", "paddleocr"]

# Ceiling on trials per run. PRO_AUTO_TUNE_MAX_TRIALS overrides this.
max_trials = 48

# Candidate values per knob, keyed by the knob's wire name.
[auto_tune.search.candidates]
psm = [3, 6]
pdf_extract_tables = [true, false]
```

Mount the file read-only. In Kubernetes, use a ConfigMap:

```yaml
volumeMounts:
  - name: pro-config
    mountPath: /config
    readOnly: true
volumes:
  - name: pro-config
    configMap:
      name: xberg-pro-config
```

`max_trials` is the only key that both sources set. Pro resolves it from `PRO_AUTO_TUNE_MAX_TRIALS` first, then `max_trials` in the file, then the built-in default. A per-request `max_trials` can lower the ceiling for one run and never raise it.

## Volumes and OCR data

For local filesystem storage, mount a volume at `STORAGE_FS_ROOT`:

```bash
docker run -v /host/path:/data/xberg \
  -e STORAGE_FS_ROOT=/data/xberg \
  ghcr.io/xberg-io/xberg-pro:<version>
```

For the result cache, mount `CACHE_DIR`:

```bash
docker run -v /host/cache:/var/cache/xberg \
  -e CACHE_DIR=/var/cache/xberg \
  ghcr.io/xberg-io/xberg-pro:<version>
```

Replace `<version>` with the release you were given, and pin it by digest in production.

### OCR data and models

The image carries the Tesseract language packs `eng`, `deu`, `fra`, `spa`, `nld`, `kor`, `chi_sim` and `osd` under `TESSDATA_PREFIX`, so OCR in those languages needs no network access. It also carries the pinned classic OCR models (PaddleOCR, Sceptre recognizers and the shared CRAFT detector) in a read-only image layer under `/usr/share/xberg/ocr-models/hub`, so mounting or replacing `/data` does not hide them.

Other models download on first use: layout and table detection, embeddings, rerankers and enrichment models. `XBERG_CACHE_DIR` stays `/data/models`, and the image does not redirect `HF_HOME`. Keep these caches on the same persistent volume as `STORAGE_FS_ROOT` and `CACHE_DIR`. The Helm chart mounts `/data` from the StatefulSet's claim, so a restart does not download them again.

For an air-gapped install, copy the models you need onto the `/data` volume from a machine with network access before the first start. A Tesseract language pack outside the bundled set needs network access or the same pre-seeding. See [Air-gapped installs](/operate/air-gapped/).

## Examples

### Local development (filesystem storage)

```bash
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/xberg"
export MAINTENANCE_DATABASE_URL="postgresql://maintenance:maintenance-pass@localhost:5432/xberg"
export XBERG_LICENSE_KEY="REPLACE_WITH_LICENSE_TOKEN"
export STORAGE_PROVIDER="fs"
export STORAGE_BUCKET="unused"
export STORAGE_FS_ROOT="/tmp/xberg-storage"
export XBERG_ADMIN_KEY="kz_admin_$(openssl rand -hex 16)"
export LOG_LEVEL="debug"
```

### Production on AWS (S3)

```bash
export DATABASE_URL="postgresql://user:pass@rds-endpoint:5432/xberg"
export MAINTENANCE_DATABASE_URL="postgresql://maintenance:pass@rds-endpoint:5432/xberg"
export XBERG_LICENSE_KEY="REPLACE_WITH_LICENSE_TOKEN"
export STORAGE_PROVIDER="s3"
export STORAGE_BUCKET="xberg-prod-results"
export STORAGE_REGION="us-west-2"
export S3_ACCESS_KEY_ID="REPLACE_WITH_ACCESS_KEY_ID"
export S3_SECRET_ACCESS_KEY="REPLACE_WITH_SECRET_ACCESS_KEY"
export XBERG_ADMIN_KEY="kz_admin_$(openssl rand -hex 16)"
export PRO_MAX_CONCURRENCY="16"
export CACHE_ENABLED="true"
export CACHE_MAX_BYTES="5368709120"
```

### Production on GCP (GCS and Cloud SQL)

```bash
export DATABASE_URL="postgresql://cloudsql-user:pass@cloudsql-proxy:5432/xberg"
export MAINTENANCE_DATABASE_URL="postgresql://maintenance-user:pass@cloudsql-proxy:5432/xberg"
export XBERG_LICENSE_KEY="REPLACE_WITH_LICENSE_TOKEN"
export STORAGE_PROVIDER="gcs"
export STORAGE_BUCKET="xberg-prod-results"
export STORAGE_REGION="us-central1"
export GCS_CREDENTIAL=""  # Use Workload Identity or GOOGLE_APPLICATION_CREDENTIALS
export XBERG_ADMIN_KEY="kz_admin_$(openssl rand -hex 16)"
export PRO_MAX_CONCURRENCY="16"
export INTEGRATION_KEK="$(openssl rand -base64 32)"
export INTEGRATION_STATE_SECRET="$(openssl rand -base64 32)"
export OAUTH_CALLBACK_BASE_URL="https://api.yourdomain.com"
export FRONTEND_BASE_URL="https://app.yourdomain.com"
```

### Kubernetes

The default Pro profile is a one-replica StatefulSet with a `/data` PersistentVolumeClaim for models, caches and local results. A restart or reschedule keeps them. Configure it through the chart's `values.yaml` and follow [Install Pro with Helm](/start/pro-helm/).

The `extraction_only` profile supports fixed Deployment replicas and red/green generations with shared PostgreSQL and object storage. See [Deployment operator](/operate/deployment-operator/).

The default singleton chart sets the claim to 100 GiB. `persistence.size` applies to fresh claims only and does not resize an existing one. For sizing, GitOps renders and growing the volume, see [Persistent volume](/start/pro-helm/#persistent-volume).
