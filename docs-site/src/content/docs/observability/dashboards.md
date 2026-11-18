---
title: Dashboards
description: The reference Grafana dashboards for Xberg Pro and Enterprise, and the datasources they expect.
sidebar:
  order: 3
---

**Available in:** Pro, Enterprise

Eight reference Grafana dashboards cover Xberg Pro and Enterprise. To obtain the dashboard JSON files for your release, contact your Xberg support channel (see [Support](/more/support/)). Import them into your Grafana instance.

| Dashboard | Scope                                                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Overview  | System-wide health across Enterprise services                                                                                   |
| API       | HTTP RED, auth attempts, NATS publishes, database connections and latency, logs                                                 |
| Backend   | HTTP RED, auth attempts, JWT validations, database, logs                                                                        |
| Worker    | Throughput, error rate, p99 duration, NATS lag, jobs processed, extraction errors, database, logs                               |
| Pro       | Request rate, 5xx rate, p99 latency, in-flight requests, jobs by status, job duration, webhook deliveries, audit write failures |
| Webhook   | Deliveries, retries, HTTP errors, queue depth, delivery duration                                                                |
| Database  | Pool usage, p50 and p99 latency, active and idle connections, latency distribution                                              |
| Logs      | Unified log stream with label filters by service and level                                                                      |

No RAG, vector-index or infrastructure dashboards ship. Build NATS, Kubernetes and GitOps dashboards in your own platform tooling.

## Datasources

The dashboards expect Grafana datasources with these UIDs:

| UID     | Backend |
| ------- | ------- |
| `loki`  | Logs    |
| `tempo` | Traces  |
| `mimir` | Metrics |

If your datasources use different UIDs, update the `uid` references in the dashboard JSON before you import it. The dashboards use standard Grafana templating, so you can adapt panel queries to your own label set.

See [Self-hosting observability](/observability/self-hosting/) for how to route telemetry to these backends, and the [schema](/observability/schema/) for the metrics the panels query.
