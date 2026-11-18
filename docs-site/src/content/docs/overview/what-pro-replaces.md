---
title: What Pro replaces
description: The infrastructure and maintenance work a team stops doing when it moves from the Core library to Xberg Pro.
---

With Core, you embed the extraction engine and build everything around it. Pro replaces that surrounding work with one supported product, so you stop maintaining it.

## The work Pro takes over

| You would build                                       | Pro provides                                                                                                                                        |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| A durable queue with retries and dead-lettering       | Jobs persisted in PostgreSQL, with history that survives a restart and a dead-letter view. See [Dead letters](/operate/dead-letters/).              |
| Storage plumbing for several backends                 | S3, GCS, Azure Blob and filesystem storage, plus presigned uploads. See [Storage](/operate/storage/).                                               |
| API-key authentication and project scoping            | API keys with read and write scopes, multiple projects, and row-level security on every query. See [Authentication](/concepts/authentication/).     |
| An append-only audit trail                            | A hash-chained audit log with a verification routine. See [Audit log](/guides/audit-log/).                                                          |
| A retrieval layer over extracted text                 | Collections, ingest pipelines, hybrid search and reranking on PostgreSQL. See [RAG](/guides/rag/).                                                  |
| Connectors to the places documents live               | Google Drive, Dropbox, OneDrive, SharePoint, Notion, Confluence, S3, GCS, Azure Blob and SFTP. See [Source connectors](/guides/source-connectors/). |
| A crawler wired into extraction                       | Robots.txt-aware crawling with per-domain rate limits. See [Crawling](/guides/crawling/).                                                           |
| Tuning for your document mix                          | Auto-Tune searches your corpus for the settings that extract it best. See [Auto-Tune](/guides/auto-tune/).                                          |
| Dashboards and metrics                                | Prometheus metrics and OpenTelemetry traces, with Grafana dashboards delivered through support. See [Observability](/observability/).               |
| A console your team can use without going through you | A web console with a playground, job history and settings.                                                                                          |

## What does not change

The extraction engine stays the same. Formats, OCR, layout models, structured extraction and output formats behave as they do in Core, so results from your existing Core integration carry over.

You still run your own PostgreSQL and object storage, and you still choose where the deployment lives. Pro adds software, not a hosted dependency. Your documents stay on your infrastructure.

## When Core is the better fit

Stay on Core when you embed extraction inside an application that already owns its own scheduling, storage and access control, or when you process documents in a single short-lived process. Move to Pro when you find yourself building a queue, a storage layer or an audit trail around Core. See [Core, Pro and Enterprise](/overview/tiers/) for the full comparison.
