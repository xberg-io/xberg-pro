---
title: Protected notification transport
description: Configure the installation-specific NATS notification manifest that replicated Enterprise extraction requires.
sidebar:
  order: 11
---

**Available in:** Enterprise, replicated deployments

Replicated extraction needs an installation-specific notification manifest alongside the prepared extraction transport. Legacy mode keeps the existing `jobs` stream and `webhook-delivery` consumer.

## Manifest fields

Set both optional manifest fields under `consumers`:

```json
{
  "webhook_protected": "protected-webhook-11111111111141118111111111111111",
  "webhook_protected_filter": "protected.notification.v1.11111111-1111-4111-8111-111111111111.>"
}
```

The durable suffix is the installation UUID without hyphens. The filter contains the exact canonical installation UUID. Both fields must match `ENTERPRISE_DEPLOYMENT_INSTALLATION_ID` at runtime. Generations A and B of one installation share this durable.

## Helm values

Set `global.natsNotifications.prepared=true` and `global.natsNotifications.installationId` to the same UUID as `deployment.installationId`. The chart derives both consumer fields and the conditional API and webhook permissions from that one value. Rendering a replicated chart fails when the binding is absent or mismatched. An externally managed broker must use the rendered policy too, because the chart does not assume separate accounts or namespaces.

## Render the policy and provision the stream

Use the service binary's offline `--render-nats-policy <manifest>` command to render the exact optional permissions. Apply that policy to the broker through your normal configuration workflow. Then run `--bootstrap-nats <manifest>` with the bootstrap identity and `NATS_URL` to provision the `notifications-protected` stream and its durable. Runtime API and webhook identities only inspect existing resources and cannot create consumers or streams.

The API keeps its normal NATS connection for notification publication. It authenticates extraction requests separately with `NATS_EXTRACTION_PUBLISHER_USER` and `NATS_EXTRACTION_PUBLISHER_PASSWORD`, so no new notification credential is needed. API startup and readiness verify both prepared lanes. Webhook startup verifies its installation binding and the exact stream and consumer configuration before it pulls.

## Messages and delivery

Notification subjects follow `protected.notification.v1.<installation>.<completed|failed|cancelled>.<project>`. The MessagePack payload is a minimal `JobCompletion` reference, with the durable SQL event UUID as `Nats-Msg-Id`. It carries no result, caller metadata, inline callback or LLM payload. SQL stays authoritative: webhook delivery verifies the event, job, project, installation, runtime admission and callback state instead of trusting message fields.

The stream uses work-queue retention, a 4 KiB message cap, 24-hour retention and a two-hour deduplication window. A publication followed by an ambiguous SQL commit can replay, so delivery is not exactly-once. Messages from legacy mode and from other installations fall outside the installation's durable filter. Synthetic process health markers use exact Get, Put and Delete access. They do not replace the shared-storage qualification protocol, and they can remain after a crash.

The notification resource pair is still required when `webhooks.enabled=false`. The API durably publishes minimal terminal references while no webhook workload runs, and the admission cohort contains only the enabled API and worker components. References expire after the stream retention period if no reader runs. Preparing the durable creates no webhook runtime identity and adds no credential.
