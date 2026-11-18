---
title: RAG collections
description: Create vector collections, ingest documents and text, and retrieve ranked chunks with hybrid search and reranking.
sidebar:
  order: 6
---

**Available in:** Pro, Enterprise. Requires a valid Pro license.

RAG collections store chunked, embedded documents in your PostgreSQL database with pgvector, and return the most relevant chunks for a query.

## Enable RAG

A valid license grants the feature, and it is on by default. Operators can switch it off with `PRO_RAG_ENABLED=false`, which makes every `/v1/rag/*` request answer `404` with `rag.disabled`. Deployments that set `XBERG_DATA_POLICY=extraction_only` deny RAG reads and writes. The first request that needs an embedding model downloads it; see [Runtime and memory](#runtime-and-memory).

## Create a collection

A collection fixes its embedding dimension at creation:

```bash
curl -X POST "$XBERG_URL/v1/rag/collections" \
  -H "Authorization: Bearer $XBERG_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "name": "policies", "embedding_dim": 384, "distance_metric": "cosine" }'
```

`name` and `embedding_dim` (1-2000) are required. `distance_metric` is `cosine`, `l2` or `inner_product`. Optional `chunking_config` overrides the built-in defaults of 1000 characters with 200 characters of overlap. List the embedding presets your instance offers with `GET /v1/rag/embedding-presets`. `GET` and `DELETE` on `/v1/rag/collections/{name}` read and remove a collection.

New collections use the index method set by `XBERG_VECTORSTORE_DEFAULT_INDEX_METHOD`. It defaults to `hnsw` on Pro, which works on plain pgvector. Enterprise can use `diskann` when `pgvectorscale` is installed.

## Ingest documents

Each call submits one document with a flat body and returns `202` with a `job_id` and a `document_id`. `kind` is `text`, with the content in `text`, or `chunks`, with pre-split chunks in `chunks`. Optional fields are `title`, `metadata` and `mime`:

```bash
curl -X POST "$XBERG_URL/v1/rag/collections/policies/documents" \
  -H "Authorization: Bearer $XBERG_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "kind": "text", "external_id": "doc-1", "text": "Refunds are available within 30 days." }'
```

Ingest is asynchronous. Poll the job and confirm it succeeded before you retrieve or delete the collection:

```bash
curl "$XBERG_URL/v1/rag/jobs/$JOB_ID" \
  -H "Authorization: Bearer $XBERG_API_KEY"
```

Add a `webhook` object to the request to receive `job.completed` or `job.failed` instead of polling; see [Webhooks](/guides/webhooks/). Text ingest needs a working embedding configuration. To re-embed a document after a configuration change, call `POST /v1/rag/collections/{name}/documents/{id}/reindex`.

## Retrieve

```bash
curl -X POST "$XBERG_URL/v1/rag/collections/policies/retrieve" \
  -H "Authorization: Bearer $XBERG_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "query": "How long do customers have to return an item?", "mode": "hybrid", "top_k": 5 }'
```

| Field                  | Meaning                                                                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`                 | `hybrid` (default), `vector` or `full_text`. A bring-your-own `query_vector` must match the collection's `embedding_dim`                |
| `top_k`                | 1-200, default 10                                                                                                                       |
| `rerank`               | Three-state. Omit it for the collection default, send `null` to disable reranking for this call, or send a reranker spec to override it |
| `candidate_multiplier` | 1-20, default 4. The store pulls `top_k * candidate_multiplier` candidates for the reranker. Ignored when reranking is inactive         |
| `filter`               | A filter expression over chunk metadata                                                                                                 |
| `group_by_document`    | Collapse the result to one chunk per document                                                                                           |
| `include`              | A response field mask                                                                                                                   |

Reranking runs a cross-encoder over the candidates. Query embeddings and rerank results are cached in object storage per project (`RAG_CACHE_EMBED_ENABLED` and `RAG_CACHE_RERANK_ENABLED`), so a repeated query pays for each only once.

## Migrate embeddings

To change a collection's embedding model without downtime, start a dual-write migration with `POST /v1/rag/collections/{name}/migrate-embeddings`, and follow it with `GET /v1/rag/collections/{name}/migrate-embeddings/{job_id}`. Documents are re-embedded in batches of `PRO_RAG_MIGRATE_BATCH_SIZE` (default 100).

## Project default

`GET` and `PUT /v1/projects/{project_id}/rag-config` set whether RAG is enabled for a project and which collection is its `default_collection`. Source connectors can feed a collection directly through `PUT /v1/projects/{project_id}/integrations/{iid}/sync/rag-target`; see [Source connectors](/guides/source-connectors/).

## Runtime and memory

Pro runs ingest, reindex and migration in-process, bounded by `PRO_RAG_MAX_CONCURRENCY` (default 2). It keeps up to two embedding and two reranker engines resident. Set `XBERG_EMBEDDING_ENGINE_CACHE_MAX_RESIDENT` and `XBERG_RERANKER_ENGINE_CACHE_MAX_RESIDENT` at least as high as the number of collection presets used at the same time, or alternating requests rebuild evicted engines. Models download from Hugging Face on first use into `HF_HOME`; see [RAG configuration](/operate/rag-config/) and [Air-gapped installation](/operate/air-gapped/) for pre-seeding.

## Limits and errors

- `embedding_dim` is 1 to 2000, `top_k` is 1 to 200 and `candidate_multiplier` is 1 to 20.
- Retrieval answers `501` when the collection's reranker is unavailable, and `503` when the per-project retrieve limiter is unavailable.
- Every `/v1/rag/*` request answers `404` with `rag.disabled` while an operator has switched RAG off.

The full list of error codes is in [RAG errors](/reference/rag-errors/).
