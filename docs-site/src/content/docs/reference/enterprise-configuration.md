---
title: Xberg Enterprise configuration
description: Environment variable reference for the Xberg Enterprise services, grouped by task, with code and Helm chart defaults.
sidebar:
  order: 3
---

**Available in:** Enterprise

Every Enterprise service reads its configuration from environment variables at startup. A malformed or out-of-range value stops the service and names the variable. Nothing falls back silently to a default.

With the Helm chart, set a variable in the service's `env` map: `api.env`, `backend.env`, `worker.env`, `workerGpu.env`, `rag.env` or `webhooks.env`. Put secrets in `extraEnv` or `extraEnvFrom`. The chart's `values.yaml` lists the operator-relevant variables as commented entries in each map. See [Install Enterprise with Helm](/start/enterprise-helm/) for the install procedure.

**Default column.** One value means the code default and the chart default agree. Where the chart sets a different value, the cell reads `code / chart`.

Related settings live on their own pages: storage in [Storage](/operate/storage/) and [AWS storage](/operate/aws-storage/), RAG in [RAG configuration](/operate/rag-config/), and identity in [Authentication](/concepts/authentication/). Xberg Pro has its own [configuration reference](/reference/pro-configuration/). Variables that both tiers read (database, storage, OIDC, tracing) behave the same way there.

| Task                                        | Section                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| Connect the database and message broker     | [Database and messaging](#database-and-messaging)                        |
| Set storage and timeouts for outbound calls | [Storage and outbound calls](#storage-and-outbound-calls)                |
| Expose the API safely                       | [API service](#api-service)                                              |
| Serve a private MCP endpoint                | [Private MCP listener](#private-mcp-listener)                            |
| Run the dashboard backend, sign-in and sync | [Backend service](#backend-service)                                      |
| Size workers and allow long extractions     | [Worker service](#worker-service), [Long extractions](#long-extractions) |
| Tune crawling                               | [Crawling](#crawling)                                                    |
| Deliver webhooks                            | [Webhook service](#webhook-service)                                      |
| Run RAG                                     | [RAG service](#rag-service)                                              |

## Shared by all services

### Database and messaging

Every service that holds a PostgreSQL pool or a NATS connection reads these.

| Variable                                                            | Default                 | Description                                                                                                                                                                                                                             |
| ------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                      | none                    | PostgreSQL URL of the service's application login. The chart injects it from a per-service Secret.                                                                                                                                      |
| `MAINTENANCE_DATABASE_URL`                                          | none                    | PostgreSQL URL of the maintenance login, a member of `xberg_maintenance`. The backend requires it. Chart value `maintenanceDatabaseUrl`.                                                                                                |
| `DB_POOL_SIZE`                                                      | 16                      | Connections in the application pool. Must be above 0.                                                                                                                                                                                   |
| `DB_POOL_CHECKOUT_TIMEOUT_SECS`                                     | 30                      | How long a request waits for a free connection, 1 to 300. Lower it to fail fast under saturation.                                                                                                                                       |
| `DB_STATEMENT_TIMEOUT_MS`                                           | 30000                   | PostgreSQL `statement_timeout` per connection.                                                                                                                                                                                          |
| `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS`                                 | 60000                   | PostgreSQL `idle_in_transaction_session_timeout` per connection.                                                                                                                                                                        |
| `DB_LOCK_TIMEOUT_MS`                                                | 5000                    | PostgreSQL `lock_timeout` per connection.                                                                                                                                                                                               |
| `DATABASE_TLS_ENABLED`                                              | unset                   | Force TLS to PostgreSQL. Unset follows the connection URL.                                                                                                                                                                              |
| `NATS_URL`                                                          | `nats://localhost:4222` | NATS server. The chart sets it from the `nats` subchart.                                                                                                                                                                                |
| `NATS_USER`, `NATS_PASSWORD`                                        | unset                   | NATS credentials. The chart injects them from a per-service Secret.                                                                                                                                                                     |
| `NATS_TLS_ENABLED`                                                  | `false`                 | Connect to NATS over TLS. Accepts `true`, `false`, `1`, `0`, `yes` and `no`.                                                                                                                                                            |
| `NATS_NUM_REPLICAS`                                                 | 1                       | JetStream replica count the services provision with. Chart value `natsNumReplicas`.                                                                                                                                                     |
| `natsResultsRetentionSecs` (chart value)                            | 43200                   | How long a finished job's result stays readable in the `results` bucket, 3600 to 2592000 seconds. Unset leaves the bucket unchanged. Set it only when every service is current, because older builds refuse a manifest that carries it. |
| `NATS_CONSUMER_NAME` and the other `NATS_*_CONSUMER_NAME` variables | from the manifest       | Durable consumer names. The chart sets them. Override only to match a manifest you changed.                                                                                                                                             |

### Storage and outbound calls

| Variable                         | Default      | Description                                                                                                                                                                   |
| -------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STORAGE_PROVIDER`               | none / `gcs` | Object storage backend: `s3`, `gcs` or `azure`. Set it on the API, worker and RAG `env` maps. See [Storage](/operate/storage/).                                               |
| `STORAGE_BUCKET`                 | none / empty | Bucket or container name.                                                                                                                                                     |
| `SAFE_HTTP_CONNECT_TIMEOUT_SECS` | 5            | Connect timeout of the default outbound client (OAuth providers, LLM endpoint checks). 1 to 120, not above the total.                                                         |
| `SAFE_HTTP_READ_TIMEOUT_SECS`    | 20           | Read timeout of the same client. 1 to 300, not above the total.                                                                                                               |
| `SAFE_HTTP_TOTAL_TIMEOUT_SECS`   | 30           | Total request timeout of the same client. 1 to 600.                                                                                                                           |
| `XBERG_LLM_CALL_TIMEOUT_SECS`    | 300          | Deadline for one LLM provider call, including client retries. 30 to 3600.                                                                                                     |
| `XBERG_OCR_CALL_TIMEOUT_SECS`    | 1260         | Deadline for one VLM OCR call. 60 to 7200 and not below `XBERG_LLM_CALL_TIMEOUT_SECS`.                                                                                        |
| `OIDC_HTTP_TIMEOUT_SECS`         | 5            | Timeout for each OIDC discovery and JWKS request, 1 to 120. The backend validates it at startup.                                                                              |
| `VLM_ENDPOINT_ALLOWLIST`         | empty        | Hosts (exact or `.`-prefixed suffix) that caller-supplied LLM base URLs may reach. Empty allows public hosts only. List hosts to opt into internal endpoints. Set on the API. |

The SFTP connector budgets `SFTP_CONNECT_TIMEOUT_SECS`, `SFTP_OPERATION_TIMEOUT_SECS`, `SFTP_INVENTORY_TIMEOUT_SECS` and `SFTP_FETCH_TIMEOUT_SECS` apply to the backend and the worker. Their ranges match the [Pro reference](/reference/pro-configuration/#timeouts-and-shutdown). `SFTP_HOST_ALLOWLIST` lists the exact `host:port` pairs the connector may reach and defaults to empty, which refuses every SFTP integration.

### Telemetry and runtime labels

| Variable                      | Default            | Description                                                                                                                                                                          |
| ----------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OTEL_SERVICE_NAME`           | `xberg-enterprise` | Service name on exported telemetry. The chart sets a per-component name.                                                                                                             |
| `OTEL_METRIC_EXPORT_INTERVAL` | 15000              | OTLP metrics push interval in milliseconds, 1000 to 3600000. `/metrics` scrapes are unaffected.                                                                                      |
| `CIRCUIT_BREAKER_OPEN_SECS`   | 30                 | How long a provider circuit (database pool, embedding and LLM providers) sheds calls after 5 consecutive failures, 1 to 600. The RAG ingest redelivery delay is this value plus 5 s. |
| `XBERG_ENV`                   | `development`      | Deployment label on analytics events: `development`, `staging` or `production`. An unknown label stops the service.                                                                  |

### Settings the chart exposes as values

- `global.observability.otlpEndpoint`, `tracesEndpoint`, `logsEndpoint` and `metricsEndpoint` set `OTEL_EXPORTER_OTLP_ENDPOINT` and the three per-signal `OTEL_EXPORTER_OTLP_{TRACES,LOGS,METRICS}_ENDPOINT` variables on every service. A per-signal endpoint overrides the shared one for that signal. Set alone, it turns on that signal only. A component's `env` map can override one for that pod or, with an empty value, remove it. Any of them opens the collector egress rule in the NetworkPolicies. See [Observability](/observability/).
- `structuredLlm.thresholds.*` sets the `XBERG_STRUCTURED_*` thresholds on the workers: `scanMaxCoverage`, `digitalMinCoverage`, `docxTextMinDensity`, `enableFallback`, `fallbackThreshold`, `maxOutputTokens`, `maxInputTokens`, `maxParallelCalls`, `maxExcerptChars` and `maxPageEdge`. An empty value keeps the engine default. Names, defaults and ranges are in the [Pro reference](/reference/pro-configuration/#extraction-models-and-limits).
- `<component>.livenessProbe` and `<component>.readinessProbe` (api, backend, rag, webhooks, worker, workerGpu, frontend) override `initialDelaySeconds`, `periodSeconds`, `timeoutSeconds`, `successThreshold` and `failureThreshold` key by key. The path and port stay fixed. `api.startupProbe` and `rag.startupProbe` are values too.
- `api.terminationGracePeriodSeconds`, `worker.terminationGracePeriodSeconds` and `workerGpu.terminationGracePeriodSeconds` set the pod grace period and the matching `*_TERMINATION_GRACE_SECS` variable together.

## API service

### Listener, limits and edge behavior

| Variable                          | Default                            | Description                                                                                                                                                             |
| --------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REST_ADDR`                       | `0.0.0.0:8080`                     | Listen address.                                                                                                                                                         |
| `MAX_UPLOAD_BYTES`                | 104857600                          | Largest decoded document accepted, in bytes (100 MiB). Above 0.                                                                                                         |
| `MAX_BODY_SIZE`                   | derived (about 140 MB) / 140334424 | Raw request ceiling. The ingress derives its limit from it.                                                                                                             |
| `CORS_ALLOWED_ORIGINS`            | empty                              | Comma-separated browser origins (`scheme://host[:port]`) allowed to call the API. Empty sends no CORS headers. `*` allows any origin and is for local development only. |
| `HTTP_REQUEST_TIMEOUT_SECS`       | 30                                 | Handler timeout, from the body being fully received to the response head. A slower handler gets `504`. `0` disables it. Maximum 86400.                                  |
| `HTTP_BODY_IDLE_TIMEOUT_SECS`     | 60                                 | Longest silence while a request body streams. A stalled upload gets `408`. An upload that keeps arriving is never cut off. `0` disables it. Maximum 86400.              |
| `RATE_LIMIT_BURST`                | 300                                | Requests one caller may send at once on authenticated routes. `0` disables the limit. A rejected request gets `429` with `Retry-After` and `x-ratelimit-*` headers.     |
| `RATE_LIMIT_PER_SECS`             | 60                                 | Seconds over which `RATE_LIMIT_BURST` refills evenly.                                                                                                                   |
| `API_TRUSTED_PROXY_CIDRS`         | unset                              | Reverse-proxy CIDRs trusted to supply the client address. Set it with `API_TRUSTED_PROXY_HOPS`. The public data-room limits key on that address.                        |
| `API_TRUSTED_PROXY_HOPS`          | unset                              | Number of trusted proxy hops.                                                                                                                                           |
| `API_TERMINATION_GRACE_SECS`      | 30                                 | The pod's grace period, 30 to 3600. The chart sets it from `api.terminationGracePeriodSeconds` (30, or 120 in replicated mode). Do not set it by hand.                  |
| `CRAWL_EVENT_STREAMS_PER_PROJECT` | 8                                  | Crawl event streams one project may hold open.                                                                                                                          |
| `RAG_RETRIEVE_TIMEOUT_SECS`       | 30                                 | Deadline for one RAG retrieve request. 1 to 300. Keep it above `RAG_QUERY_EMBED_TIMEOUT_SECS` plus the longest per-collection rerank timeout.                           |

When you front the API with your own proxy, give it a timeout at least as long as `HTTP_BODY_IDLE_TIMEOUT_SECS` and your slowest upload.

### Replicated mode

Replicated deployments protect submissions and result reads. The chart sets these from `deployment.*`.

| Variable                                   | Default  | Description                                                                                            |
| ------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------ |
| `ENTERPRISE_DEPLOYMENT_MODE`               | `legacy` | `legacy` or `replicated`.                                                                              |
| `ENTERPRISE_PROCESSING_TIMEOUT_SECS`       | 900      | Deadline of one attempt of a protected submission, 30 to 86400. Raise it above the extraction ceiling. |
| `ENTERPRISE_RESULT_READ_MAX_BYTES`         | 8388608  | Largest protected result read.                                                                         |
| `ENTERPRISE_RESULT_READ_MAX_ENCODED_BYTES` | 16777216 | Encoded size ceiling for a protected result read.                                                      |
| `ENTERPRISE_RESULT_READ_TIMEOUT_SECS`      | 30       | Budget for one protected result read.                                                                  |
| `ENTERPRISE_RESULT_READ_CAPACITY`          | 4        | Protected result reads that run at once.                                                               |

### Data rooms

See [Data rooms](/guides/data-rooms/). Each value is a whole number above zero. A per-project override row can change them for one project.

| Variable                                        | Default                               | Description                                                                                                                                                            |
| ----------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATA_ROOMS_ENABLED`                            | `true`                                | Turn data rooms on.                                                                                                                                                    |
| `DATA_ROOM_MAX_ROOMS`                           | 100                                   | Rooms per project.                                                                                                                                                     |
| `DATA_ROOM_MAX_ITEMS_PER_ROOM`                  | 500                                   | Items per room.                                                                                                                                                        |
| `DATA_ROOM_MAX_MEMBERS_PER_ROOM`                | 100                                   | Members per room.                                                                                                                                                      |
| `DATA_ROOM_MAX_PENDING_INVITATIONS`             | 50                                    | Open invitations per room.                                                                                                                                             |
| `DATA_ROOM_INVITATION_TTL_HOURS`                | 72                                    | Hours an invitation stays valid.                                                                                                                                       |
| `DATA_ROOM_PUBLIC_VIEW_REQUESTS_PER_MINUTE`     | 60                                    | Public view requests per client address and minute.                                                                                                                    |
| `DATA_ROOM_PUBLIC_DOWNLOAD_REQUESTS_PER_MINUTE` | 10                                    | Public download requests per client address and minute.                                                                                                                |
| `DATA_ROOM_INVITATION_REQUESTS_PER_MINUTE`      | 30                                    | Invitation requests per minute.                                                                                                                                        |
| `AUTH_ALLOWED_EMAIL_DOMAINS`                    | from `global.authAllowedEmailDomains` | Sign-in domains that may receive room invitations. With no list, the API refuses every invitation. Set it here only to give the API a different list than the backend. |

### Private MCP listener

The API can serve MCP (version 2026-07-28) on a private `/mcp` listener. It is off by default, and public REST and the default ingress never serve it. Clients send a project API key as an `Authorization: Bearer` credential. Each listener serves one mode:

| Mode         | Tools                                                                        | Requires                                                                                                                        |
| ------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `rag`        | `list_collections`, `list_documents`, `retrieve`                             | Legacy (non-replicated) mode, the standard data policy, `api.enabled`, `rag.enabled` and `rag.mcpRetrieveRpcEnabled`.           |
| `extraction` | `extract_document`, `get_extraction_job_status`, `get_extraction_job_result` | A registered replicated generation with `dataPolicy: extraction_only`, the protected extraction runtime and its result storage. |

| Variable                 | Default | Description                                                                                                                                       |
| ------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MCP_LISTENER_ENABLED`   | `false` | Start the listener.                                                                                                                               |
| `MCP_LISTENER_MODE`      | `rag`   | `rag` or `extraction`.                                                                                                                            |
| `MCP_LISTENER_ADDR`      | none    | Socket address with a fixed port, such as `127.0.0.1:8095`. Required when enabled.                                                                |
| `MCP_ALLOWED_HOSTS`      | none    | Comma-separated `host:port` authorities the listener accepts. Required when enabled.                                                              |
| `MCP_ALLOWED_ORIGINS`    | empty   | Comma-separated HTTP or HTTPS origins with explicit ports. Leave it empty for clients that send no `Origin` header.                               |
| `MCP_CURSOR_SIGNING_KEY` | none    | 32 bytes as unpadded base64url, which signs pagination cursors. Use the same key on every API replica behind one listener. Required when enabled. |

On Helm, set these chart values. The chart rejects the variables above in `api.env` and `api.extraEnv`:

| Chart value                               | Default | Description                                                                                                                                         |
| ----------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mcp.enabled`                             | `false` | Enable the listener on the API.                                                                                                                     |
| `mcp.mode`                                | `rag`   | `rag` or `extraction`.                                                                                                                              |
| `mcp.port`                                | 8095    | Listener port. It cannot be 8080 or 9090.                                                                                                           |
| `mcp.cursorSigningKeySecret.name`, `.key` | empty   | Secret and key holding the signing key. Required when enabled.                                                                                      |
| `rag.mcpRetrieveRpcEnabled`               | `false` | `rag` mode only. Lets the RAG worker answer MCP retrieval. Leave it off for `extraction`.                                                           |
| `migrations.mcpRagReleaseExecute`         | `false` | `rag` mode only. Grants the application login the retrieval routines during the maintenance grants Job. A reconciliation with `false` removes them. |

The chart binds the listener to `127.0.0.1:<port>`, allows `127.0.0.1:<port>` and `localhost:<port>`, and sets no origins. It adds no Service or ingress route. Reach it with `kubectl port-forward pod/<pod-name> 8095:8095` and connect to `http://127.0.0.1:8095/mcp`. Outside Helm, apply the grants in your maintenance procedure with `MCP_RAG_RELEASE_EXECUTE=true`. REST keeps serving while the listener waits for the grants.

### Auto-tune

Access is controlled per project by entitlement. These variables bound resource use. See the [auto-tune guide](/guides/auto-tune/).

| Variable                           | Default | Description                                                         |
| ---------------------------------- | ------- | ------------------------------------------------------------------- |
| `AUTOTUNE_MAX_CONCURRENCY`         | 8       | Trials in flight per run.                                           |
| `AUTOTUNE_MAX_TRIALS`              | 64      | Ceiling on trials per run.                                          |
| `AUTOTUNE_MAX_DOCUMENTS`           | 50      | Ceiling on sample documents per run.                                |
| `AUTOTUNE_MAX_ACTIVE_JOBS`         | 3       | Active runs per project.                                            |
| `AUTOTUNE_MAX_WALL_CLOCK_SECS`     | 3600    | Time budget for one run, at most 30 days.                           |
| `AUTOTUNE_TRIAL_TIMEOUT_SECS`      | 900     | Timeout for one trial, at most 30 days.                             |
| `AUTOTUNE_TOLERANCE`               | 0.01    | Score distance under which two configurations tie. Between 0 and 1. |
| `AUTOTUNE_ESTIMATED_PAGES_PER_DOC` | 5       | Page estimate used to meter a trial before its document is read.    |

## Backend service

### Sign-in and identity

| Variable                                                                                     | Default      | Description                                                                                         |
| -------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------- |
| `SERVER_PORT`                                                                                | 8080 / 8081  | Listen port. The chart sets 8081.                                                                   |
| `AUTH_ENABLED`                                                                               | `false`      | Turn on OIDC sign-in for the dashboard API. Requires `OIDC_ISSUER_URL` and `OIDC_AUDIENCE`.         |
| `DATABASE_POOL_SIZE`                                                                         | unset        | Pool size for the backend only. Unset uses `DB_POOL_SIZE`.                                          |
| `DEPLOYMENT_TIER`                                                                            | `enterprise` | Tier name the health endpoint reports.                                                              |
| `SAML_SP_ENTITY_ID`, `SAML_SP_ACS_URL`, `SAML_SP_PRIVATE_KEY_PEM`, `SAML_SP_CERTIFICATE_PEM` | unset        | SAML service-provider settings. Set all four or none. See [SAML single sign-on](/guides/saml-sso/). |
| `XBERG_ALLOW_INSECURE_WEBHOOKS`                                                              | `false`      | Allow `http://` webhook URLs. For development only.                                                 |

The chart also sets `CORS_ALLOWED_ORIGINS`, `HTTP_REQUEST_TIMEOUT_SECS`, `HTTP_BODY_IDLE_TIMEOUT_SECS`, `RATE_LIMIT_BURST` and `RATE_LIMIT_PER_SECS` on the backend, with the same meaning and defaults as in the [API service](#listener-limits-and-edge-behavior). `LOGIN_RATE_LIMIT_BURST` (10) and `LOGIN_RATE_LIMIT_PER_SECS` (60) limit `POST /auth/login` per client address.

### Source-connector sync

| Variable                         | Default | Description                                                        |
| -------------------------------- | ------- | ------------------------------------------------------------------ |
| `INTEGRATION_SYNC_ENABLED`       | `false` | Run the sync scheduler in the backend.                             |
| `INTEGRATION_SYNC_CURSOR_KEY`    | unset   | Base64 key that seals sync cursors. Required when sync is enabled. |
| `INTEGRATION_SYNC_INTERVAL_SECS` | 300     | Gap between syncs of one connection, 60 to 2592000.                |
| `INTEGRATION_SYNC_POLL_SECS`     | 5       | Scheduler poll interval.                                           |
| `INTEGRATION_SYNC_LEASE_SECS`    | 300     | Lease a scheduler holds on a connection.                           |
| `INTEGRATION_SYNC_CLAIM_LIMIT`   | 4       | Connections claimed per poll.                                      |
| `INTEGRATION_SYNC_PAGE_LIMIT`    | 100     | Documents fetched per page.                                        |

### Public sandbox

The sandbox lets visitors try extraction without an account. It stays off until `SANDBOX_API_URL` is set.

| Variable                                                                                     | Default    | Description                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SANDBOX_API_URL`                                                                            | unset      | API the sandbox proxies to. Unset disables the sandbox.                                                                                                                                                        |
| `SANDBOX_PUBLIC_API_KEY`                                                                     | unset      | API key the sandbox submits with.                                                                                                                                                                              |
| `SANDBOX_PUBLIC_PROJECT_ID`                                                                  | unset      | Project the sandbox submits jobs to. Set on the API.                                                                                                                                                           |
| `SANDBOX_POLL_TIMEOUT_SECS`                                                                  | 25         | How long the proxy waits for the job it submitted, 5 to 600. Must be shorter than the backend's `HTTP_REQUEST_TIMEOUT_SECS` (default 30), which the backend checks at startup. Raise both for large documents. |
| `SANDBOX_PUBLIC_MAX_PAGES`                                                                   | 1          | Pages accepted per document. At least 1. Pages times bytes must stay under the engine content limit.                                                                                                           |
| `SANDBOX_PUBLIC_MAX_BYTES`                                                                   | 1048576    | Bytes accepted per document.                                                                                                                                                                                   |
| `SANDBOX_PUBLIC_IP_LIMIT`                                                                    | 10         | Extractions one client address may run in 24 hours. At least 1.                                                                                                                                                |
| `SANDBOX_PUBLIC_RATE_BURST`, `SANDBOX_PUBLIC_RATE_PER_SECS`                                  | 5, 60      | Per-address token bucket: burst size and refill window in seconds.                                                                                                                                             |
| `SANDBOX_PUBLIC_UID_RATE_BURST`, `SANDBOX_PUBLIC_UID_RATE_PER_SECS`                          | 10, 60     | Per-identity token bucket, enforced only when `SANDBOX_PUBLIC_AUTH_MODE` is `oidc`.                                                                                                                            |
| `SANDBOX_PUBLIC_TRUSTED_PROXY_CIDRS`, `SANDBOX_PUBLIC_TRUSTED_PROXY_HOPS`                    | unset      | Trusted proxies for reading the client address. Set both or neither.                                                                                                                                           |
| `SANDBOX_PUBLIC_AUTH_MODE`                                                                   | `disabled` | `disabled` or `oidc`. `oidc` needs the issuer and audience below.                                                                                                                                              |
| `SANDBOX_PUBLIC_AUTH_ISSUER`, `SANDBOX_PUBLIC_AUTH_AUDIENCE`, `SANDBOX_PUBLIC_AUTH_JWKS_URI` | unset      | Identity provider settings for `oidc` mode.                                                                                                                                                                    |

## Worker service

### Concurrency and job deadlines

| Variable                                | Default                | Description                                                                                                                                                                                                                                 |
| --------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WORKER_CONCURRENCY`                    | `min(CPUs, 8)`         | Documents extracted at once. Unset follows the pod's CPU limit. Set it only to deviate from that. Memory rule: the pod memory limit should be at least this value times the 512 MiB content limit plus 1 GiB.                               |
| `WORKER_ENGINE_MAX_THREADS`             | derived from CPU limit | Threads for one document. Unset, it follows `worker.resources.limits.cpu`, capped at 8 with no limit. Raise it to use more cores on one document. Peak memory grows by about 140 MB per added thread on a multi-page scan. Must be above 0. |
| `WORKER_BATCH_SIZE`                     | 10                     | Jobs fetched per batch. Above 0.                                                                                                                                                                                                            |
| `WORKER_BATCH_TIMEOUT_SECS`             | 5                      | Fetch window per batch. At most a quarter of the pod grace period (30 with the default).                                                                                                                                                    |
| `WORKER_TERMINATION_GRACE_SECS`         | 120                    | The pod's grace period, 30 to 3600. The chart sets it from `worker.terminationGracePeriodSeconds` (and `workerGpu.` for GPU workers). Do not set it by hand.                                                                                |
| `JOB_TIMEOUT_SECS`                      | 600                    | Per-job extraction deadline, at most 86100. `XBERG_EXTRACTION_TIMEOUT_CEILING_SECS` must not exceed it. See [Long extractions](#long-extractions).                                                                                          |
| `XBERG_EXTRACTION_TIMEOUT_CEILING_SECS` | 600                    | Most a request's `extraction_timeout_secs` may ask for. Larger values are clamped, with a warning. Positive and at most `JOB_TIMEOUT_SECS`.                                                                                                 |
| `XBERG_EXTRACTION_TIMEOUT_DEFAULT_SECS` | 600                    | Timeout of a request that sends none. Positive and at most the ceiling. Unset, it is 600, or the ceiling when lower.                                                                                                                        |
| `EMBEDDING_TIMEOUT_SECS`                | 900                    | Per-job embedding deadline, at most 86100.                                                                                                                                                                                                  |
| `SPLIT_PREPARE_TIMEOUT_SECS`            | 600                    | Budget for preparing one slice of a split multi-document job, 30 to 3600. Must be shorter than `STUCK_JOB_THRESHOLD_SECS`.                                                                                                                  |
| `REAPER_INTERVAL_SECS`                  | 300                    | How often the reaper looks for stuck work.                                                                                                                                                                                                  |
| `STUCK_JOB_THRESHOLD_SECS`              | 7200                   | Age after which a processing job counts as stuck. Must exceed the redelivery horizon of the jobs stream.                                                                                                                                    |
| `STUCK_CRAWL_THRESHOLD_SECS`            | 3600                   | Age after which a crawl counts as stuck. Must exceed `CRAWL_WALL_CLOCK_SECS`.                                                                                                                                                               |
| `MAX_UPLOAD_BYTES`                      | 104857600              | Largest document the worker fetches itself (crawled or storage-referenced). Independent of the API's limit.                                                                                                                                 |

### Models and OCR

| Variable                                                                      | Default                                   | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `XBERG_VLM_OCR_MODEL`                                                         | unset / `vertex_ai/gemini-2.5-flash-lite` | Default model for VLM OCR and image classification. For Google AI Studio, set `gemini/<model>` and provide `GEMINI_API_KEY` through a Secret.                                                                                                                                                                                                                                                                                                                         |
| `XBERG_VLM_OCR_BASE_URL`                                                      | unset                                     | OpenAI-compatible server you host for the VLM OCR model, such as `http://vllm.models.svc.cluster.local:8000/v1`. Needs `XBERG_VLM_OCR_MODEL`. Name the model the server serves, such as `openai/<model>` or `ollama/<model>`. The host must pass `VLM_ENDPOINT_ALLOWLIST` on the API, and a server outside the release namespace needs a NetworkPolicy egress rule. A `vertex_ai/` model with a URL needs `XBERG_VLM_OCR_API_KEY`, and a `bedrock/` model is refused. |
| `XBERG_VLM_OCR_API_KEY`                                                       | unset                                     | Key for that server. Needs `XBERG_VLM_OCR_BASE_URL`. Set it from a Secret through `worker.extraEnv` and `workerGpu.extraEnv`, never in `env`.                                                                                                                                                                                                                                                                                                                         |
| `XBERG_VLM_AUTO_DETECT`                                                       | `false`                                   | Let the VLM decide when a page needs OCR. Requires `XBERG_VLM_OCR_MODEL`.                                                                                                                                                                                                                                                                                                                                                                                             |
| `XBERG_VLM_ESCALATION_THRESHOLD`                                              | 1.0                                       | OCR quality score, 0 to 1, below which a page escalates to the VLM. The default sends nearly every OCR page. Lower it to cut VLM spend.                                                                                                                                                                                                                                                                                                                               |
| `XBERG_IMAGE_CLASSIFY`                                                        | `false`                                   | Classify images with a vision model. Requires `XBERG_VLM_OCR_MODEL`.                                                                                                                                                                                                                                                                                                                                                                                                  |
| `XBERG_MULTIDOC_DENSITY_SHIFT_THRESHOLD`, `XBERG_MULTIDOC_BIGRAM_OVERLAP_MIN` | library defaults                          | Sensitivity of multi-document splitting.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `XBERG_ORT_EP`                                                                | unset                                     | ONNX execution provider. A GPU build requires it. The chart sets `cuda` for `workerGpu`.                                                                                                                                                                                                                                                                                                                                                                              |
| `WARM_EMBEDDING_PRESETS`                                                      | `balanced`                                | Embedding presets the worker loads at boot, comma-separated from `fast`, `balanced`, `quality` and `multilingual`. Without warmup, the first RAG job on a freshly scaled-up worker loads the model (about 60 s). Set it empty to disable.                                                                                                                                                                                                                             |
| `GOOGLE_CLOUD_PROJECT`                                                        | unset                                     | Project for Vertex AI when `VERTEXAI_PROJECT` is unset.                                                                                                                                                                                                                                                                                                                                                                                                               |
| `VERTEXAI_LOCATION`                                                           | `us-central1` (chart)                     | Vertex AI region.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `NO_PROXY`                                                                    | `*`                                       | Hosts that bypass a proxy. The worker refuses an ambient proxy configuration it cannot validate.                                                                                                                                                                                                                                                                                                                                                                      |
| `MODEL_SYNC_TIMEOUT_SECS`                                                     | 300                                       | Budget for syncing models from object storage.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `MODEL_SYNC_REQUIRED`                                                         | `false` (worker), `true` (rag)            | Stop the pod when the sync fails.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `MODEL_CACHE_KEEP_VERSIONS`                                                   | 2                                         | Model cache versions kept on cleanup.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `MODEL_CACHE_VOLUME_BYTES`                                                    | unset                                     | Size of the model cache volume. The chart derives it.                                                                                                                                                                                                                                                                                                                                                                                                                 |

### Crawling

See the [crawling guide](/guides/crawling/).

| Variable                                                                                   | Default                                | Description                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------ | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CRAWL_BROWSER_MODE`                                                                       | `auto`                                 | `auto`, `always`, `never` or `stealth`.                                                                                                                                                                                                                         |
| `CRAWL_BROWSER_ENDPOINT`                                                                   | from the chrome subchart               | Remote browser endpoint.                                                                                                                                                                                                                                        |
| `CRAWL_BROWSER_BACKEND`                                                                    | follows the endpoint                   | `native` or `chromiumoxide`.                                                                                                                                                                                                                                    |
| `CRAWL_BROWSER_STEALTH`                                                                    | `false`                                | Apply stealth patches.                                                                                                                                                                                                                                          |
| `CRAWL_BROWSER_BLOCK_URL_PATTERNS`, `CRAWL_BROWSER_EVAL_SCRIPT`, `CRAWL_BROWSER_ROBOTS_UA` | empty                                  | Request blocking, a script to run on each page, and the robots user agent.                                                                                                                                                                                      |
| `CRAWL_BROWSER_CAPTURE_NETWORK_EVENTS`                                                     | `false`                                | Record network events.                                                                                                                                                                                                                                          |
| `CRAWL_BROWSER_POOL_MAX_PAGES`                                                             | 8                                      | Pages the browser pool holds.                                                                                                                                                                                                                                   |
| `CRAWL_BROWSER_MAX_PAGES`                                                                  | 8                                      | Concurrent pages per crawl.                                                                                                                                                                                                                                     |
| `CRAWL_BROWSER_TIMEOUT_MS`                                                                 | 30000                                  | Per-page load timeout.                                                                                                                                                                                                                                          |
| `CRAWL_NATIVE_WORKERS`                                                                     | from CPU count                         | Native crawler workers.                                                                                                                                                                                                                                         |
| `CRAWL_NATIVE_QUEUE_CAPACITY_PER_WORKER`                                                   | 64                                     | Queue depth per native worker.                                                                                                                                                                                                                                  |
| `CRAWL_WALL_CLOCK_SECS`                                                                    | 1500                                   | Time budget for the crawl phase of one job. 300 to 1740: not below the 300 s per-request cap, and 60 s under the 1800 s crawl ack wait, which cannot follow this value. `STUCK_CRAWL_THRESHOLD_SECS` must stay above it. The worker refuses to start otherwise. |
| `CRAWL_MAX_TOTAL_ATTEMPTS`                                                                 | 10                                     | Attempts per URL.                                                                                                                                                                                                                                               |
| `CRAWL_WAF_FINGERPRINTS_PATH`                                                              | `/etc/xberg/waf/waf_fingerprints.toml` | WAF fingerprint file.                                                                                                                                                                                                                                           |

### Long extractions

A large scanned PDF can need more than the default ten minutes, and fails with `Extraction timed out after 600000ms`. Raise the limits below together, because each caps the next.

1. **Per request.** Send `extraction_timeout_secs` in the request's `config` (JSON body or multipart `config` part), or in a file's `config-<filename>` part. The value is in seconds.
2. **Ceiling.** `XBERG_EXTRACTION_TIMEOUT_CEILING_SECS` is the most a request may ask for. More is clamped.
3. **Default.** `XBERG_EXTRACTION_TIMEOUT_DEFAULT_SECS` applies to requests without the field. Raising only the ceiling leaves them at 600 s.
4. **Job deadline.** `JOB_TIMEOUT_SECS` bounds the whole job, so the ceiling and the default cannot exceed it.

For 30 minutes on every document, set these on the worker and, if you run one, the GPU worker:

```yaml
worker:
  env:
    JOB_TIMEOUT_SECS: "1800"
    XBERG_EXTRACTION_TIMEOUT_CEILING_SECS: "1800"
    XBERG_EXTRACTION_TIMEOUT_DEFAULT_SECS: "1800"
```

Check these as well:

| Setting                                | Default | Relationship                                                                                                                                                                                  |
| -------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STUCK_JOB_THRESHOLD_SECS`             | 7200    | Keep it above `JOB_TIMEOUT_SECS`. The reaper fails a processing job older than this, and the worker does not compare the two.                                                                 |
| `ENTERPRISE_PROCESSING_TIMEOUT_SECS`   | 900     | Replicated mode only. Set it on the API. It is the fixed deadline of one attempt, and the extraction timeout is cut to what remains. Raise it above the ceiling, or those jobs stop at 900 s. |
| `XBERG_OCR_CALL_TIMEOUT_SECS`          | 1260    | One VLM OCR call, not the document. A page that needs longer fails whatever the extraction timeout.                                                                                           |
| `XBERG_LLM_CALL_TIMEOUT_SECS`          | 300     | The same for one vision or structured-extraction call.                                                                                                                                        |
| `worker.terminationGracePeriodSeconds` | 120     | A worker stopped mid-job has this long to finish. A longer job is redelivered and starts again, so a rollout during a 30-minute job repeats it. Raise it to ride out rollouts.                |

The 30-second broker ack window renews while the job runs, so it does not limit job length.

## Webhook service

See the [webhooks guide](/guides/webhooks/) and [Webhook delivery errors](/reference/webhook-errors/).

| Variable                             | Default | Description                                                                                                                                                                  |
| ------------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WEBHOOK_BATCH_SIZE`                 | 10      | Events fetched per batch, 1 to 100.                                                                                                                                          |
| `WEBHOOK_BATCH_TIMEOUT_SECS`         | 5       | Fetch window per batch.                                                                                                                                                      |
| `WEBHOOK_HTTP_TIMEOUT_SECS`          | 30      | Per-request delivery timeout. In replicated mode it must stay below the 60 s delivery deadline.                                                                              |
| `WEBHOOK_DELIVERY_CONCURRENCY`       | 8       | Concurrent deliveries for one job's webhooks.                                                                                                                                |
| `WEBHOOK_LEDGER_RETENTION_DAYS`      | 7       | How long a delivery record is kept, 3 to 365. The webhooks stream replays messages for two days, so a shorter retention could purge a record the broker can still redeliver. |
| `WEBHOOK_LEDGER_PURGE_INTERVAL_SECS` | 21600   | Gap between purge sweeps, 60 to 86400.                                                                                                                                       |

The retry schedule is fixed at build time and cannot be set from the environment. Delivery makes up to five attempts: the first is immediate, and the four retries wait 5 s, 30 s, 5 min and 5 min.

## RAG service

| Variable                         | Default           | Description                                                                                                                                          |
| -------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RAG_MIGRATE_BATCH_SIZE`         | 100               | Chunks re-embedded per migration batch.                                                                                                              |
| `RAG_WARMUP_TIMEOUT_SECS`        | 480               | Budget for one embedding warmup pass, 10 to 3600, shorter than the interval. Keep it below the startup probe window (600 s with the chart defaults). |
| `RAG_WARMUP_INTERVAL_SECS`       | 900               | Gap between warmup passes, 60 to 86400.                                                                                                              |
| `RAG_QUERY_EMBED_TIMEOUT_SECS`   | 30                | Limit for embedding one interactive query, 1 to 600. Raise it when a cold model load on a small node exceeds 30 s.                                   |
| `RAG_EMBEDDING_WARMUP_ENABLED`   | `false`           | Warm embedding models on the RAG service. Set it through the chart value `rag.embeddingWarmupEnabled`. The same key under `rag.env` is ignored.      |
| `XBERG_MANAGED_LLM_BASE_URL`     | unset             | Base URL of a self-hosted LLM used for reranking. Required for providers without a public default.                                                   |
| `NATS_RAG_MIGRATE_CONSUMER_NAME` | from the manifest | Consumer for migration jobs.                                                                                                                         |
