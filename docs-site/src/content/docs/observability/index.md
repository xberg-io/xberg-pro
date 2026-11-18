---
title: Observability
description: Xberg Pro and Enterprise emit structured logs, traces and metrics in OpenTelemetry format, plus a Prometheus scrape endpoint.
sidebar:
  order: 1
---

**Available in:** Pro, Enterprise

Xberg emits structured logs, traces and metrics in OpenTelemetry format over OTLP/gRPC. Route the signals to any OTel-compatible backend, such as Grafana, Datadog, New Relic or Honeycomb, by setting `OTEL_EXPORTER_OTLP_ENDPOINT`.

Both Helm charts leave the endpoint unset by default (`""`). You provision your own collector, and no endpoint is assumed. A service that starts without it logs one warning and keeps stdout logs and the Prometheus scrape on `/metrics`.

- [Schema](/observability/schema/): the contract for services, metrics, log fields, span names and label stability.
- [Self-hosting](/observability/self-hosting/): wire the signals into Grafana, Datadog, New Relic or another backend.
- [Dashboards](/observability/dashboards/): the reference Grafana dashboard catalog.
