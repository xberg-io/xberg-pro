---
title: RAG configuration
description: Enable RAG per project and tune the RAG runtime, reranker, audit retention, vector index method and model caches.
sidebar:
  order: 9
---

**Available in:** Pro, Enterprise (sections marked Enterprise apply to the Helm chart only)

RAG is an optional, per-project capability. Two surfaces control it: a project-level `rag-config` endpoint that turns it on, and deployment settings (Helm values or environment variables) that tune the runtime. For how to use RAG, see the [RAG guide](/guides/rag/). For error codes, see [RAG errors](/reference/rag-errors/).

## Enable RAG for a project

RAG is gated by a dedicated `rag-config` sub-resource, not by the general project-update endpoint. `PATCH /v1/projects/{project_id}` accepts only `name`.

On Enterprise, the **backend** control-plane service serves `rag-config`, so use the backend's base URL. The extraction API has no `/v1/projects` routes, and calling `rag-config` on its base URL returns 404. On Pro, the single container serves extraction and control-plane routes under one base URL.

```http
PUT /v1/projects/{project_id}/rag-config
Content-Type: application/json

{
  "enabled": true,
  "default_collection": "docs"
}
```

`GET /v1/projects/{project_id}/rag-config` reads the setting back. Always go through `rag-config`, because the storage shape behind it is not part of the HTTP contract.

When `enabled` is `false` or unset, every `/v1/rag/*` endpoint returns `404 rag.disabled`. The capability stays invisible to projects that do not opt in.

## Reranker

The reranker can use a bundled cross-encoder preset or a managed LLM. A preset is a model name or one of the aliases `fast`, `balanced`, `quality` and `multilingual`. Credentials for the managed LLM live in the deployment environment and never on the request:

| Variable                     | Purpose                                              |
| ---------------------------- | ---------------------------------------------------- |
| `XBERG_MANAGED_LLM_PROVIDER` | LLM provider name, for example `gemini` or `openai`. |
| `XBERG_MANAGED_LLM_MODEL`    | Default model ID when a request omits `model`.       |
| `XBERG_MANAGED_LLM_API_KEY`  | Provider API key. Load it from a Secret.             |

At startup the service probes which reranker backends are available. Cross-encoder presets are available when the binary includes reranking. The LLM backend is available only when all three variables are set to non-empty values. A request for an unavailable backend returns `501 rag.rerank.unavailable` with `details.kind`. If you never need LLM reranking, leave the variables unset and preset reranking still works.

The service probes capabilities once at process start and reads the registry on every retrieve request that asks for a rerank backend.

## Retrieve concurrency and ingest batching (Enterprise)

| Variable                               | Default             | Purpose                                                                      |
| -------------------------------------- | ------------------- | ---------------------------------------------------------------------------- |
| `RAG_RETRIEVE_CONCURRENCY_PER_PROJECT` | `4`                 | Per-project limit on concurrent retrieve requests. `0` falls back to `4`.    |
| `NATS_RAG_INGEST_CONSUMER_NAME`        | `rag-ingest-worker` | JetStream durable consumer name for `rag.ingest.<project_id>`.               |
| `RAG_BATCH_SIZE`                       | `16`                | Maximum documents per ingest batch before publishing to the embedding queue. |
| `RAG_BATCH_TIMEOUT_MS`                 | `5000`              | Maximum wait for a batch to fill before publishing a partial batch.          |

Retrieve callers queue until a permit is free or the HTTP timeout expires. They are not rejected.

The RAG consumers check for shutdown between batches, so `RAG_BATCH_TIMEOUT_MS` is also the shutdown latency of an idle RAG pod: a fetch that is already waiting for a message runs to its expiry before the pod can stop. The chart refuses to render a value above a quarter of `rag.terminationGracePeriodSeconds`, which leaves the rest of the grace period to the in-flight batch. Raise the grace period if you need a longer window.

## NetworkPolicy egress for LLM providers (Enterprise)

Managed-LLM reranking needs outbound access from the RAG pod to your LLM provider. The chart renders a NetworkPolicy with an egress block you configure through `rag.networkPolicy.llmEgress`. Two approaches work:

- **FQDN-based** (Cilium). Allowlist provider FQDNs such as `generativelanguage.googleapis.com`. This needs the Cilium CNI.
- **IP-based** (standard NetworkPolicy). Allowlist provider IP ranges. Providers do not publish stable ranges, so this approach needs manual updates.

Deny-by-default is the safe baseline: with no egress rule there is no traffic. Add rules only for providers you use.

## Audit retention

Every retrieve writes one row into the `rag_audit_events` table, which is partitioned monthly by `recorded_at`. The Enterprise chart ships a daily CronJob that detaches and drops partitions older than the retention window:

| Helm value               | Default       | Purpose                                                |
| ------------------------ | ------------- | ------------------------------------------------------ |
| `ragAudit.enabled`       | `true`        | Render the CronJob. Set `false` if you do not use RAG. |
| `ragAudit.schedule`      | `"0 3 * * *"` | Cron schedule, daily at 03:00 by default.              |
| `ragAudit.retentionDays` | `90`          | Drop partitions older than this many days.             |

The API process creates the current month's partition and the next two at startup, then refreshes hourly. Creation is idempotent.

The `query_text` column is only filled when the collection has `audit_query_content = true`. Opt in per collection for deployments with legal or compliance needs. A request for LLM reranking returns `422 rag.rerank.invalid` when `audit_query_content = false`, because the LLM provider receives the raw query string. Preset reranking is unaffected.

## Autoscaling (Enterprise)

The RAG pod scales with KEDA. The NATS JetStream trigger is on by default, and the Prometheus trigger is opt-in, so by default there is one trigger:

1. **NATS JetStream consumer lag.** The chart derives the monitoring endpoint from `global.natsMonitoringUrl` when set, or from the in-chart NATS deployment otherwise. It uses `rag.keda.natsAccount`, `rag.keda.natsStream` and `rag.keda.natsConsumer` to scale on pending ingest messages.
2. **Prometheus metric.** Gated on `rag.keda.prometheus.enabled` (default `false`) and `rag.keda.prometheus.serverAddress` (default empty). The query references `rag_retrieve_requests_total`, which the RAG service does not emit. Enabling this trigger without a Prometheus instance that scrapes a metric of that name gives an always-empty query, not a working scaler.

Each trigger is assembled from these discrete keys, and no single `rag.keda.triggers` list exists.

## Vector index method

Enterprise uses pgvectorscale (DiskANN) by default for large-scale vector storage, and HNSW (pgvector only) otherwise. The defaults are:

- **Index method.** `DiskANN`, with `HNSW` as the fallback for smaller deployments or when pgvectorscale is unavailable.
- **Storage layout.** `memory_optimized` with SBQ compression, which saves 4 to 8 times the memory.
- **Per-collection partial indexes.** Each collection has its own index, so heterogeneous embedding dimensions do not conflict.
- **Query-time parameters.** `query_search_list_size = min(top_k * 4, 10000)` and `query_rescore = max(top_k, 50)`. Rescoring restores recall lost to compression.
- **Build-time parameters.** `maintenance_work_mem = 2GB` on the dedicated index build connection. The 64 MB default is too small for large collections.

pgvectorscale is optional. On PostgreSQL servers without it, notably Cloud SQL, set the deployment-wide default to HNSW so new collections use a pgvector-only index:

- **Helm value:** `vectorstore.defaultIndexMethod: "hnsw"`
- **Environment variable:** `XBERG_VECTORSTORE_DEFAULT_INDEX_METHOD=hnsw`, set on the `api`, `rag` and `worker` pods.

The chart default is `diskann`. Each collection can still pin an explicit `index_method` at creation time, and the deployment default applies only when the caller omits it. HNSW is comfortable up to roughly 10 million vectors per index. Pro uses the pgvector HNSW path.

## Embedding and NER model cache

At startup the RAG runtime can warm the models it needs. The behavior differs slightly per tier:

- **Warmup scope.** Both tiers warm only the embedding presets that existing collections name, plus the named-entity model. A fresh install downloads nothing until a collection exists. `byo` and `provider:` collections warm no embedding model. Downloads run on blocking threads and never hold up an ingest.
- **Pro.** Set `XBERG_RAG_WARMUP_ENABLED=true` (opt-in, default `false`) to warm both model classes. See the [Pro configuration reference](/reference/pro-configuration/).
- **Enterprise RAG service.** Named-entity warmup always runs on boot. Embedding warmup runs only with `rag.embeddingWarmupEnabled=true` (`RAG_EMBEDDING_WARMUP_ENABLED`, default `false`). Keep recurring embedding warmup off when the number of collection presets can exceed the engine cache bound, otherwise each pass rebuilds and evicts the excess engines.
- **Enterprise worker.** The worker warms embedding presets only when `WARM_EMBEDDING_PRESETS` (comma-separated preset names) is set. By default it warms nothing and loads models lazily on first use. It never warms the named-entity model.
- **Cache sync.** The worker and the RAG service support `--sync-cache`, `--upload-cache` and `--cleanup-cache` modes that move model files between object storage and the local `XBERG_CACHE_DIR`, for deployments that want a warm cache ahead of time. See [Air-gapped installation](/operate/air-gapped/).

Enterprise limits the process-wide engine caches with `rag.engineCache.embeddingMaxResident` and `rag.engineCache.rerankerMaxResident`. Both default to 2, and the service applies them before warmup or consumer startup. They are entry-count bounds, not hard memory ceilings, because active callers can retain an evicted engine. Set each at least as high as the number of collection presets a replica uses concurrently, or alternating requests rebuild evicted engines.

Reranker presets load lazily on the first retrieve request that uses them. No flag pre-warms them, so the first request against a preset pays the warmup cost.

## Usage accounting

RAG operations write distinct `rag_retrieve` and `rag_rerank` rows to the `usage_events` table. Each row counts as one unit, regardless of rerank kind or duration. Export or aggregate the table with your own accounting system.
