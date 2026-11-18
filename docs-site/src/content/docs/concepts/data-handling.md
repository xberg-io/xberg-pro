---
title: Data handling
description: Where Xberg keeps your documents and results, and what leaves a self-hosted deployment.
sidebar:
  order: 5
---

This page is for security reviewers. It states where data lives in each deployment model and which outbound connections a deployment makes. Each statement names the setting or component that makes it true.

## Deployment model

Xberg Pro and Xberg Enterprise are both self-hosted. Pro runs as one container next to your PostgreSQL and your object storage. Enterprise runs on your Kubernetes cluster with your PostgreSQL, your NATS and your object storage. In both cases the documents, results and metadata stay in infrastructure you operate. Nothing enters Xberg-operated infrastructure.

Data residency is a deployment choice, not a setting. You choose the cloud, region and storage bucket by choosing where to deploy.

## What a deployment stores

| Data                                        | Where                                                          | Setting                                                                                                                |
| ------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Uploaded documents and extraction results   | Your object storage or local disk                              | `STORAGE_PROVIDER` (`fs`, `s3`, `gcs`, `azure`) with `STORAGE_BUCKET` or `STORAGE_FS_ROOT`                             |
| Job metadata, audit log, projects, API keys | Your PostgreSQL                                                | `DATABASE_URL`                                                                                                         |
| RAG chunks and vectors                      | Your PostgreSQL, with pgvector                                 | `DATABASE_URL`                                                                                                         |
| Extraction result cache (Enterprise)        | NATS JetStream key-value store                                 | NATS runs in your cluster                                                                                              |
| Local result cache (Pro)                    | Local disk, and your object storage when the object tier is on | `CACHE_ENABLED`, `CACHE_DIR`, `CACHE_MAX_BYTES`, `CACHE_TTL_SECS`, `CACHE_OBJECT_STORE_ENABLED`, `CACHE_OBJECT_PREFIX` |
| Integration credentials and OAuth tokens    | Your PostgreSQL, encrypted with AES-256-GCM                    | `INTEGRATION_KEK`                                                                                                      |
| Model weights                               | Local disk or your object storage, rooted at `XBERG_CACHE_DIR` | `HF_HOME` (Pro), `worker.modelCache` (Enterprise)                                                                      |

Project data access uses PostgreSQL row-level security and scoped capability functions. Deployment coordination uses separate installation-scoped capabilities. See [Security](/overview/security/).

## Extraction-only data policy

Set `dataPolicy: extraction_only` in the Pro or Enterprise Helm chart. Outside Helm, set `XBERG_DATA_POLICY=extraction_only` in every participating service. The policy blocks RAG payload reads and writes and disables extraction-result caching. Status, cancellation and erasure remain available for existing RAG data. Pro also exposes `configMap.PRO_RAG_ENABLED` to disable the RAG feature separately.

An accepted extraction-only job keeps that restriction if you later change the operator policy to `standard`. Changing the policy does not erase historical rows, objects, caches or backups, so apply your erasure and retention procedures separately.

PostgreSQL remains required. Operational records include identifiers, ownership, filenames, MIME types, configuration, lifecycle and recovery information, and usage counters. Extraction-only mode suppresses document-derived submission metadata, bounds persisted extraction failures and skips Pro structured extraction recording. Input and result objects still use your configured storage provider and retention rules.

The system cannot satisfy a requirement that no customer information enters PostgreSQL. `XBERG_DATA_POLICY=strict_sql` is rejected because no separate strict SQL policy exists.

## What leaves a self-hosted deployment

Outbound connections depend on your configuration.

- **Your configured infrastructure.** Services connect to PostgreSQL, object storage and, on Enterprise, the NATS broker. Workload identity can also contact the cloud provider's credential endpoints, such as AWS STS or the EKS Pod Identity agent.
- **Model downloads.** On first use, models come from Hugging Face Hub and, for Tesseract language files that the image does not ship, from GitHub. A deployment without internet egress pre-seeds the cache instead. See [Air-gapped installation](/operate/air-gapped/).
- **LLM providers, only when you configure one.** Structured extraction, vision OCR and LLM reranking send document content to the provider named in `XBERG_MANAGED_LLM_PROVIDER`, `XBERG_VLM_OCR_MODEL` or `PRO_VISION_BASE_URL`. With no provider configured, no document content leaves the deployment.
- **Webhooks.** Deliveries go to the URLs you register. The outbound policy refuses private and link-local addresses. See [Security](/overview/security/).
- **Your identity provider, only when OIDC login is configured.** Token verification fetches the issuer's JWKS. Set `OIDC_JWKS_URI` to skip discovery, or leave it unset and Xberg asks the issuer at `OIDC_ISSUER_URL`.
- **OAuth providers, only when the integration hub is configured.** Access goes to the provider's APIs with the OAuth client you registered.
- **Crawling.** A crawl job fetches the URLs you submit.
- **Product analytics, only when you set a sink.** Usage events go out only when `SEGMENT_WRITE_KEY`, or `GA4_MEASUREMENT_ID` together with `GA4_API_SECRET`, is set. All are unset by default, so a self-hosted deployment sends no usage events.

License verification is local. Pro checks the Ed25519 signature of `XBERG_LICENSE_KEY` against a public key inside the image at start and re-checks it hourly. A license is required to run, and the check never calls home. See [Licensing](/reference/licensing/).

Telemetry (traces, metrics and logs) goes to the OTLP collector you name in `OTEL_EXPORTER_OTLP_ENDPOINT`. With the variable unset, logs stay on stdout and metrics stay on the local `/metrics` endpoint.

## Certifications

Xberg does not hold SOC 2 or ISO 27001 certification, and no audit is in progress. A self-hosted deployment runs inside your own certified boundary and inherits your controls.
