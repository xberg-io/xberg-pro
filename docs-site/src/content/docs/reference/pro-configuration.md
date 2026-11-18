---
title: Xberg Pro configuration
description: Environment variable reference for the Xberg Pro container, covering storage, cache, authentication, integrations, timeouts and tuning.
sidebar:
  order: 2
---

**Available in:** Pro

Xberg Pro reads configuration from two sources at startup: environment variables, and an optional TOML file. Set the variables on the container (`docker run -e`) or in the Helm chart's `configMap` and `secrets` values. See [Run Pro with Docker](/start/pro-docker/) and [Install Pro with Helm](/start/pro-helm/).

Most settings are environment variables only. The TOML file adds the auto-tune search space, which is too structured for a flat variable. Where both sources set the same key, the environment wins. See [Configuration file](#configuration-file).

A malformed value stops startup. If `CACHE_TTL_SECS` is set to `twelve`, Pro reports the variable by name and exits instead of starting with the default.

## Required

| Variable                   | Type   | Example                                         | Description                                                                                                    |
| -------------------------- | ------ | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`             | string | `postgresql://app:pass@host:5432/xberg`         | Application login, a member of `xberg_application`                                                             |
| `MAINTENANCE_DATABASE_URL` | string | `postgresql://maintenance:pass@host:5432/xberg` | PostgreSQL URL for a distinct login that is a member of `xberg_maintenance`                                    |
| `XBERG_LICENSE_KEY`        | string | `eyJzY2hlbWFfdmVyc2lvbiI6Mi4uLn0.MEUCIQ...`     | Ed25519-signed license token. Pro refuses to start without a valid one. See [Licensing](/reference/licensing/) |
| `STORAGE_PROVIDER`         | string | `s3`, `gcs`, `azure` or `fs`                    | Object storage backend                                                                                         |
| `STORAGE_BUCKET`           | string | `my-bucket`                                     | Bucket or container name (unused for `fs`)                                                                     |

Do not use the role administrator, a superuser, or the same login for both database URLs. Pro validates both identities at startup and fails closed when either membership is missing, crossed or unsafe.

## Database roles and upgrades

Pro supports PostgreSQL 15 to 18. For a bring-your-own PostgreSQL server, account for four responsibilities:

- `DATABASE_URL` identifies the application login. It is a member only of `xberg_application`. Membership selects the ordinary row-level security policies but does not grant table, sequence or function privileges, which the bootstrap sets directly.
- `MAINTENANCE_DATABASE_URL` identifies a distinct, nonprivileged maintenance login that is a member of `xberg_maintenance`.
- A schema owner applies extensions and the declarative schema. The bootstrap transfers schema ownership to the fixed `xberg_schema_owner` role.
- A role administrator creates the fixed `NOLOGIN` capability roles and grants each runtime login its matching membership. The Pro process must never receive this credential.

The Helm chart runs this bootstrap with ordered hooks when `migrations.enabled=true`. Supply the role administrator, schema owner and maintenance credentials as separate inputs: `migrations.roleAdminDatabaseUrlSecret`, `migrations.databaseUrlSecret` and `maintenance.databaseUrlSecret`. If migrations run out of band, reproduce that order in your pipeline before rolling Pro: role provisioning, then extensions and schema, then grants. Back up the database before every upgrade. See [Backup and restore](/operate/backup-and-restore/) and [Upgrades](/operate/upgrades/).

Roll out policy-role changes in two releases. Deploy the expand release first so both memberships exist while all policies remain available to `PUBLIC`, then replace every old Pro pod. Apply the contract release only afterward. It assigns ordinary policies to `xberg_application` and maintenance hatches to `xberg_maintenance`.

Downgrading across the schema-owner boundary requires the bridge release and PostgreSQL 15 to 18. Stop every database writer, then run the chart with `migrations.contractRollback=true` and `migrations.schemaOwnershipRollback=true` for one sync. A failed rollback leaves Pro quiesced until the same operation succeeds. Native `helm rollback` renders hooks from the target chart and cannot use a bridge hook that an older revision lacks, so run the current chart in rollback mode before selecting the older chart.

Rotate the maintenance login without changing `xberg_maintenance`. Create a new `LOGIN INHERIT` role with no superuser or `BYPASSRLS` privileges, grant it membership through the role bootstrap, publish its URL and restart Pro. For Helm, also bump `maintenance.credentialRevision`. Once the new instance is healthy and the old login has no active sessions, revoke the old membership and drop that login.

## Presigned local uploads

Set `PRO_PUBLIC_API_URL` to the externally reachable HTTP(S) API origin, such as `https://api.example.com`, when using filesystem storage with `/v1/uploads/presign`. Credentials, paths, queries and fragments are rejected. Pro uses this configured origin for upload URLs and browser preflight admission. It does not derive trust from the request host or forwarded headers. Cloud storage continues to use its provider's signed upload URLs.

Upload capabilities expire and accept one PUT. Confirmation snapshots the uploaded bytes before assigning durable jobs, so changing the staging object afterwards cannot change an accepted job. Retrying confirmation returns the same job IDs. A concurrent confirmation can return 409 while the first attempt is still running.

## Storage

Provider-specific settings follow `STORAGE_PROVIDER`. See [Storage](/operate/storage/) for sizing and layout guidance.

### Filesystem

| Variable          | Type   | Default       | Example        | Description                                 |
| ----------------- | ------ | ------------- | -------------- | ------------------------------------------- |
| `STORAGE_FS_ROOT` | string | `/data/xberg` | `/mnt/storage` | Root directory for local filesystem storage |

### GCS

| Variable         | Type   | Default | Example                                 | Description                                                                                                                                          |
| ---------------- | ------ | ------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GCS_CREDENTIAL` | string | empty   | `{...base64...}` or `/path/to/key.json` | Service account JSON (base64) or file path. Empty uses Application Default Credentials (Workload Identity on GKE)                                    |
| `GCS_ENDPOINT`   | string | none    | `https://storage.googleapis.com`        | GCS endpoint override. Presigning requires service-account signing credentials. Ordinary reads and writes use anonymous requests for local emulators |

### S3

| Variable               | Type   | Default  | Example              | Description                                                             |
| ---------------------- | ------ | -------- | -------------------- | ----------------------------------------------------------------------- |
| `S3_ACCESS_KEY_ID`     | string | required | `AKIA...`            | AWS access key                                                          |
| `S3_SECRET_ACCESS_KEY` | string | required | `wJalr...`           | AWS secret key                                                          |
| `S3_ENDPOINT`          | string | none     | `http://rustfs:9000` | S3 endpoint override (for RustFS, LocalStack)                           |
| `S3_PATH_STYLE`        | bool   | false    | `true` or `false`    | Enable path-style addressing (for RustFS and other self-hosted servers) |

### Azure Blob Storage

| Variable                   | Type   | Default  | Example                        | Description                                   |
| -------------------------- | ------ | -------- | ------------------------------ | --------------------------------------------- |
| `AZURE_STORAGE_ACCOUNT`    | string | required | `myaccount`                    | Storage account name                          |
| `AZURE_STORAGE_ACCESS_KEY` | string | required | `DefaultEndpointsProtocol=...` | Storage access key                            |
| `AZURE_ENDPOINT`           | string | none     | `http://127.0.0.1:10000`       | Azure endpoint override (for Azurite testing) |

### Common

| Variable                     | Type   | Default | Example                            | Description                                                                                                                         |
| ---------------------------- | ------ | ------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `STORAGE_ROOT`               | string | none    | `xberg/prod`                       | Path prefix inside the bucket. For the `fs` provider, setting this replaces `STORAGE_FS_ROOT` entirely rather than nesting under it |
| `STORAGE_REGION`             | string | none    | `us-west-2`                        | Cloud region (optional, provider-specific)                                                                                          |
| `STORAGE_PRESIGN_TTL_SECS`   | int    | 3600    | `7200`                             | Presigned URL expiry in seconds (1 hour)                                                                                            |
| `STORAGE_ENDPOINT_ALLOWLIST` | string | none    | `rustfs.internal.com,.example.com` | Comma-separated hostnames. Required if `GCS_ENDPOINT`, `S3_ENDPOINT` or `AZURE_ENDPOINT` is set                                     |

## Caching

| Variable                     | Type   | Default                    | Example            | Description                                                                                                                                                                                                  |
| ---------------------------- | ------ | -------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CACHE_ENABLED`              | bool   | true                       | `true` or `false`  | Enable the local BLAKE3-addressed result cache                                                                                                                                                               |
| `CACHE_DIR`                  | string | `{tmpdir}/xberg-pro-cache` | `/var/cache/xberg` | Cache directory (created if absent)                                                                                                                                                                          |
| `CACHE_TTL_SECS`             | int    | 43200                      | `86400`            | Cache entry time-to-live in seconds (default 12 hours)                                                                                                                                                       |
| `CACHE_MAX_BYTES`            | int    | 1073741824                 | `5368709120`       | Maximum cache size in bytes before LRU eviction (default 1 GiB, example 5 GiB)                                                                                                                               |
| `CACHE_OBJECT_STORE_ENABLED` | bool   | false                      | `true`             | Also write cache entries to the configured storage provider, so the cache survives a pod restart and is shared across replicas. Reads check the local tier first                                             |
| `CACHE_OBJECT_PREFIX`        | string | `cache`                    | `xberg-cache`      | Key prefix for extraction-result cache entries in the storage provider. It applies to the extraction cache only. The RAG rerank and embed caches below use the fixed prefix `cache` and ignore this variable |
| `RAG_CACHE_RERANK_ENABLED`   | bool   | true                       | `false`            | Cache reranker results per project in the configured storage provider for 1 hour. Pro has no NATS, so this always writes to object storage. Enterprise adds a NATS key-value tier                            |
| `RAG_CACHE_EMBED_ENABLED`    | bool   | true                       | `false`            | Cache query embeddings per project in object storage for 7 days                                                                                                                                              |

Results are cached by the BLAKE3 hash of the extraction input and config. Result caching is opt-in on both Pro and Enterprise: set `options.extraction_config.use_cache: true` to read and write cached results. Omission or `false` requests fresh extraction even when the instance cache is enabled. Use `cache_namespace` to keep datasets apart and `cache_ttl_secs` to shorten the entry lifetime. The two RAG caches are the same switches the Enterprise RAG service reads, so a repeated query pays the cross-encoder and the embedding once on either tier.

### RAG runtime

See the [RAG guide](/guides/rag/) for how collections, ingest and retrieval fit together, and [RAG configuration](/operate/rag-config/) for deployment guidance.

| Variable                                           | Type         | Default | Example          | Description                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------- | ------------ | ------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PRO_RAG_MAX_CONCURRENCY`                          | int          | 2       | `4`              | Maximum concurrent in-process RAG ingest, reindex and migrate tasks. Deliberately small and fixed, unlike extraction's CPU-derived concurrency                                                                                                                                                                                  |
| `PRO_RAG_MIGRATE_BATCH_SIZE`                       | int          | 100     | `50`             | Documents per batch during an embedding-migration dual write                                                                                                                                                                                                                                                                    |
| `XBERG_RAG_WARMUP_ENABLED`                         | bool         | false   | `true`           | Warm RAG models (NER and embedding presets) at boot and every 15 minutes. Keep this off when collections use more presets than the embedding cache bound, or each pass rebuilds and evicts the excess models                                                                                                                    |
| `XBERG_EMBEDDING_ENGINE_CACHE_MAX_RESIDENT`        | positive int | 2       | `3`              | Maximum engines retained in each embedding backend. Set it at least as high as the number of collection embedding presets used concurrently by this instance. Otherwise alternating traffic rebuilds evicted engines. The ONNX and static-model caches each apply the bound independently and evict least recently used engines |
| `XBERG_RERANKER_ENGINE_CACHE_MAX_RESIDENT`         | positive int | 2       | `3`              | Maximum reranker engines retained in memory. Set it at least as high as the number of reranker presets used concurrently. Excess engines are evicted least recently used                                                                                                                                                        |
| `XBERG_LATE_INTERACTION_ENGINE_CACHE_MAX_RESIDENT` | positive int | 2       | `3`              | Same bound for late-interaction (multi-vector) embedding engines                                                                                                                                                                                                                                                                |
| `XBERG_SPARSE_EMBEDDING_ENGINE_CACHE_MAX_RESIDENT` | positive int | 2       | `3`              | Same bound for sparse embedding engines                                                                                                                                                                                                                                                                                         |
| `XBERG_VECTORSTORE_DEFAULT_INDEX_METHOD`           | string       | `hnsw`  | `diskann`        | Deployment-wide default vector index method for new collections. `hnsw` is the Pro default because Pro runs on your PostgreSQL and cannot assume the `pgvectorscale` extension that `diskann` needs                                                                                                                             |
| `HF_HOME`                                          | string       | unset   | `/data/hf-cache` | Hugging Face cache directory that RAG models load from, for both warmup and requests                                                                                                                                                                                                                                            |

## Retention

| Variable                          | Type         | Default | Example  | Description                                                                                                                                                                                                  |
| --------------------------------- | ------------ | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `RAG_AUDIT_RETENTION_DAYS`        | int          | 90      | `30`     | Days of RAG retrieval audit rows to keep. The maintenance loop drops a monthly partition once its whole month is older than this. Must be in the range 1 to 36,500. A value outside that range stops startup |
| `PRO_UPLOAD_REPLAY_GRACE_SECS`    | int          | 86400   | `172800` | Seconds after an upload capability expires during which a confirmed batch remains available for idempotent confirmation retries. Must be greater than zero                                                   |
| `PRO_UPLOAD_GC_INTERVAL_SECS`     | int          | 60      | `300`    | Seconds between upload cleanup sweeps. Must be greater than zero                                                                                                                                             |
| `PRO_UPLOAD_GC_BATCH_LIMIT`       | int          | 16      | `32`     | Maximum expired batches and, separately, orphaned objects claimed per project in one sweep. Must be in the range 1 to 100                                                                                    |
| `PRO_UPLOAD_GC_PROJECT_LIMIT`     | int          | 16      | `32`     | Maximum projects examined in one sweep. Must be in the range 1 to 100                                                                                                                                        |
| `PRO_RESULT_ACCESS_POLICY_EPOCH`  | positive int | unset   | `1`      | Policy version recorded on each newly admitted job. Set together with `PRO_RESULT_ACCESS_LIFETIME_SECS`. See [Result access lifetime](/operate/result-access-lifetime/)                                      |
| `PRO_RESULT_ACCESS_LIFETIME_SECS` | positive int | unset   | `86400`  | Seconds after completion during which a new job's result stays readable. Unset both variables to leave the feature off. Setting only one stops startup                                                       |

Extraction results live in object storage under `results/{project_id}/{job_id}.json` and are kept until the project is erased. The same maintenance loop deletes expired RAG ingest job records 7 days after submission.

Upload cleanup removes expired staging data and never removes the immutable recovery source of an accepted job. Increase the replay grace when clients can retry confirmation after long outages. Raise the batch or project limit only when cleanup falls behind. Together with the enforced object census per batch, these limits bound the object-store work attempted in one sweep.

## Authentication

See [Authentication](/concepts/authentication/) for how API keys, the bootstrap admin key and dashboard sign-in fit together.

| Variable                | Type   | Default    | Example              | Description                                                                                                                                                                                                                                                   |
| ----------------------- | ------ | ---------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `XBERG_ADMIN_KEY`       | string | none       | `kz_admin_123abc...` | Bearer token for control-plane requests such as preset CRUD and the audit log. If unset, control endpoints return 401. The `kz_` prefix is canonical                                                                                                          |
| `PRO_RAG_ENABLED`       | bool   | true       | `false`              | Build the in-process RAG runtime (vector store, warmed embedding models) at boot. A valid license grants the whole product, so this is a boot-cost switch and not an entitlement gate. `false` makes every `/v1/rag/*` request return 404 with `rag.disabled` |
| `PRO_AUTO_TUNE_ENABLED` | bool   | true       | `false`              | Build the in-process auto-tune runtime at boot. Mirrors `PRO_RAG_ENABLED`. `false` makes every `/v1/auto-tune` and `/v1/tuning-profiles` request return 404 with `auto_tune.disabled`                                                                         |
| `SESSION_COOKIE_SECURE` | bool   | true       | `false`              | Require HTTPS when sending the frontend session cookie. Set to `false` only for an intentional plain-HTTP evaluation                                                                                                                                          |
| `PRO_AUTH_MODE`         | string | `required` | `disabled`           | `required` enforces API keys and, if configured, OIDC login. `disabled` serves a single, unauthenticated local workspace. Use it for evaluation only and restrict network access. An unrecognized value stops startup                                         |

Keep `SESSION_COOKIE_SECURE=true` for every TLS deployment. If you run Pro over plain HTTP for evaluation, set `SESSION_COOKIE_SECURE=false`. The frontend logs a warning while this protection is disabled.

### Dashboard sign-in with OIDC

| Variable                    | Type   | Default | Example                                              | Description                                                                                                                                                                                                     |
| --------------------------- | ------ | ------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OIDC_ISSUER_URL`           | string | none    | `https://identity.example.com`                       | OIDC issuer URL. Required together with `OIDC_AUDIENCE` and `JWT_SECRET` for OIDC login. Setting only one of `OIDC_ISSUER_URL` and `OIDC_AUDIENCE` stops startup                                                |
| `OIDC_AUDIENCE`             | string | none    | `xberg-dashboard`                                    | Expected OIDC audience or client id                                                                                                                                                                             |
| `OIDC_JWKS_URI`             | string | none    | `https://identity.example.com/.well-known/jwks.json` | Explicit JWKS URI, bypassing OIDC discovery                                                                                                                                                                     |
| `JWT_SECRET`                | string | none    | 32+ character random string                          | HS256 secret that signs session JWTs. Required once OIDC login is enabled. Startup fails without it                                                                                                             |
| `JWT_EXPIRATION_SECS`       | int    | 604800  | `3600`                                               | Session JWT lifetime in seconds (default 7 days)                                                                                                                                                                |
| `PRO_ALLOWED_EMAILS`        | string | empty   | `alice@example.com,bob@example.com`                  | Comma-separated sign-in allowlist by exact address                                                                                                                                                              |
| `PRO_ALLOWED_EMAIL_DOMAINS` | string | empty   | `example.com`                                        | Comma-separated sign-in allowlist by email domain                                                                                                                                                               |
| `PRO_ADMIN_EMAILS`          | string | empty   | `alice@example.com`                                  | Comma-separated instance admins with control-plane access. No first sign-in becomes admin. With this empty, no signed-in user reaches the control plane and only `XBERG_ADMIN_KEY` does. Startup logs a warning |
| `OIDC_HTTP_TIMEOUT_SECS`    | int    | 5       | `15`                                                 | Timeout for each OIDC discovery and JWKS request. Must be 1 to 120. See [Tuning](#tuning)                                                                                                                       |

The bootstrap API key authenticates REST requests. Human dashboard access requires an identity provider. An API-only installation displays this requirement on its sign-in page.

Register a public OIDC client with the authorization-code flow and PKCE at your identity provider. Register the dashboard's exact `/auth/callback` URL as a permitted redirect. Set the verifier and browser settings on the running Pro container. The same image supports different providers without rebuilding it.

With Docker Compose, save this override as `compose.oidc.yml`, replacing the example addresses and client identifier and the service name `pro` with the one in your Compose file:

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

Apply it together with your normal Compose file:

```bash
docker compose -f compose.yml -f compose.oidc.yml up -d
```

The three `NEXT_PUBLIC_OIDC_*` values are public client configuration. The browser receives them from `/runtime-env.js`. The signing secret and bootstrap API key stay server-side. The issuer must be reachable from both the browser and Pro, and must allow the dashboard origin at its browser-facing endpoints.

## Integration hub

Source connectors and their OAuth flows. See [Source connectors](/guides/source-connectors/).

| Variable                              | Type   | Default                 | Example                      | Description                                                                                                                                                                                                                                                               |
| ------------------------------------- | ------ | ----------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INTEGRATION_KEK`                     | string | empty                   | `base64_32_bytes_here`       | AES-256-GCM key (32 bytes, base64) for credential encryption. Set together with `INTEGRATION_STATE_SECRET`. With both unset the integration hub is disabled and its OAuth routes return 503                                                                               |
| `INTEGRATION_STATE_SECRET`            | string | empty                   | `base64_32_bytes_here`       | HMAC key (32 bytes, base64) for OAuth state tokens. Pro refuses to start when only one of the two is set, or when either value is not base64 of 32 bytes                                                                                                                  |
| `INTEGRATION_KEK_PREVIOUS`            | string | empty                   | `base64_32_bytes_here`       | The outgoing key during a KEK rotation. Every stored credential names the key that wrapped it, so a read opens it with that key and re-wraps it under `INTEGRATION_KEK`. A background sweep re-wraps the rest. Remove it after the sweep reports the rotation is complete |
| `OAUTH_CALLBACK_BASE_URL`             | string | `http://localhost:8080` | `https://yourdomain.com`     | Base URL for OAuth redirect URIs, for example `https://yourdomain.com/v1/integrations/oauth/callback`                                                                                                                                                                     |
| `FRONTEND_BASE_URL`                   | string | `http://localhost:3000` | `https://app.yourdomain.com` | Frontend URL for the post-OAuth redirect, for example `https://app.yourdomain.com/integrations`                                                                                                                                                                           |
| `XBERG_ALLOW_INSECURE_OAUTH_CALLBACK` | bool   | false                   | `true`                       | Allow HTTP OAuth callbacks for non-localhost hosts. Development and testing only. Production must use HTTPS                                                                                                                                                               |

The Google Drive and SFTP source connectors dispatch in-process using the same extraction semaphore pool.

## Tuning

| Variable                             | Type   | Default                             | Example                                             | Description                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------ | ------ | ----------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PRO_BIND_ADDR`                      | string | `0.0.0.0:8080`                      | `127.0.0.1:8080`                                    | HTTP server bind address and port                                                                                                                                                                                                                                                                                                                                                        |
| `PRO_METRICS_ADDR`                   | string | `0.0.0.0:9090`                      | `127.0.0.1:9090`                                    | Prometheus `/metrics` bind address and port                                                                                                                                                                                                                                                                                                                                              |
| `PRO_WORKER_READINESS_URL`           | string | unset                               | `http://127.0.0.1:9091/readyz`                      | Readiness endpoint of the embedded vector-index worker. `/readyz` reports it as the `worker` check and answers not ready while the worker is not ready. The supervisor in the image sets it. The host must be loopback, and Pro refuses to start otherwise. A Pro process started on its own runs without a worker and reports no worker check                                           |
| `PRO_MAX_CONCURRENCY`                | int    | `min(num_cpus, 8)`                  | `8`                                                 | Maximum concurrent extraction tasks. `0` derives the value from the CPU count, capped at 8, the same cap as the Enterprise worker                                                                                                                                                                                                                                                        |
| `PRO_ENGINE_MAX_THREADS`             | int    | derived from the CPU limit          | `16`                                                | Process-wide extraction thread budget shared by concurrent documents. Pro resolves it at startup from the container CPU quota, rounded up and bounded by CPU affinity, or from all available logical CPUs when no quota is set. An explicit value takes precedence and must be at least 1. Memory use grows with each added thread, so raise it together with the container memory limit |
| `MAINTENANCE_DB_POOL_SIZE`           | int    | 16                                  | `4`                                                 | Maximum connections in the maintenance pool. Must be greater than zero                                                                                                                                                                                                                                                                                                                   |
| `PRO_MAX_UPLOAD_BYTES`               | int    | 104857600                           | `52428800`                                          | Maximum request body size in bytes (default 100 MiB, roughly 75 MiB of raw documents). Must be greater than 0                                                                                                                                                                                                                                                                            |
| `PRO_SHUTDOWN_DRAIN_SECS`            | int    | 90                                  | `60`                                                | Whole shutdown budget in seconds. The HTTP drain spends from it first. The extraction, RAG and auto-tune drains then run concurrently on the rest. The Helm chart sets it to `terminationGracePeriodSeconds - shutdown.killMarginSeconds`                                                                                                                                                |
| `CRAWL_WALL_CLOCK_SECS`              | int    | 1500                                | `1740`                                              | Wall-clock budget for the page-production phase of one crawl. A crawl that overruns it fails. Must be 300 to 1740                                                                                                                                                                                                                                                                        |
| `PRO_WEBHOOK_MAX_RETRIES`            | int    | 5                                   | `5`                                                 | Webhook delivery attempts. Must be 1 to 10. A value outside that range stops the service at startup. The first attempt is immediate. The retries wait 5 s, 30 s, 5 min and 5 min, plus jitter, the same schedule as Enterprise                                                                                                                                                           |
| `PRO_WEBHOOK_HTTP_TIMEOUT_SECS`      | int    | 30                                  | `60`                                                | Per-request timeout for webhook and callback delivery (connect, send and read the response). Must be 1 to 300. Raise it for a slow receiver                                                                                                                                                                                                                                              |
| `OIDC_HTTP_TIMEOUT_SECS`             | int    | 5                                   | `15`                                                | Timeout for each OIDC discovery and JWKS request. Must be 1 to 120. Raise it for a slow identity provider or egress proxy                                                                                                                                                                                                                                                                |
| `LOG_LEVEL`                          | string | `info`                              | `debug` or `warn`                                   | Logging level: `trace`, `debug`, `info`, `warn` or `error`                                                                                                                                                                                                                                                                                                                               |
| `PRO_TRUSTED_PROXY_CIDRS`            | string | empty                               | `10.0.0.0/8`                                        | Comma-separated reverse-proxy CIDRs trusted to resolve the client IP. The OAuth callback and the `POST /auth/login` rate limit both key on that IP. Required together with `PRO_TRUSTED_PROXY_HOPS`. Setting only one stops startup                                                                                                                                                      |
| `PRO_TRUSTED_PROXY_HOPS`             | int    | empty                               | `1`                                                 | Fixed trusted proxy hop count, including the direct peer. Must be at least 1. Required together with `PRO_TRUSTED_PROXY_CIDRS`                                                                                                                                                                                                                                                           |
| `PRO_RAW_BODY_LIMIT_BYTES`           | int    | derived from `PRO_MAX_UPLOAD_BYTES` | `209715200`                                         | Overrides the router's raw request-body buffer, which otherwise scales with `PRO_MAX_UPLOAD_BYTES`. Rejected at startup if it is out of proportion to `PRO_MAX_UPLOAD_BYTES`                                                                                                                                                                                                             |
| `CORS_ALLOWED_ORIGINS`               | string | empty                               | `https://app.example.com,https://admin.example.com` | Comma-separated list of allowed CORS origins (`scheme://host[:port]`). `*` allows any origin and is for local development only                                                                                                                                                                                                                                                           |
| `HTTP_REQUEST_TIMEOUT_SECS`          | int    | 30                                  | `60`                                                | Handler timeout in whole seconds, from the request body being fully received (or the request starting, when it has no body) to the response head. A slower handler gets `504` with code `gateway_timeout`. `0` disables the limit. The maximum is 86400. It does not limit how long an upload takes to arrive or a streamed response                                                     |
| `HTTP_BODY_IDLE_TIMEOUT_SECS`        | int    | 60                                  | `120`                                               | Longest gap in whole seconds with no request-body bytes while a body streams. A stalled upload gets `408` with code `request_timeout` and the connection is closed. An upload that keeps arriving is never cut off. `0` disables the limit. The maximum is 86400                                                                                                                         |
| `RATE_LIMIT_BURST`                   | int    | 300                                 | `100`                                               | Per-caller request burst allowed on every authenticated route. `0` disables the limit. A rejected request gets `429` with `Retry-After` and `x-ratelimit-*` headers                                                                                                                                                                                                                      |
| `RATE_LIMIT_PER_SECS`                | int    | 60                                  | `60`                                                | Seconds over which `RATE_LIMIT_BURST` refills evenly                                                                                                                                                                                                                                                                                                                                     |
| `LOGIN_RATE_LIMIT_BURST`             | int    | 10                                  | `5`                                                 | Per-client-IP burst allowed on `POST /auth/login`, same shape as `RATE_LIMIT_BURST`                                                                                                                                                                                                                                                                                                      |
| `LOGIN_RATE_LIMIT_PER_SECS`          | int    | 60                                  | `60`                                                | Seconds over which `LOGIN_RATE_LIMIT_BURST` refills evenly                                                                                                                                                                                                                                                                                                                               |
| `ACCOUNT_DELETE_RATE_LIMIT_BURST`    | int    | 5                                   | `10`                                                | Per-client-IP burst allowed on `DELETE /auth/account`, same shape as `RATE_LIMIT_BURST`. The route verifies its own Bearer JWT and sits outside the per-caller limiter, so this limit keys on the resolved client IP                                                                                                                                                                     |
| `ACCOUNT_DELETE_RATE_LIMIT_PER_SECS` | int    | 60                                  | `60`                                                | Seconds over which `ACCOUNT_DELETE_RATE_LIMIT_BURST` refills evenly                                                                                                                                                                                                                                                                                                                      |

### OTLP trace, log and metric export

Pro exports nothing over OTLP by default. `/metrics` always serves Prometheus-format metrics. Separately, `OTEL_EXPORTER_OTLP_ENDPOINT` is the switch that also pushes traces, log records and a metrics copy to an OTLP/gRPC collector. Unset, Pro logs one warning at boot naming the variable, keeps human-readable logs on stdout and keeps serving `/metrics`. It does not fail to start. See [Observability](/observability/).

| Variable                              | Type     | Default            | Description                                                                                                                                                                |
| ------------------------------------- | -------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT`         | string   | unset              | gRPC collector endpoint (for example `http://collector:4317`) for every signal without a signal-specific override below. An empty string counts as unset                   |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`  | string   | unset              | Overrides the endpoint above for traces only                                                                                                                               |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`    | string   | unset              | Overrides the endpoint above for log records only                                                                                                                          |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | string   | unset              | Overrides the endpoint above for the OTLP metrics push only                                                                                                                |
| `CIRCUIT_BREAKER_OPEN_SECS`           | int      | 30                 | How long a provider circuit (database pool, embedding and LLM providers) sheds calls after 5 consecutive failures. Range 1 to 600                                          |
| `OTEL_METRIC_EXPORT_INTERVAL`         | int (ms) | 15000              | How often the OTLP metrics push runs. Range 1000 to 3600000. Standard OpenTelemetry name. It has no effect on `/metrics` scrapes. A bad value stops the service at startup |
| `OTEL_SERVICE_NAME`                   | string   | `xberg-enterprise` | Service name attached to exported traces, logs and metrics. The Pro chart sets `pro`. Set a distinct value per deployment                                                  |

Set `OTEL_EXPORTER_OTLP_ENDPOINT` alone to turn on all three signals against one collector, or set the signal-specific variables to split them across collectors. The Pro Helm chart leaves `configMap.OTEL_EXPORTER_OTLP_ENDPOINT` empty on purpose, since it ships no collector.

## Structured extraction

Structured extraction returns fields against a JSON schema. It needs a model, and one setting names it. No path guesses a model for an endpoint you configured, so with the setting unset a curated preset, a saved preset and an inline `structured_extraction.schema` refuse with the same message. The exception is a hosted provider whose key is already in the environment: `OPENAI_API_KEY` alone lets the delegated path run `openai/gpt-4o`, and `GEMINI_API_KEY` or `VERTEXAI_PROJECT` select the provider defaults in the table below. See [Structured extraction](/concepts/structured-extraction/).

| Variable                         | Type   | Default | Example                                              | Description                                                                                                                                                                                                                                                  |
| -------------------------------- | ------ | ------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `XBERG_STRUCTURED_DEFAULT_MODEL` | string | unset   | `qwen25vl`                                           | The model structured extraction runs on. A request that carries its own `structured_extraction.llm` keeps that model                                                                                                                                         |
| `PRO_VISION_BASE_URL`            | string | unset   | `http://ollama.xberg-llm.svc.cluster.local:11434/v1` | An OpenAI-compatible chat-completions endpoint you run. Set it together with `XBERG_STRUCTURED_DEFAULT_MODEL`. On its own it leaves the pipeline off                                                                                                         |
| `PRO_VISION_API_KEY`             | string | unset   | `sk-...`                                             | Bearer credential for that endpoint. Leave it unset for a local model that needs no key                                                                                                                                                                      |
| `PRO_VLM_ENDPOINT_ALLOWLIST`     | string | unset   | `ollama.xberg-llm.svc.cluster.local`                 | Comma-separated hosts (exact, or `.`-prefixed for a suffix match). Unset: any public destination is reachable and private addresses are refused. Set: egress is restricted to exactly these hosts, public or private, and every other destination is refused |
| `GEMINI_API_KEY`                 | string | unset   | `AIza...`                                            | Direct Gemini, read when `PRO_VISION_BASE_URL` is unset. The model defaults to `gemini/gemini-2.5-flash`                                                                                                                                                     |
| `VERTEXAI_PROJECT`               | string | unset   | `my-project`                                         | Vertex AI through Application Default Credentials, read when neither of the above is set. The model defaults to `vertex_ai/gemini-2.5-flash`                                                                                                                 |

### A model running in your cluster

Name the endpoint, the model and the host the guard must admit:

```yaml
configMap:
  PRO_VISION_BASE_URL: "http://ollama.xberg-llm.svc.cluster.local:11434/v1"
  XBERG_STRUCTURED_DEFAULT_MODEL: "qwen25vl"
  PRO_VLM_ENDPOINT_ALLOWLIST: "ollama.xberg-llm.svc.cluster.local"
```

Pro sends the model name to that endpoint exactly as written, so use the name the endpoint serves.

A model on your own endpoint runs the curated-preset path. A saved preset and an inline `structured_extraction.schema` take the delegated path, which sends no endpoint and needs a model whose provider authenticates from the environment. That path also refuses a model name containing a colon.

`PRO_VISION_BASE_URL` on its own leaves the pipeline off and logs one warning at boot naming `XBERG_STRUCTURED_DEFAULT_MODEL`. Extraction, RAG and the dashboard keep serving.

## Local models for VLM OCR and LLM reranking

VLM OCR and the LLM reranker use one rule for a model name and its endpoint.

### The model name

With a base URL, Pro removes the prefix of a local model server and sends the rest. A local model server is a provider whose default endpoint is the loopback address: `ollama`, `vllm`, `lmstudio`, `llamacpp`, `llamafile`, `localai`, `lemonade`, `oobabooga`, `xinference`, `infinity`, `docker_model_runner` and `langgraph`, and the other prefixes these providers declare, such as `ollama_chat/` and `lm_studio/`. So `ollama/qwen2.5vl:7b` reaches the server as `qwen2.5vl:7b`.

Every other model id reaches the base URL as written. A gateway such as OpenRouter, vLLM or NVIDIA NIM receives `openai/gpt-oss-20b` unchanged.

An Ollama server serves the bare model name, so `openai/qwen2.5vl:7b` at an Ollama base URL fails with `model not found`. Use `ollama/qwen2.5vl:7b` or `qwen2.5vl:7b`.

### The endpoint

A local model server with no `ocr.vlm_config.base_url` would be called at its loopback default, inside the Pro container. Pro refuses such a request at submit with a `400` that names `ocr.vlm_config.base_url`. The base URL passes the egress guard. `PRO_VLM_ENDPOINT_ALLOWLIST` admits a private host. Once it names any host, egress is restricted to the hosts it names, so list every other endpoint a request may point `base_url` at too, not only this one.

### The LLM reranker

The reranker calls the server's rerank endpoint, so the server must serve one. Infinity does. Ollama does not. With `XBERG_MANAGED_LLM_BASE_URL` set, the model name follows the rule above: `infinity` with `mixedbread-ai/mxbai-rerank-xsmall-v1` sends `mixedbread-ai/mxbai-rerank-xsmall-v1`.

| Variable                     | Type   | Default | Example                                            | Description                                                                                                                  |
| ---------------------------- | ------ | ------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `XBERG_MANAGED_LLM_PROVIDER` | string | unset   | `infinity`                                         | The provider of the reranker model. Unset leaves the LLM reranker off                                                        |
| `XBERG_MANAGED_LLM_MODEL`    | string | unset   | `mixedbread-ai/mxbai-rerank-xsmall-v1`             | The model a rerank request that names none runs on                                                                           |
| `XBERG_MANAGED_LLM_API_KEY`  | string | unset   | `sk-...`                                           | The provider key. Required unless `XBERG_MANAGED_LLM_BASE_URL` is set                                                        |
| `XBERG_MANAGED_LLM_BASE_URL` | string | unset   | `http://infinity.xberg-llm.svc.cluster.local:7997` | The rerank server to call. Required for a local provider such as `infinity`. Its host must pass `PRO_VLM_ENDPOINT_ALLOWLIST` |

## Auto-tune

Auto-tune sweeps extraction settings against your own documents. See the [auto-tune guide](/guides/auto-tune/). A valid license grants the whole product, so auto-tune is not separately licensed. The operator boot-cost switch `PRO_AUTO_TUNE_ENABLED` (default `true`, see [Authentication](#authentication)) gates it, not a license entitlement. These variables cap what one run can consume.

| Variable                            | Type  | Default | Example | Description                                                                                   |
| ----------------------------------- | ----- | ------- | ------- | --------------------------------------------------------------------------------------------- |
| `PRO_AUTO_TUNE_MAX_CONCURRENCY`     | int   | 2       | `8`     | Trials evaluated at the same time within one run                                              |
| `PRO_AUTO_TUNE_MAX_TRIALS`          | int   | 64      | `32`    | Ceiling on candidate configurations per run. Overrides `max_trials` in the configuration file |
| `PRO_AUTO_TUNE_MAX_DOCUMENTS`       | int   | 50      | `25`    | Ceiling on documents accepted per run                                                         |
| `PRO_AUTO_TUNE_MAX_ACTIVE_JOBS`     | int   | 3       | `4`     | Runs allowed to be active at the same time                                                    |
| `PRO_AUTO_TUNE_MAX_WALL_CLOCK_SECS` | int   | 900     | `3600`  | Wall-clock budget for a whole run in seconds                                                  |
| `PRO_AUTO_TUNE_TOLERANCE`           | float | 0.01    | `0.05`  | Ranking tolerance band. Scores within this distance of the best count as a tie                |
| `PRO_AUTO_TUNE_HELD_OUT_FRACTION`   | float | 0.3     | `0.4`   | Fraction of documents held back to score the winning configuration                            |

## Text enrichment

Text enrichment runs in-process on every Pro instance. `POST /v1/enrich` accepts a submission and returns a job id to poll, so acceptance and execution are separate events. A submission that arrives while every worker is busy waits in the queue instead of being refused. Pro refuses a submission only when the queue is also full. The refusal is a `503` with a `Retry-After` header that gives the number of seconds to wait, and it is the only `503` Pro sends with that header. Retry the submission after that interval. A `503` without `Retry-After` does not tell you when the condition clears. See [Enrichment](/guides/enrichment/).

| Variable                    | Type | Default | Example | Description                                                                                   |
| --------------------------- | ---- | ------- | ------- | --------------------------------------------------------------------------------------------- |
| `PRO_ENRICH_MAX_CONCURRENT` | int  | 8       | `16`    | Enrichment jobs that run at the same time. Must be at least 1                                 |
| `PRO_ENRICH_MAX_QUEUED`     | int  | 32      | `64`    | Accepted jobs that can wait for a worker. Each waiting job holds its request text, up to 1 MB |

## Database connections

| Variable                            | Type   | Default | Example                     | Description                                                                                                                                                                              |
| ----------------------------------- | ------ | ------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DB_POOL_SIZE`                      | int    | 16      | `32`                        | Maximum connections in the application pool. Must be greater than zero. See also `MAINTENANCE_DB_POOL_SIZE` under [Tuning](#tuning)                                                      |
| `DB_STATEMENT_TIMEOUT_MS`           | int    | 30000   | `60000`                     | PostgreSQL `statement_timeout` applied to every application connection, in milliseconds. `0` disables it                                                                                 |
| `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS` | int    | 60000   | `120000`                    | PostgreSQL `idle_in_transaction_session_timeout`, in milliseconds. `0` disables it                                                                                                       |
| `DB_LOCK_TIMEOUT_MS`                | int    | 5000    | `10000`                     | PostgreSQL `lock_timeout`, in milliseconds. `0` disables it                                                                                                                              |
| `DATABASE_TLS_ENABLED`              | bool   | unset   | `true`                      | `true` requires certificate-validating TLS on every runtime database connection. `false` is refused when a URL says `sslmode=require`. Unset, `sslmode=require` in each URL turns TLS on |
| `SSL_CERT_FILE`                     | string | unset   | `/etc/ssl/db-ca-bundle.pem` | Combined PEM bundle that adds a private CA to the trust store for PostgreSQL TLS. Mount the file into the container                                                                      |
| `SSL_CERT_DIR`                      | string | unset   | `/etc/ssl/extra-certs`      | Directory of PEM certificates, as an alternative to `SSL_CERT_FILE`                                                                                                                      |

A malformed value stops startup. The three timeouts bound statements the application issues. They do not limit the vector-index builds described in [Vector index worker](#vector-index-worker).

## Timeouts and shutdown

Every operator-tunable time budget is listed here with a pointer to its full description. Values not listed (lease renewal ratios, internal retry delays) are protocol invariants and are intentionally fixed.

| Variable                                                      | Type | Default   | Example | Description                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------- | ---- | --------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PRO_SHUTDOWN_DRAIN_SECS`                                     | int  | 90        | `60`    | Whole API shutdown budget. See [Tuning](#tuning)                                                                                                                                                                                                                                                                                                   |
| `PRO_SUPERVISOR_SHUTDOWN_GRACE_SECS`                          | int  | 3690      | `3690`  | Seconds the supervisor waits for its children to exit after a termination signal before it kills them. Must exceed the API drain and `VECTOR_INDEX_WORKER_SHUTDOWN_GRACE_SECS`. The Helm chart sets it from `supervisor.shutdownGracePeriodSeconds`                                                                                                |
| `XBERG_EXTRACTION_TIMEOUT_CEILING_SECS`                       | int  | 600       | `3600`  | Upper bound for a request's `extraction_timeout_secs`. A larger request value is clamped to it with a warning. Must be a positive whole number. See [Long extractions](#long-extractions)                                                                                                                                                          |
| `XBERG_EXTRACTION_TIMEOUT_DEFAULT_SECS`                       | int  | 600       | `1800`  | Extraction timeout of a request that sends no `extraction_timeout_secs`, and Pro's own wall-clock budget around that extraction (plus 30 s). Must be a positive whole number no greater than `XBERG_EXTRACTION_TIMEOUT_CEILING_SECS`. Startup is refused otherwise. Unset, it is 600, or the ceiling when that is lower                            |
| `PRO_ATTEMPT_TIMEOUT_SECS`                                    | int  | 900       | `3600`  | Replicated deployments only (`PRO_DEPLOYMENT_MODE=replicated`): the fixed deadline of one job attempt, stamped on each job when it is accepted and covering the whole extraction. Must be 30 to 86400 and, in replicated mode, greater than `XBERG_EXTRACTION_TIMEOUT_CEILING_SECS`. A singleton deployment has no attempt deadline and ignores it |
| `PRO_WEBHOOK_HTTP_TIMEOUT_SECS`                               | int  | 30        | `60`    | Per-request webhook delivery timeout. See [Tuning](#tuning)                                                                                                                                                                                                                                                                                        |
| `XBERG_LLM_CALL_TIMEOUT_SECS`                                 | int  | 300       | `600`   | Deadline for one logical LLM provider call (vision, structured extraction), including the client's own retries. Must be 30 to 3600. It bounds a hung connection, so keep it above what a working call takes                                                                                                                                        |
| `XBERG_OCR_CALL_TIMEOUT_SECS`                                 | int  | 1260      | `2400`  | Deadline for one logical VLM OCR call, including the client's four attempts at 300 s each. Must be 60 to 7200 and not shorter than `XBERG_LLM_CALL_TIMEOUT_SECS`. Both stop the service at startup when invalid                                                                                                                                    |
| `RAG_WARMUP_TIMEOUT_SECS`                                     | int  | 480       | `900`   | Budget for one embedding-model warmup pass. Must be 10 to 3600 and shorter than `RAG_WARMUP_INTERVAL_SECS`. Raise it for slow model downloads                                                                                                                                                                                                      |
| `RAG_WARMUP_INTERVAL_SECS`                                    | int  | 900       | `1800`  | Gap between warmup passes. Must be 60 to 86400                                                                                                                                                                                                                                                                                                     |
| `RAG_QUERY_EMBED_TIMEOUT_SECS`                                | int  | 30        | `60`    | Wall-clock ceiling for embedding one interactive RAG query. Must be 1 to 600. Raise it when a cold model load on a small node exceeds 30 s                                                                                                                                                                                                         |
| `SAFE_HTTP_CONNECT_TIMEOUT_SECS`                              | int  | 5         | `10`    | Connect timeout of the default outbound client used by source connectors and OAuth provider calls. Must be 1 to 120 and not exceed `SAFE_HTTP_TOTAL_TIMEOUT_SECS`                                                                                                                                                                                  |
| `SAFE_HTTP_READ_TIMEOUT_SECS`                                 | int  | 20        | `60`    | Read timeout of the same client. Must be 1 to 300 and not exceed `SAFE_HTTP_TOTAL_TIMEOUT_SECS`                                                                                                                                                                                                                                                    |
| `SAFE_HTTP_TOTAL_TIMEOUT_SECS`                                | int  | 30        | `90`    | Total request timeout of the same client. Must be 1 to 600. Webhook delivery has its own `PRO_WEBHOOK_HTTP_TIMEOUT_SECS` and OIDC has `OIDC_HTTP_TIMEOUT_SECS`                                                                                                                                                                                     |
| `DB_POOL_CHECKOUT_TIMEOUT_SECS`                               | int  | 30        | `10`    | How long a request waits for a free pooled database connection before it fails. Must be 1 to 300. Lower it to fail fast under saturation. Raise it for bursty load                                                                                                                                                                                 |
| `SFTP_CONNECT_TIMEOUT_SECS`                                   | int  | 15        | `30`    | TCP connect and SSH handshake budget of the SFTP source connector. Must be 1 to 120                                                                                                                                                                                                                                                                |
| `SFTP_OPERATION_TIMEOUT_SECS`                                 | int  | 8         | `20`    | Budget for one SFTP protocol operation (open, stat, read directory). Must be 1 to 120, and no longer than the inventory and fetch budgets                                                                                                                                                                                                          |
| `SFTP_INVENTORY_TIMEOUT_SECS`                                 | int  | 120       | `600`   | Budget for listing one SFTP source. Must be 5 to 3600. Raise it for very large directory trees                                                                                                                                                                                                                                                     |
| `SFTP_FETCH_TIMEOUT_SECS`                                     | int  | 45        | `300`   | Budget for fetching one document and for reading its bytes. Must be 5 to 1800. It bounds the largest file the connector can pull over a slow link                                                                                                                                                                                                  |
| `PRO_WEBHOOK_MAX_RETRIES`                                     | int  | 5         | `5`     | Webhook delivery attempts. See [Tuning](#tuning)                                                                                                                                                                                                                                                                                                   |
| `OIDC_HTTP_TIMEOUT_SECS`                                      | int  | 5         | `15`    | OIDC discovery and JWKS request timeout. See [Tuning](#tuning)                                                                                                                                                                                                                                                                                     |
| `STORAGE_PRESIGN_TTL_SECS`                                    | int  | 3600      | `7200`  | Presigned URL lifetime. See [Common storage settings](#common)                                                                                                                                                                                                                                                                                     |
| `JWT_EXPIRATION_SECS`                                         | int  | 604800    | `3600`  | Session lifetime. See [Dashboard sign-in with OIDC](#dashboard-sign-in-with-oidc)                                                                                                                                                                                                                                                                  |
| `PRO_AUTO_TUNE_MAX_WALL_CLOCK_SECS`                           | int  | 900       | `3600`  | Auto-tune run budget. See [Auto-tune](#auto-tune)                                                                                                                                                                                                                                                                                                  |
| `PRO_UPLOAD_REPLAY_GRACE_SECS`, `PRO_UPLOAD_GC_INTERVAL_SECS` | int  | 86400, 60 |         | Upload cleanup timing. See [Retention](#retention)                                                                                                                                                                                                                                                                                                 |
| `PRO_INTEGRATION_SYNC_*_SECS`                                 | int  |           |         | Source-connector sync timing. See [Integration sync](#integration-sync)                                                                                                                                                                                                                                                                            |
| `VECTOR_INDEX_*_SECS`                                         | int  |           |         | Vector index worker timing. See [Vector index worker](#vector-index-worker)                                                                                                                                                                                                                                                                        |

The HTTP request timeout of the API itself is configured separately and is not listed here. Set the readiness and liveness probe timings in the Helm chart (`livenessProbe`, `readinessProbe`, `startupProbe`) or in your container orchestrator. The in-process readiness check allows each dependency 2 seconds, which stays below the chart's 3 second probe timeout.

## Long extractions

A large scanned PDF can need more than the default ten minutes. A job that runs out of time fails with `Extraction timed out after 600000ms`. To allow longer, raise the limits below together, because each one caps the others.

1. **Per request.** Send `extraction_timeout_secs` in the request's `config` (JSON body, or the `config` field of a multipart request). For a single file in a multipart request, put it in that file's `config-<filename>` part instead. The value is in seconds.
2. **Deployment ceiling.** `XBERG_EXTRACTION_TIMEOUT_CEILING_SECS` (default 600) is the most any request may ask for. A request above it is clamped to it, with a warning in the log.
3. **Deployment default.** `XBERG_EXTRACTION_TIMEOUT_DEFAULT_SECS` (default 600) is what a request gets when it sends no `extraction_timeout_secs`. Raising only the ceiling leaves every such request at 600 s. It cannot exceed the ceiling.

For a 30-minute budget on every document, set both:

```yaml
configMap:
  XBERG_EXTRACTION_TIMEOUT_CEILING_SECS: "1800"
  XBERG_EXTRACTION_TIMEOUT_DEFAULT_SECS: "1800"
```

With `docker run`, pass the same two names with `-e`. A request can still ask for less than the default.

Pro wraps each extraction in a wall clock of the resolved timeout plus 30 s, so a single-container deployment needs no separate setting. These settings must move with it:

| Setting                       | Default                        | Relationship                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PRO_ATTEMPT_TIMEOUT_SECS`    | 900                            | Replicated mode only. A job attempt is cancelled at this deadline, so it must be greater than the ceiling. Pro refuses to start otherwise. Leave a few minutes of margin for storing the result                                                                                                                                                                                                                           |
| `PRO_SHUTDOWN_DRAIN_SECS`     | 90 (the Helm chart derives it) | A restart waits this long for running extractions, then abandons them. An abandoned job fails with a restart error on the next boot. The Helm chart sets it from `terminationGracePeriodSeconds` minus `shutdown.killMarginSeconds`, which is 3710 s by default and covers a 30-minute extraction. With plain `docker run`, raise this value and the container stop timeout (`docker stop --time`) together for long jobs |
| `XBERG_OCR_CALL_TIMEOUT_SECS` | 1260                           | Deadline of one VLM OCR provider call, not of the document. It matters only when VLM OCR is on. A page that needs longer than this fails regardless of the extraction timeout                                                                                                                                                                                                                                             |
| `XBERG_LLM_CALL_TIMEOUT_SECS` | 300                            | The same for one vision or structured-extraction provider call                                                                                                                                                                                                                                                                                                                                                            |
| `PRO_MAX_CONCURRENCY`         | min(CPUs, 8)                   | Each long extraction holds one slot for its whole duration. Jobs queue behind them                                                                                                                                                                                                                                                                                                                                        |

The lease Pro renews on a running job every 10 s does not depend on how long an extraction takes. The chart probes check the process, the worker and the broker rather than running extractions, so neither needs a change.

## Integration sync

Scheduled source-connector synchronization is off by default. Each integration still needs an explicit opt-in through the API.

| Variable                             | Type   | Default | Example                | Description                                                                                                                              |
| ------------------------------------ | ------ | ------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `PRO_INTEGRATION_SYNC_ENABLED`       | bool   | false   | `true`                 | Run the scheduler. Requires `PRO_INTEGRATION_SYNC_CURSOR_KEY`. Not supported in replicated deployments                                   |
| `PRO_INTEGRATION_SYNC_CURSOR_KEY`    | string | none    | `base64_32_bytes_here` | Stable 32-byte key, base64-encoded, that protects sync cursors. Keep it in a secret, never in a ConfigMap. Required when sync is enabled |
| `PRO_INTEGRATION_SYNC_INTERVAL_SECS` | int    | 300     | `900`                  | Default interval between syncs of one integration. Range 60 to 2592000                                                                   |
| `PRO_INTEGRATION_SYNC_POLL_SECS`     | int    | 5       | `10`                   | How often the scheduler looks for due work. Range 1 to 3600                                                                              |
| `PRO_INTEGRATION_SYNC_LEASE_SECS`    | int    | 300     | `600`                  | Lease an instance holds while syncing one integration. Range 1 to 3600                                                                   |
| `PRO_INTEGRATION_SYNC_CLAIM_LIMIT`   | int    | 4       | `8`                    | Integrations claimed per poll. Range 1 to 1000                                                                                           |
| `PRO_INTEGRATION_SYNC_PAGE_LIMIT`    | int    | 100     | `500`                  | Items fetched per provider page. Range 1 to 10000                                                                                        |
| `SFTP_HOST_ALLOWLIST`                | string | empty   | `sftp.example.com:22`  | Exact comma-separated `host:port` destinations the SFTP connector may reach. Empty refuses every SFTP integration                        |

## Vector index worker

The embedded worker builds vector indexes in a supervised child process. The Helm chart exposes these as `vectorIndexWorker.*` values.

| Variable                                   | Type | Default | Example | Description                                                                                                                                                                      |
| ------------------------------------------ | ---- | ------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VECTOR_INDEX_DDL_STATEMENT_TIMEOUT_SECS`  | int  | 3600    | `7200`  | Time limit for one index build. Maximum 43200. Chart value `vectorIndexWorker.ddlStatementTimeoutSeconds`                                                                        |
| `VECTOR_INDEX_DDL_MAINTENANCE_WORK_MEM_MB` | int  | 64      | `256`   | PostgreSQL `maintenance_work_mem` per build, in MiB (16 to 2048). Raise it only within the database's memory budget. Chart value `vectorIndexWorker.maintenanceWorkMemMb`        |
| `VECTOR_INDEX_DDL_WAIT_TIMEOUT_SECS`       | int  | derived | `5400`  | How long a caller waits for an index job. The default derives from the build timeout, and a smaller value is refused. Chart value `vectorIndexWorker.ddlWaitTimeoutSeconds`      |
| `VECTOR_INDEX_WORKER_SHUTDOWN_GRACE_SECS`  | int  | 3660    | `3660`  | Grace the worker gets to finish a build on shutdown (maximum 43260). It must cover the build timeout plus 60 seconds. Chart value `vectorIndexWorker.shutdownGracePeriodSeconds` |

## Extraction models and limits

| Variable                                 | Type   | Default         | Example                        | Description                                                                                                                                                                |
| ---------------------------------------- | ------ | --------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `XBERG_DATA_POLICY`                      | string | `standard`      | `extraction_only`              | `standard` or `extraction_only`. `extraction_only` denies RAG reads and writes. `strict_sql` is refused. The Helm chart sets it from `dataPolicy`                          |
| `XBERG_SECURITY_LIMITS_CEILING`          | JSON   | built-in limits | `{"max_table_cells": 5000000}` | Deployment ceiling for client-supplied `security_limits`. Omitted fields keep the built-in values. A malformed value stops startup                                         |
| `XBERG_IMAGE_CLASSIFY`                   | bool   | false           | `true`                         | Classify images with a vision model. Requires `XBERG_VLM_OCR_MODEL`. It replaces the removed `XBERG_DISABLE_IMAGE_CLASSIFY` switch, and setting the old name stops startup |
| `XBERG_VLM_OCR_MODEL`                    | string | unset           | `ollama/qwen2.5vl:7b`          | Default model for VLM OCR and image classification                                                                                                                         |
| `XBERG_STRUCTURED_SCAN_MAX_COVERAGE`     | float  | 0.10            | `0.2`                          | Text coverage at or below which a page is treated as a scan                                                                                                                |
| `XBERG_STRUCTURED_DIGITAL_MIN_COVERAGE`  | float  | 0.90            | `0.8`                          | Text coverage at or above which a page is treated as digital text                                                                                                          |
| `XBERG_STRUCTURED_DOCX_TEXT_MIN_DENSITY` | float  | 200.0           | `150.0`                        | Minimum text density for a DOCX to take the text-only path                                                                                                                 |
| `XBERG_STRUCTURED_ENABLE_FALLBACK`       | bool   | false           | `true`                         | Escalate a low-confidence text-only run to vision                                                                                                                          |
| `XBERG_STRUCTURED_FALLBACK_THRESHOLD`    | float  | 0.6             | `0.7`                          | Confidence below which the fallback escalates                                                                                                                              |
| `XBERG_STRUCTURED_MAX_OUTPUT_TOKENS`     | int    | 8000            | `16000`                        | Output-token ceiling per model call                                                                                                                                        |
| `XBERG_STRUCTURED_MAX_INPUT_TOKENS`      | int    | 800000          | `200000`                       | Input-token ceiling per model call                                                                                                                                         |
| `XBERG_STRUCTURED_MAX_PARALLEL_CALLS`    | int    | 4               | `2`                            | Parallel model calls per document                                                                                                                                          |
| `XBERG_STRUCTURED_MAX_EXCERPT_CHARS`     | int    | 200000          | `100000`                       | Prompt excerpt budget in characters                                                                                                                                        |
| `XBERG_STRUCTURED_MAX_PAGE_EDGE`         | int    | 1568            | `1024`                         | Longest edge in pixels of a rasterized page sent to a model. `0` disables downscaling                                                                                      |
| `RAG_RETRIEVE_CONCURRENCY_PER_PROJECT`   | int    | 4               | `8`                            | Concurrent RAG retrievals per project                                                                                                                                      |

A malformed value in any row stops startup instead of falling back to the default.

## Logging, deployment label and UI container

| Variable                                                        | Type   | Default                 | Example          | Description                                                                                                                                                                                           |
| --------------------------------------------------------------- | ------ | ----------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RUST_LOG`                                                      | string | `info`                  | `info,pro=debug` | `tracing` filter directive. It overrides `LOG_LEVEL`, and the supervisor passes it to its children                                                                                                    |
| `XBERG_INTERNAL_EMAIL_DOMAINS`                                  | string | empty                   | `example.com`    | Comma-separated owner email domains that analytics events treat as internal traffic                                                                                                                   |
| `ENABLE_PROFILING`                                              | bool   | false                   | `true`           | Serve `/debug/pprof/*` on the metrics port. Only builds compiled with the `profiling` feature honor it, and the release image does not                                                                |
| `XBERG_ENV`                                                     | string | `development`           | `production`     | Deployment label on analytics events: `development`, `staging` or `production`. Any other value stops startup                                                                                         |
| `BACKEND_API_URL`, `DATA_PLANE_API_URL`, `PRO_INTERNAL_API_URL` | string | `http://127.0.0.1:8080` |                  | Where the bundled UI reaches the API inside the container. The image sets them. Change them only when the UI runs apart from the API                                                                  |
| `NEXT_PUBLIC_*`                                                 | string |                         |                  | Browser-visible UI settings. Values the image was built with are fixed. The OIDC ones are served from `/runtime-env.js` at run time (see [Dashboard sign-in with OIDC](#dashboard-sign-in-with-oidc)) |

## Set by the image, the chart or the supervisor

Do not set these by hand. They are listed so an audit of the environment accounts for every name Pro reads.

| Variable                                                                                                                                                                                                                                                                                                                                 | Set by                      | Purpose                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PRO_DEPLOYMENT_MODE`, `PRO_DEPLOYMENT_INSTALLATION_ID`, `PRO_DEPLOYMENT_GENERATION_ID`, `PRO_DEPLOYMENT_IMAGE_DIGEST`, `PRO_DEPLOYMENT_CONFIG_DIGEST`, `PRO_DEPLOYMENT_POLICY_DIGEST`, `PRO_DEPLOYMENT_STORAGE_WRITE_PROTOCOL`                                                                                                          | Helm chart (`deployment.*`) | `singleton` (default) or `replicated` mode, the identity of a replicated generation and its storage write protocol (version 2, replicated mode only) |
| `PRO_WORKER_READINESS_URL`, `METRICS_ADDR`, `VECTOR_INDEX_BROKER_BINARY`, `VECTOR_INDEX_BROKER_SOCKET`, `VECTOR_INDEX_BROKER_SOCKET_ACCESS`, `VECTOR_INDEX_BROKER_BOOTSTRAP_FD`, `VECTOR_INDEX_BROKER_READY_FD`, `VECTOR_INDEX_BROKER_DATABASE_URL`, `VECTOR_INDEX_QUEUE_DATABASE_URL`, `VECTOR_INDEX_*_LOGIN`, `PRO_API_ENVIRONMENT_FD` | Supervisor and chart        | Wiring between the API, the worker and the broker                                                                                                    |
| `NEXT_CACHE_ROOT`, `PORT`, `HOSTNAME`, `NODE_ENV`                                                                                                                                                                                                                                                                                        | Image and supervisor        | The bundled UI server                                                                                                                                |
| `XBERG_CACHE_DIR`, `XBERG_OCR_MODEL_CACHE_DIR`, `TESSDATA_PREFIX`, `TREE_SITTER_LANGUAGE_PACK_CACHE_DIR`, `HF_ENDPOINT`, `HF_HUB_OFFLINE`                                                                                                                                                                                                | Image                       | Model and data locations. See [OCR data and models](#ocr-data-and-models)                                                                            |
| `XBERG_LICENSE_PUBLIC_KEY`, `OIDC_MOCK`, `PRO_OIDC_ALLOW_EMULATOR`, `PRO_NATIVE_DEV_BOOTSTRAP`                                                                                                                                                                                                                                           | Development builds only     | The release image refuses or ignores them                                                                                                            |

## Configuration file

Pro reads an optional TOML file at `/config/xberg-pro.toml`. Set `XBERG_PRO_CONFIG_FILE` to read it from another path.

| Variable                | Type   | Default                  | Example               | Description                    |
| ----------------------- | ------ | ------------------------ | --------------------- | ------------------------------ |
| `XBERG_PRO_CONFIG_FILE` | string | `/config/xberg-pro.toml` | `/etc/xberg/pro.toml` | Path to the configuration file |

A missing file is not an error. Pro starts with the same defaults it would use if you never configured one. A file that is present but unreadable or malformed stops startup, and so does an unknown key.

The file holds one section today, `[auto_tune.search]`. It sets the search space that auto-tune sweeps:

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

### Which source wins

`max_trials` is the only key both sources set. Pro resolves it in this order:

1. `PRO_AUTO_TUNE_MAX_TRIALS`, if it is set.
2. `max_trials` in `[auto_tune.search]`, if the file sets it.
3. The built-in default.

A per-request `max_trials` is clamped to whichever ceiling the chain produces. It can lower the ceiling for one run but never raise it.

## Volumes

For local filesystem storage, mount a volume at `STORAGE_FS_ROOT`:

```bash
docker run -v /host/path:/data/xberg \
  -e STORAGE_FS_ROOT=/data/xberg \
  ghcr.io/xberg-io/xberg-pro:latest
```

For cache storage (if `CACHE_ENABLED=true`), mount `CACHE_DIR`:

```bash
docker run -v /host/cache:/var/cache/xberg \
  -e CACHE_DIR=/var/cache/xberg \
  ghcr.io/xberg-io/xberg-pro:latest
```

### OCR data and models

The image carries the same Tesseract language packs as the Enterprise worker image (`eng`, `deu`, `fra`, `spa`, `nld`, `kor`, `chi_sim`, `osd`) under `TESSDATA_PREFIX`, so OCR in those languages needs no network access and both tiers OCR with the same data.

The image also carries the complete pinned classic OCR catalog: the PaddleOCR artifacts, the Sceptre recognizers and the shared CRAFT detector. Those weights live in a read-only image layer under `/usr/share/xberg/ocr-models/hub`, so mounting or replacing `/data` does not hide them.

Other models, including layout and table detection, embeddings, rerankers and enrichment models, download on first use into the persistent runtime caches. `XBERG_CACHE_DIR` remains `/data/models`, and the image does not redirect `HF_HOME`. Keep those caches on the same persistent volume as `STORAGE_FS_ROOT` and `CACHE_DIR`. The Helm chart mounts `/data` from the StatefulSet's claim, so a restart or reschedule does not download them again.

For an air-gapped install, pre-seed only the non-classic models you need on a machine with egress, then copy the `/data` volume before the first start. A Tesseract language pack outside the bundled set also needs egress or the same pre-seeding. See [Air-gapped installs](/operate/air-gapped/).

### Fronting Pro with your own proxy

`POST /v1/extract` answers 202 as soon as the upload lands, but the upload itself can take minutes on a slow link. Set the proxy's backend or upstream timeout to at least 300 seconds. The Helm chart sets `gke.backendConfig.timeoutSec: 300` for the GKE load balancer, whose default is 30 seconds.

Pro itself does not cut off an upload that is still arriving. `HTTP_REQUEST_TIMEOUT_SECS` starts when the body is fully received, and only a body silent for `HTTP_BODY_IDLE_TIMEOUT_SECS` is refused with `408`. A proxy timeout shorter than the slowest upload still wins, so the AWS ALB idle timeout, an Istio route `timeout` (the chart's `istio.virtualService.timeout`, unset by default) and nginx `proxy-read-timeout` and `proxy-send-timeout` must each be at least as long as `HTTP_BODY_IDLE_TIMEOUT_SECS` and the longest upload you expect.

## Rotating the integration KEK

`INTEGRATION_KEK` encrypts every stored OAuth token and bring-your-own client secret. Rotate it in three steps. Do not skip the check in step three, because destroying the old key while a credential still needs it makes that credential unreadable.

1. Set `INTEGRATION_KEK` to the new key and `INTEGRATION_KEK_PREVIOUS` to the old one, then restart. Each stored credential names the key that wrapped it, so a read opens it with the previous key and writes it back under the new one. Nothing breaks while both are set.
2. Wait. A background sweep re-wraps every credential in `oauth_connections` and `integrations` that no read has touched, in batches, every five minutes.
3. Watch `integration_kek_rewrap_complete`. It reads `1` only when no row is readable by the previous key alone. Then remove `INTEGRATION_KEK_PREVIOUS` and restart.

### Metrics

The sweep publishes its state after every pass, so the decision does not need the log.

| Metric                                  | Meaning                                                                                                                           |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `integration_kek_rows_on_previous_key`  | Rows in both tables the sweep has not migrated. This is the whole backlog, not one batch, and it must reach zero.                 |
| `integration_kek_rows_unreadable`       | Rows in the last batch that neither key opens. They do not get worse when you retire the previous key, but they are not migrated. |
| `integration_kek_rewrap_complete`       | `1` when `INTEGRATION_KEK_PREVIOUS` can be removed.                                                                               |
| `integration_kek_rewrap_failures_total` | Running count of failing rows, labeled `reason` (`unreadable`, `write_conflict`).                                                 |

### Stuck rows

The sweep writes the reason onto every row it cannot migrate, in `oauth_connections.key_rotation_error` and `integrations.key_rotation_error`. While the backlog is above zero, each pass also logs one warning per stuck row, with the project, the row and the reason. No API endpoint exposes the list. Query the two columns to see what holds the rotation open:

```sql
SELECT id, project_id, provider, key_rotation_error FROM oauth_connections WHERE key_rotation_error IS NOT NULL;
SELECT id, project_id, name, key_rotation_error FROM integrations WHERE key_rotation_error IS NOT NULL;
```

An `unreadable` row predates the previous key, or names a key the deployment no longer holds. Re-enter its credentials, which stores a fresh data key under the current key and clears the error on the next pass. A `write_conflict` row lost a race with a concurrent credential write and normally clears itself on the next pass.

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

The default Pro profile uses a one-replica StatefulSet with a `/data` PersistentVolumeClaim for models, RAG caches and local results. A restart or reschedule preserves those caches. Configure it through the chart's `values.yaml` and follow [Install Pro with Helm](/start/pro-helm/).

The registered `extraction_only` profile supports fixed Deployment replicas and red/green generations with shared PostgreSQL and object storage. Manage generation transitions through native Kubernetes lifecycle control or a customer-installed Argo Rollouts. See [Deployment operator](/operate/deployment-operator/).

The default singleton chart sets the claim to 100 GiB. About 20 GiB is reserved for the model caches and the bounded 10 GiB result cache. Accepted documents and results consume the remainder and are retained with the corpus. Increase `persistence.size` when that retained corpus needs more than roughly 80 GiB.

The size value creates fresh claims and does not resize an existing PVC. Set `persistence.claimTemplateMode: fresh` only for the initial install. Live Helm upgrades preserve the installed immutable StatefulSet claim template's metadata and spec automatically, including when the stored install values still contain `fresh`. Argo CD, GitOps and other cluster-blind renderers must switch to `persistence.claimTemplateMode: existing` after the initial sync and supply `persistence.existingClaimTemplate` with the captured data template metadata and spec. Follow the capture command in [Install Pro with Helm](/start/pro-helm/). The optional `persistence.existingClaimTemplateSize` only cross-checks that captured request, and size alone is rejected. Expand the PVC directly through a StorageClass with `allowVolumeExpansion: true`, and retain the original captured template.
