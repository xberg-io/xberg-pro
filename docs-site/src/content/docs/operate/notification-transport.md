---
title: Protected notification transport
description: Prepare the installation-specific NATS notification stream that replicated Enterprise requires before its pods start.
sidebar:
  order: 11
---

**Available in:** Enterprise (replicated deployments)

## When you need it

Replicated Enterprise (`deployment.mode=replicated`) sends job completion notifications through a dedicated NATS stream, `notifications-protected`, scoped to one installation. You must prepare it before the pods start. Non-replicated installs keep the existing `jobs` stream and `webhook-delivery` consumer and skip this page.

## Configure

Set the installation identifier in the Helm values. Both values must be the same UUID:

```yaml
deployment:
  installationId: 11111111-1111-4111-8111-111111111111
global:
  natsNotifications:
    prepared: true
    installationId: 11111111-1111-4111-8111-111111111111
```

The chart derives the consumer names and the NATS permissions for the API and webhook services from this UUID. Rendering fails if it is missing or does not match `deployment.installationId`. All generations of one installation share the same stream and consumer. The pods read the UUID at runtime as `ENTERPRISE_DEPLOYMENT_INSTALLATION_ID`.

The notification resources are required even when `webhooks.enabled=false`. The API still publishes completion references, and they expire after 24 hours if nothing reads them.

## Provision the stream

With the bundled NATS, the chart's provisioning Job creates the stream and consumer before the workloads become ready. Nothing else is needed.

With an external broker (`nats.enabled=false`), the broker must carry the same permissions the chart renders, and the stream must exist before replicated startup. The API image provides two offline commands that take the provisioning manifest the chart renders:

```sh
api --render-nats-policy /etc/xberg-nats/provisioning.json
NATS_URL="$NATS_URL" api --bootstrap-nats /etc/xberg-nats/provisioning.json
```

The first prints the permissions to apply to your broker. The second needs the bootstrap identity and creates the `notifications-protected` stream and its durable consumer. Runtime identities can only inspect these resources, not create them.

The manifest has two consumer fields, derived from the installation UUID without hyphens:

```json
{
  "webhook_protected": "protected-webhook-11111111111141118111111111111111",
  "webhook_protected_filter": "protected.notification.v1.11111111-1111-4111-8111-111111111111.>"
}
```

## Verify

The API checks both prepared streams at startup and in its readiness probe, and the webhook service checks its stream and consumer before it pulls. If a pod is not ready, check its logs for a message naming the missing stream or consumer. Then list the resources:

```sh
nats stream info notifications-protected
nats consumer ls notifications-protected
```

Use the bootstrap credential for these commands. Runtime identities cannot list consumers.

## Delivery behavior

- Messages are small references, not results. The webhook service rechecks the job and callback state in the database before it sends anything.
- The stream has a 4 KiB message limit, 24-hour retention and a two-hour deduplication window. A notification can be published again after an uncertain database commit, so receivers must tolerate duplicates.
- Messages for other installations, and legacy-mode messages, are ignored by this consumer.
- Process health markers written during storage qualification can remain after a crash. They are harmless.
