---
title: Architecture
description: How Xberg Pro and Xberg Enterprise accept, queue, process and deliver documents on the same extraction engine.
sidebar:
  order: 1
---

Xberg Pro and Xberg Enterprise are built on [Xberg Core](https://docs.xberg.io), the open-source document intelligence engine. Documents go in over REST. Text, tables and metadata come out through polling or [webhooks](/guides/webhooks/). Both products expose the same extraction API, so the layer behind it is the only thing that differs.

## Request flow

Extraction is asynchronous. A submission returns `202 Accepted` with one or more job IDs, and the result appears when a worker finishes.

```text
Client                API                 Queue              Worker
  | POST /v1/extract   |                    |                   |
  |------------------->| enqueue job        |                   |
  |<-------------------| 202 + job_ids      |                   |
  |                    |                    |---- pull job ---->|
  |                    |                    |                   | extract
  |                    |                    |<--- result -------|
  | GET /v1/jobs/{id}  |                    |                   |
  |------------------->| read result        |                   |
  |<-------------------| 200 + result       |                   |
```

Poll for quick scripts and use webhooks in production. See the [quickstart](/start/quickstart/).

## Xberg Pro

Pro runs as a single container next to PostgreSQL and your object storage.

- **Dispatch.** Jobs run in-process against a bounded worker pool, with no message bus.
- **State.** PostgreSQL holds job metadata, projects, API keys and the audit log. It also stores RAG chunks and vectors through pgvector.
- **Results.** Results land in your object storage, which can be S3, GCS, Azure Blob or the local filesystem. A local content-addressed cache avoids repeat work, and an object-store tier can back it.
- **Tenancy.** Pro isolates projects with PostgreSQL row-level security and per-project API keys.
- **Webhooks.** Callback delivery is asynchronous, with bounded retries.
- **License.** A signed license is required to start. See [Licensing](/reference/licensing/).

The container serves the REST API, the web console and metrics. Pro scales vertically: give the node more cores.

## Xberg Enterprise

Enterprise splits the work across independent services on your Kubernetes cluster, around a PostgreSQL data store and a NATS JetStream message bus.

| Service          | Role                                                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| API              | Public REST surface. Authenticates requests, validates input, publishes work and returns immediately.                                   |
| Backend          | Management API for projects, members, API keys, SAML and SCIM.                                                                          |
| Workers          | Extraction, crawl and document-diff consumers, plus cleanup when a project is deleted. Workers scale on queue depth, including to zero. |
| RAG service      | Ingests and retrieves for collections, and runs reranking.                                                                              |
| Webhook delivery | Posts signed completion and failure events to registered endpoints, at least once.                                                      |

A shared result cache gives fast reads on `GET /v1/jobs/{id}`, while PostgreSQL keeps the full history. Workers scale with KEDA on queue depth and API replicas scale horizontally. Large documents are split and processed in parallel, then rejoined into one result.

## Data model

- **Project.** The tenant boundary. It scopes data, API keys and webhooks. Every request resolves to a project, and row-level security restricts each query to it.
- **API key.** A `kz_`-prefixed bearer token scoped to one project. See [Authentication](/concepts/authentication/).
- **Job.** One document or one batch entry. A job carries inline bytes or a reference to a presigned upload in object storage.
- **Result.** `content`, `metadata`, and optionally `tables` and `chunks`. It matches the Core extraction result.

## Crawling

Submit URLs, bytes or both to `POST /v1/extract`. The worker fetches URLs with [crawlberg](https://docs.crawlberg.xberg.io), converts HTML with [html-to-markdown](https://github.com/xberg-io/html-to-markdown) and then extracts. Crawled documents either persist or fan out as child extraction jobs, depending on `crawl_config.save`. See [Crawling](/guides/crawling/) and the [pipeline](/concepts/pipeline/).

## Tier comparison

|              | Pro                            | Enterprise                              |
| ------------ | ------------------------------ | --------------------------------------- |
| Deployment   | One container plus PostgreSQL  | Helm umbrella chart on Kubernetes       |
| Job dispatch | In-process worker pool         | NATS JetStream with distributed workers |
| Scaling      | Vertical                       | Horizontal, autoscaled on queue depth   |
| Isolation    | Row-level security per project | Row-level security per project          |

The extraction engine, which covers 107 formats, is identical across Core, Pro and Enterprise. See [Core, Pro and Enterprise](/overview/tiers/).
