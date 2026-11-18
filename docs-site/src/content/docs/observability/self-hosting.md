---
title: Self-hosting observability
description: Send Xberg logs, traces and metrics to Grafana, Datadog, New Relic or any OTLP-compatible backend.
sidebar:
  order: 4
---

**Available in:** Pro, Enterprise

Xberg exports logs, traces and metrics to any OpenTelemetry-compatible backend over OTLP/gRPC.

## Point services at a collector

Services do not push telemetry straight to a vendor. Set `OTEL_EXPORTER_OTLP_ENDPOINT` to your collector, or use a collector sidecar:

```yaml
env:
  - name: OTEL_EXPORTER_OTLP_ENDPOINT
    value: "http://otel-collector.observability:4317"
```

The standard OTLP/gRPC port is 4317, and any OpenTelemetry collector works.

One endpoint carries three signals: traces, log records with the trace and span ID of the request, and a metrics push. Logs also stay on stdout. To send one signal elsewhere, use the signal-specific variables `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` and `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`. A service that starts with the variable unset or empty logs one warning that names it, and keeps stdout logs and the `/metrics` scrape.

On Enterprise, the chart sets the variable on every service from `global.observability.otlpEndpoint`, and you can override one component through its `env` map. The default is `""`, which switches export off for the whole release. On Pro, set `OTEL_EXPORTER_OTLP_ENDPOINT` in `configMap`. Pro serves Prometheus metrics on `PRO_METRICS_ADDR` (default `0.0.0.0:9090`).

Neither chart ships a collector. Deploy the upstream OpenTelemetry Collector, or a distribution of it, and configure its receivers and exporters directly. The charts include `ServiceMonitor` support for clusters that run the Prometheus Operator.

## Grafana LGTM stack

The simplest path combines Loki (logs), Mimir (metrics) and Tempo (traces):

1. Deploy an OpenTelemetry Collector with the standard OTLP receiver and exporters for Loki, Mimir and Tempo.
2. Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4317` on the services.
3. Import the [reference dashboards](/observability/dashboards/) into Grafana. Provision datasources with the UIDs `loki`, `tempo` and `mimir`, and the dashboards need no changes.

## Datadog and New Relic

Hosted backends need an API key, which the services have no setting for. Point the services at your own collector and let the collector authenticate to the vendor. Load the key from a Secret into the collector's environment, never into the config file. For Datadog, use the collector's `datadog` exporter with `api::key: ${env:DD_API_KEY}`. For New Relic, use an `otlp` exporter with the header `api-key: ${env:NEW_RELIC_LICENSE_KEY}`:

```yaml
exporters:
  otlp/newrelic:
    endpoint: otlp.nr-data.net:4317
    headers:
      api-key: ${env:NEW_RELIC_LICENSE_KEY}
service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [otlp/newrelic]
```

Add matching `metrics` and `logs` pipelines for the other signals. Endpoints and options differ by vendor region, so check the vendor's OpenTelemetry documentation.

## Other backends

Substitute the endpoint URL of your backend. Per-service Helm values commonly set the following:

```yaml
env:
  OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel-collector.observability:4317"
  RUST_LOG: "info"
```

`OTEL_SERVICE_NAME` is set per service by the chart to a bare name such as `api`, so leave it alone. See the [schema](/observability/schema/) for the names.
