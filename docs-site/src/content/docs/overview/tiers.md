---
title: Core, Pro and Enterprise
description: The full comparison of Xberg Core, Xberg Pro and Xberg Enterprise by licensing, deployment, scale, support and features.
---

All three tiers run the same extraction engine: the same formats, the same languages, the same code. None is a cut-down build. What differs is what runs around the engine: queueing, storage, tenancy and scale.

All three are self-hosted. You run them on your own infrastructure, and documents do not pass through Xberg-operated systems.

## At a glance

|               | Core                       | Pro                            | Enterprise                                    |
| ------------- | -------------------------- | ------------------------------ | --------------------------------------------- |
| License       | MIT                        | Proprietary                    | Proprietary                                   |
| Availability  | Released                   | Released                       | By arrangement, with private images and chart |
| Runs as       | Library, CLI, Docker, Helm | Docker Compose or Helm         | Helm, on your Kubernetes cluster              |
| Scale ceiling | One process                | One node                       | A cluster                                     |
| Price         | Free                       | Per license, by contract       | Per license, by contract                      |
| Support       | GitHub, Discord            | Email, dedicated Slack channel | Private channel, contractual SLA              |

**Core** embeds the engine in your application, or runs it as a CLI or single-service API. You own scheduling, storage and retries. Documentation is at [docs.xberg.io](https://docs.xberg.io).

**Pro** is one container plus PostgreSQL. It provides what the platform does for a single team: durable jobs, a web console, crawling, search and retrieval, Auto-Tune, storage backends, source connectors and an audit log. One environment, no message bus.

**Enterprise** is the distributed platform. It includes everything in Pro, plus multi-user teams, SAML and SCIM, elastic workers, managed webhooks, document versioning and data rooms. It installs from a private Helm chart and private images, by arrangement.

Pro is one product, not a set of plans. A valid license turns on everything Pro does, and nothing is sold as an add-on. See [Pricing and licensing](/overview/pricing-and-licensing/).

## Engine

Identical in every tier.

| Capability                                              | Core | Pro | Enterprise |
| ------------------------------------------------------- | ---- | --- | ---------- |
| 107 file formats, 141 extensions                        | Yes  | Yes | Yes        |
| 371 programming languages (tree-sitter)                 | Yes  | Yes | Yes        |
| OCR: Tesseract, PaddleOCR, EasyOCR, vision models       | Yes  | Yes | Yes        |
| Layout and table models, formula recognition            | Yes  | Yes | Yes        |
| Tables, metadata, schema-driven structured extraction   | Yes  | Yes | Yes        |
| Entities and PII, keywords, language detection          | Yes  | Yes | Yes        |
| Output: Markdown, HTML, JSON, plain text, Djot, DocTags | Yes  | Yes | Yes        |
| Chunking and embeddings                                 | Yes  | Yes | Yes        |
| Audio and video transcription                           | Yes  | No  | No         |

Pro and Enterprise reject audio and video input when you submit it, before any bytes upload. Run Core directly when you need transcription.

## Deployment

| Capability                                     | Core           | Pro             | Enterprise  |
| ---------------------------------------------- | -------------- | --------------- | ----------- |
| In-process library, 15 languages               | Yes            | Via Core        | Via Core    |
| CLI and MCP server                             | Yes            | Via Core        | Via Core    |
| REST API                                       | Yes            | Yes             | Yes         |
| Client SDKs: Python, TypeScript, Go            | No             | Yes             | Yes         |
| Docker image                                   | Yes            | Yes             | Yes         |
| Helm chart                                     | Single service | Single instance | Distributed |
| Web console: playground, job history, settings | No             | Yes             | Yes         |

The SDKs target either a Pro or an Enterprise deployment with the same client library. Core is MIT-licensed, so Pro and Enterprise customers can use the library and CLI alongside their deployment at no cost. See [SDKs](/start/sdks/).

## Jobs, storage and operations

| Capability                                                          | Core         | Pro                     | Enterprise           |
| ------------------------------------------------------------------- | ------------ | ----------------------- | -------------------- |
| Durable job queue and history that survive restart                  | No           | Yes                     | Yes                  |
| Object storage: S3, GCS, Azure Blob, filesystem                     | No           | Yes                     | Yes                  |
| Presigned uploads: presign, upload, confirm                         | No           | Yes                     | Yes                  |
| Result cache                                                        | On disk      | Disk, plus object store | Shared, cluster-wide |
| API keys and multiple projects                                      | No           | Yes                     | Yes                  |
| Curated extraction presets                                          | No           | Yes                     | Yes                  |
| Saved presets                                                       | No           | Yes                     | Yes                  |
| Extraction settings stored on a saved preset                        | No           | No                      | Yes                  |
| Project extraction defaults                                         | No           | No                      | Yes                  |
| Auto-Tune: parameter search against your corpus                     | No           | Yes                     | Yes                  |
| Append-only, hash-chained audit log                                 | No           | Yes                     | Yes                  |
| Prometheus metrics, OpenTelemetry traces and logs                   | Opt-in build | Yes                     | Yes                  |
| Grafana dashboards, delivered through support                       | No           | Yes                     | Yes                  |
| High-availability profiles: red/green generations, fenced promotion | No           | Yes                     | Yes                  |
| Data-policy controls: disable RAG and extraction caching            | No           | Yes                     | Yes                  |
| Sandbox extraction                                                  | No           | No                      | Yes                  |

Auto-Tune searches your own corpus for the settings that extract it best, then promotes the winner to a reusable profile applied at extraction time. See [Auto-Tune](/guides/auto-tune/) and [Presets](/guides/presets/).

Pro enforces monthly job and page quotas per project. A request over quota gets `429 quota_exceeded` with a `Retry-After` header until the next UTC month, and quotas are unlimited when unset. Replicated deployments need a customer-managed load balancer. See [Deployment operator](/operate/deployment-operator/).

## Search and retrieval

| Capability                                           | Core | Pro | Enterprise |
| ---------------------------------------------------- | ---- | --- | ---------- |
| Searchable document collections, ingest pipelines    | No   | Yes | Yes        |
| Chunking strategies: text, Markdown, YAML, semantic  | No   | Yes | Yes        |
| Hybrid search: vector plus full-text, rank fusion    | No   | Yes | Yes        |
| Reranking: local cross-encoder, or an LLM you choose | No   | Yes | Yes        |
| Embedding-model migration as a tracked job           | No   | Yes | Yes        |

Retrieval runs on PostgreSQL with pgvector, defaults to hybrid mode and fuses the two rankings by reciprocal rank. Retrieval is the whole surface: there is no chat or answer endpoint. See [RAG](/guides/rag/).

## Content sources and delivery

| Capability                                                          | Core     | Pro       | Enterprise             |
| ------------------------------------------------------------------- | -------- | --------- | ---------------------- |
| Source connectors                                                   | No       | Yes       | Yes                    |
| Web crawling: robots.txt-aware, per-domain rate limits              | Via Core | Over HTTP | Adds browser rendering |
| Content enrichment: keywords, named entities, labels                | No       | Yes       | Yes                    |
| Per-request callback URL, optionally HMAC-SHA256 signed             | No       | Yes       | Yes                    |
| Registered webhook endpoints: retry, delivery history, replay, test | No       | No        | Yes                    |
| Document versions and diff                                          | No       | No        | Yes                    |
| Multi-document splitting of combined PDFs                           | No       | No        | Yes                    |
| Data rooms: members, roles, invitations, publication                | No       | No        | Yes                    |

Source connectors cover Google Drive (including native Docs, Sheets and Slides export), Dropbox, OneDrive, SharePoint, Notion, Confluence, S3, GCS, Azure Blob and SFTP. See [Source connectors](/guides/source-connectors/).

Pro crawls over plain HTTP. A crawl that needs a rendered page, such as a browser-only mode, stealth or a named browser backend, is refused with a clear error rather than answered with a page that was not fetched as asked. Enterprise runs those. See [Crawling](/guides/crawling/).

## Access and tenancy

| Capability                                                     | Core | Pro | Enterprise |
| -------------------------------------------------------------- | ---- | --- | ---------- |
| Single sign-on: any OIDC provider, email-domain allowlisting   | No   | Yes | Yes        |
| SAML 2.0 and SCIM provisioning                                 | No   | No  | Yes        |
| Per-project isolation, enforced in the database on every query | No   | Yes | Yes        |
| Usage reporting and monthly job and page quotas                | No   | Yes | Yes        |
| Team members, invitations, owner and member roles              | No   | No  | Yes        |
| Cross-project usage analytics                                  | No   | No  | Yes        |
| API key regeneration                                           | No   | No  | Yes        |
| Editable profile display name                                  | No   | No  | Yes        |

See [Authentication](/concepts/authentication/), [SAML single sign-on](/guides/saml-sso/), [SCIM provisioning](/guides/scim/) and [Teams and roles](/guides/teams-and-roles/).

## Processing scale and concurrency

|                                 | Core                               | Pro                                | Enterprise                                     |
| ------------------------------- | ---------------------------------- | ---------------------------------- | ---------------------------------------------- |
| Documents processed in parallel | `min(cores, 8)`                    | `min(cores, 8)`                    | `min(cores, 8)` per worker, across all workers |
| Documents per request           | Multiple                           | 10                                 | 10, fanned out                                 |
| Queued work                     | 100 jobs in flight, held in memory | Unbounded, durable in PostgreSQL   | Unbounded, durable in the message bus          |
| Time budget per document        | 10 minutes                         | 10 minutes                         | 10 minutes                                     |
| Autoscaling                     | None                               | Vertical: give the node more cores | On queue depth, with workers scaling to zero   |
| Cost when idle                  | None                               | One container                      | Workers scale to zero                          |

- **Throughput depends on the workload.** A text-native PDF and a 300-page scan that needs OCR differ by orders of magnitude. Treat the table as concurrency capacity, not a page rate. Xberg will size a deployment against a sample of your own documents.
- **PDFs that need layout inference process one at a time per node.** Raising the thread budget adds no parallel documents for that workload, so add nodes instead. This affects all three tiers.
- **Pro scales vertically, Enterprise horizontally.** Pro's ceiling is the largest node you are willing to run. Enterprise adds workers on queue depth and returns them when the queue drains.
- **Pro and Enterprise accept the same request.** The batch size, parallelism and time budget match. The difference is how far each scales out behind the request.
- Every limit above is a default, and operators can configure it. The shipped Pro container sets parallelism to 4.

## Related pages

- [What Pro replaces](/overview/what-pro-replaces/) lists the work you stop doing when you move up from Core.
- [Moving between tiers](/overview/moving-between-tiers/) explains how to change tiers without rewriting your integration.
- [Roadmap](/overview/roadmap/) lists what is not available yet.
