---
title: Observability schema
description: The telemetry contract for Xberg Pro and Enterprise, covering services, metrics, log fields, trace spans and label stability.
sidebar:
  order: 2
---

**Available in:** Pro, Enterprise

This page is the contract for Xberg telemetry: metric names and labels, log fields, span names, and how they change over time.

## Services

`OTEL_SERVICE_NAME` is set per component to a bare name with no `xberg-` prefix. Kubernetes namespace and cluster encode the environment, not the service name.

| Service             | `service.name`             | Telemetry                                                                        |
| ------------------- | -------------------------- | -------------------------------------------------------------------------------- |
| API                 | `api`                      | HTTP RED, job submission and status, NATS publishes, database pool               |
| Backend             | `backend`                  | HTTP RED, auth attempts, JWT validation, project and member state, database pool |
| Worker              | `worker` (or `worker-gpu`) | Job processing, extraction outcomes, NATS consumer lag, crawl metrics            |
| Webhook             | `webhooks`                 | HTTP POST delivery, retries, delivery duration, queue depth                      |
| RAG                 | `rag`                      | Ingestion and enrichment pipeline                                                |
| Vector index worker | `vector-index-worker`      | Vector index build and maintenance                                               |
| Vector index broker | `vector-index-broker`      | Vector index query routing                                                       |
| Data loader         | `data-loader`              | Reference-data load jobs                                                         |
| Pro                 | `pro`                      | Single-container request, job, license, audit and webhook telemetry              |

Enterprise runs the first eight services. Pro runs one process that reports as `pro`.

## Metrics

The Prometheus endpoint appends no suffixes, so the names below are exactly what you query. Most counters end in `_total`, but not all do. See the `audit_write_failures` note under Pro. Label keys use dotted OpenTelemetry names in the tables and appear with underscores in Prometheus, so `http.request.method` becomes `http_request_method`.

### HTTP RED (all services)

| Metric                          | Type                  | Unit    | Labels                                                               | Description           |
| ------------------------------- | --------------------- | ------- | -------------------------------------------------------------------- | --------------------- |
| `http_request_duration_seconds` | Histogram             | seconds | `http.request.method`, `http.route`, `http.response.status_code`     | Request latency       |
| `http_requests_total`           | Counter               | count   | `http.request.method`, `http.route`, `http.response.status_code`     | Total requests        |
| `http_errors_total`             | Counter               | count   | `http.request.method`, `http.route`, `status_class` (`4xx` or `5xx`) | 4xx and 5xx responses |
| `http_active_requests`          | UpDownCounter (gauge) | count   | none                                                                 | Requests in flight    |

`http.route` carries the matched route template, never the raw request path. An unmatched request records the single `<unmatched>` bucket, so an attacker-controlled path cannot create new series.

Each service also emits two unlabelled process gauges: `process_resident_memory_bytes` and `process_cpu_usage_percent`.

### Database

| Metric                         | Type      | Unit        | Labels                                  | Description                                                         |
| ------------------------------ | --------- | ----------- | --------------------------------------- | ------------------------------------------------------------------- |
| `db_connections_active`        | Gauge     | connections | none                                    | Application pool connections in use (legacy, application pool only) |
| `db_connections_idle`          | Gauge     | connections | none                                    | Application pool idle connections (legacy, application pool only)   |
| `db_pool_connections_active`   | Gauge     | connections | `pool` (`application` or `maintenance`) | Connections in use, per pool                                        |
| `db_pool_connections_idle`     | Gauge     | connections | `pool`                                  | Idle connections, per pool                                          |
| `db_pool_connections_capacity` | Gauge     | connections | `pool`                                  | Configured maximum connections, per pool                            |
| `db_query_duration_seconds`    | Histogram | seconds     | `query`                                 | Query execution time                                                |

### NATS messaging (Enterprise)

Each consuming service (worker, webhook) emits these.

| Metric                         | Type    | Unit     | Labels   | Description                              |
| ------------------------------ | ------- | -------- | -------- | ---------------------------------------- |
| `nats_consumer_lag`            | Gauge   | messages | none     | Messages waiting in the consumer's queue |
| `nats_messages_consumed_total` | Counter | count    | `stream` | Messages consumed                        |

### Outbound HTTP

Every outbound call the platform makes emits these: webhook delivery, crawling, storage endpoints and LLM provider calls.

| Metric                                   | Type      | Unit    | Labels                                                                                           | Description                  |
| ---------------------------------------- | --------- | ------- | ------------------------------------------------------------------------------------------------ | ---------------------------- |
| `outbound_http_requests_total`           | Counter   | count   | `call_site`, `outcome` (`ok`, `denied_by_policy`, `denied_by_dns`, `timeout`, `transport_error`) | Outbound requests by outcome |
| `outbound_http_request_duration_seconds` | Histogram | seconds | `call_site`                                                                                      | Outbound request latency     |

### Worker

| Metric                                                         | Type                  | Unit    | Labels                                                                                      | Description                                            |
| -------------------------------------------------------------- | --------------------- | ------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `jobs_processed_total`                                         | Counter               | count   | `status` (`completed` or `failed`)                                                          | Jobs that reached a terminal state                     |
| `job_processing_duration_seconds`                              | Histogram             | seconds | none                                                                                        | Wall-clock extraction time (cache hits record nothing) |
| `extraction_errors_total`                                      | Counter               | count   | by error type                                                                               | Extraction errors                                      |
| `extraction_outcomes_total`                                    | Counter               | count   | `result` (`success` or `failure`), `error_category`, `mime_type`                            | Terminal extraction outcome per document               |
| `job_memory_peak_mb`                                           | Histogram             | MB      | none                                                                                        | Peak memory per job                                    |
| `job_cpu_avg_percent`                                          | Histogram             | percent | none                                                                                        | Average CPU during job processing                      |
| `worker_active_jobs`                                           | UpDownCounter (gauge) | count   | none                                                                                        | Active job processing tasks                            |
| `crawl_jobs_total`                                             | Counter               | count   | terminal status, `output_mode`                                                              | Crawl jobs by outcome                                  |
| `crawl_pages_total`                                            | Counter               | count   | `fetched` or `failed`                                                                       | Pages fetched by the crawler                           |
| `crawl_duration_seconds`                                       | Histogram             | seconds | `output_mode`                                                                               | End-to-end crawl duration                              |
| `llm_tokens_total`                                             | Counter               | count   | `provider`, `model`                                                                         | LLM tokens used for structured extraction              |
| `llm_calls_total`                                              | Counter               | count   | `provider`, `model`, `result` (`success`, `timeout`, `rate_limit`, `server_error`, `other`) | LLM provider calls                                     |
| `llm_call_duration_seconds`                                    | Histogram             | seconds | `provider`, `model`                                                                         | LLM provider call latency                              |
| `extraction_cache_hits_total`, `extraction_cache_misses_total` | Counter               | count   | none                                                                                        | Extraction cache effectiveness                         |

In the processes that run the extraction engine (the worker and Pro), structured extraction emits `structured_extraction_total`, `structured_extraction_duration_seconds`, `structured_extraction_vision_calls_total`, `structured_extraction_tokens_total`, `structured_extraction_cache_hits_total`, `structured_extraction_cache_misses_total`, `structured_extraction_fallback_total` and the confidence histograms `structured_extraction_text_confidence` and `structured_extraction_final_confidence`. The result cache emits `cache_requests_total`, `cache_purge_total` and `cache_corruption_total`, labelled by `namespace` and `result` (corruption by tier).

The worker also emits a long tail of crawl fan-out and reaper counters, such as `crawl_documents_discovered_total`, `crawl_children_spawned_total`, `crawl_quota_exhaustion_total` and `worker_reaper_stuck_jobs_failed_total`. List them from the `/metrics` endpoint of a running worker.

### Webhook

| Metric                              | Type      | Unit     | Labels                                                     | Description                          |
| ----------------------------------- | --------- | -------- | ---------------------------------------------------------- | ------------------------------------ |
| `webhook_deliveries_total`          | Counter   | count    | `status` (`success`, `transient_error`, `permanent_error`) | Delivery attempts by outcome         |
| `webhook_delivery_duration_seconds` | Histogram | seconds  | none                                                       | Delivery HTTP request duration       |
| `webhook_retries_total`             | Counter   | count    | none                                                       | Delivery retry attempts              |
| `webhook_queue_depth`               | Gauge     | count    | none                                                       | Events currently queued for delivery |
| `webhook_http_errors_total`         | Counter   | count    | `status_code`                                              | HTTP errors from delivery attempts   |
| `nats_messages_consumed_total`      | Counter   | count    | `stream`                                                   | NATS messages consumed               |
| `nats_consumer_lag`                 | Gauge     | messages | none                                                       | Consumer backlog                     |

### Pro

Pro registers the same `jobs_submitted_total`, `jobs_processed_total`, `job_processing_duration_seconds` and `webhook_deliveries_total` names that Enterprise's API and worker services use, so one dashboard reads either tier for those.

One name differs between tiers. Pro emits `audit_write_failures_total`, while the Enterprise API and backend register the same counter as `audit_write_failures` with no `_total`. A panel written against one tier reads empty on the other. The shipped Pro dashboard queries the `_total` form, and the Enterprise dashboards do not. Neither the Enterprise worker nor the webhook service emits it.

Pro adds these metrics:

| Metric                                                                  | Type    | Unit         | Labels                                                                         | Description                                                                      |
| ----------------------------------------------------------------------- | ------- | ------------ | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `xberg_license_valid`                                                   | Gauge   | 0 or 1       | none                                                                           | 1 if the license is currently valid                                              |
| `xberg_license_expiry_timestamp_seconds`                                | Gauge   | Unix seconds | none                                                                           | License expiry (0 if none or invalid)                                            |
| `xberg_license_state`                                                   | Gauge   | 0 or 1       | `state` (`valid`, `grace`, `expired`, `invalid`, `absent`)                     | One series per label, with `1` for the current state                             |
| `integration_kek_loaded_key_fingerprint`                                | Gauge   | word         | `word` (0 to 3)                                                                | Non-secret proof of which key-encryption key the process loaded                  |
| `data_volume_available_bytes`                                           | Gauge   | bytes        | none                                                                           | Free space on the filesystem behind the `fs` document store                      |
| `data_volume_sample_failures_total`                                     | Counter | count        | none                                                                           | Failed free-space samples                                                        |
| `pro_upload_retained_unknown_writers`                                   | Gauge   | count        | none                                                                           | Expired upload cleanup records kept for writers whose completion is unknown      |
| `pro_upload_oldest_unknown_writer_age_seconds`                          | Gauge   | seconds      | none                                                                           | Age of the oldest such record since its upload capability expired                |
| `pro_abandoned_s3_input_cleanup_candidate_events_total`                 | Counter | count        | `event` (`started`, `acknowledged`, `not_authorized`, `unconfirmed`, `failed`) | Abandoned S3 input cleanup candidates, when `PRO_INPUT_S3_CLEANUP_ENABLED` is on |
| `pro_abandoned_s3_input_cleanup_sweep_events_total`                     | Counter | count        | `event` (`completed`, `not_authorized`, `failed`)                              | Abandoned input discovery sweeps                                                 |
| `pro_abandoned_s3_input_cleanup_last_completed_sweep_timestamp_seconds` | Gauge   | Unix seconds | none                                                                           | When the process last finished an authorized sweep                               |

## Log fields

All services can emit structured JSON logs. JSON format is enabled whenever an OTLP endpoint is configured. With no endpoint set, logs stay in a human-readable format.

The log message lands under `fields.message`, not at the top level. No `spans` array exists: only the fields of the current span are attached, under `span`.

```json
{
  "timestamp": "2026-05-16T14:22:33.123456Z",
  "level": "INFO",
  "span": {
    "name": "api.get_job",
    "job_id": "01ARZ3NDEKTSV4RRFFQ69G5FAW",
    "project_id": "01ARZ3NDEKTSV4RRFFQ69G5FAX"
  },
  "fields": {
    "message": "job fetched"
  }
}
```

Trace context propagates across service boundaries through W3C TraceContext headers.

## Trace spans

| Service | Spans                                                                  |
| ------- | ---------------------------------------------------------------------- |
| API     | `api.list_jobs`, `api.get_job`, `api.get_job_result`, `api.cancel_job` |
| Backend | `backend.list_projects`, `backend.create_project`                      |
| Worker  | `worker.process_job`, `worker.process_extraction`                      |
| Webhook | `webhook.process_message`                                              |
| Pro     | `pro.extract`, `pro.job.process`, `pro.auth.request`                   |

Webhook delivery has no per-delivery span. Use the `webhook_deliveries_total` and `webhook_delivery_duration_seconds` metrics for delivery telemetry.

Spans carry context fields such as `project_id` and `job_id`.

## Label stability

Treat metric names, log field names and span names as the contract that dashboards and alerts depend on. Pin your dashboards to the names on this page, and read the release notes before you upgrade. The one known divergence between tiers is the audit write failure counter described under Pro.
