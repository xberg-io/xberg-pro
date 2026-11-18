---
title: Dead-letter records
description: Inspect jobs that exhausted their delivery attempts, recorded by the worker in the failures KV bucket.
sidebar:
  order: 12
---

**Available in:** Enterprise

JetStream has no dead-letter stream. When a message on the `jobs` stream reaches the consumer's `max_deliver` without an ack, or a worker ends it with a `Term` ack, the server publishes an advisory and the message leaves the work queue. Every worker runs a listener that records those advisories in the `failures` key-value bucket, so the message leaves an artifact you can inspect.

## What is recorded

One record exists per message, under the key `<stream>.<stream sequence>`. A record holds these fields:

| Field                              | Meaning                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `stream`, `consumer`, `stream_seq` | Where the message lived and which consumer gave up on it.                                                     |
| `subject`                          | The message subject, for example `job.extract.standard.<project_id>`. Absent when `payload_base64` is absent. |
| `kind`                             | `max_deliveries` or `terminated`.                                                                             |
| `deliveries`                       | How many times the consumer received the message.                                                             |
| `reason`                           | The `Term` reason, when the worker gave one.                                                                  |
| `payload_base64`                   | The MessagePack payload, base64 encoded. Absent when the stream had already dropped the message.              |
| `recorded_at`                      | When the record was written.                                                                                  |

Records expire after 30 days.

## Inspect the bucket

The `worker` role's NATS permissions cover `nats kv get` on the `failures` bucket. The role holds publish rights on `$KV.failures.jobs.*` and the `$JS.API` subjects a `kv get` needs: `STREAM.INFO.KV_failures`, `STREAM.MSG.GET.KV_failures` and `DIRECT.GET.KV_failures`.

`nats kv ls` is the one command the `worker` role cannot run, because it needs `$JS.API.CONSUMER.CREATE.KV_failures`, which no runtime role holds. For `nats kv ls`, authenticate with the `nats-bootstrap-password` credential. The `bootstrap` role subscribes only to `_INBOX.bootstrap.>`, but the `nats` CLI defaults to a random `_INBOX.<nuid>` reply subject. Without `--inbox-prefix=_INBOX.bootstrap` the command hangs, waiting for a reply nothing is subscribed to receive.

```bash
# Needs the bootstrap credential and --inbox-prefix to match its subscribe rule.
nats kv ls failures --inbox-prefix=_INBOX.bootstrap

# Works with the worker credential, or with bootstrap plus --inbox-prefix.
nats kv get failures jobs.4213 --raw | jq .
nats kv get failures jobs.4213 --raw | jq -r .payload_base64 | base64 -d > payload.msgpack
```

## What a record does not do

A record is evidence, not a retry. A job whose message reached `max_deliver` is already `FAILED` in the database, and its `job.failed` webhook was sent, because the worker marks the failure terminal on the final delivery. A job that stayed `PROCESSING` because the worker died on its final delivery is failed by the stuck-job reaper after `STUCK_JOB_THRESHOLD_SECS` (default 7200 seconds).

## Why the listener must start

A worker refuses to start when it cannot subscribe to the advisories or reach the `failures` bucket. A worker that skipped the listener would process jobs whose dead letters nobody records.
