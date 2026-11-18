---
title: Dead-letter records
description: Inspect jobs that exhausted their delivery attempts, recorded by the worker in the failures KV bucket.
sidebar:
  order: 12
---

**Available in:** Enterprise

JetStream has no dead-letter stream. When a message on the `jobs` stream reaches the consumer's `max_deliver` without an ack, or a worker ends it with a `Term` ack, the message leaves the work queue. Every worker records these events in the `failures` key-value bucket, so the message leaves an artifact you can inspect.

## What is recorded

One record exists per message, under the key `<stream>.<stream sequence>`. A record holds these fields:

| Field                              | Meaning                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `stream`, `consumer`, `stream_seq` | Where the message lived and which consumer gave up on it.                                                     |
| `subject`                          | The message subject, for example `job.extract.standard.<project_id>`. Absent when `payload_base64` is absent. |
| `kind`                             | `max_deliveries` or `terminated`.                                                                             |
| `deliveries`                       | How many times the consumer received the message.                                                             |
| `reason`                           | The `Term` reason, when the worker gave one.                                                                  |
| `payload_base64`                   | The message payload, base64 encoded. Absent when the stream had already dropped the message.                  |
| `recorded_at`                      | When the record was written.                                                                                  |

Records expire after 30 days.

## Inspect the bucket

Use the NATS CLI with a credential that may read the `failures` bucket. The `worker` credential can run `nats kv get`. Listing keys with `nats kv ls` needs the `nats-bootstrap-password` credential, and the command needs `--inbox-prefix=_INBOX.bootstrap` or it hangs.

```bash
nats kv ls failures --inbox-prefix=_INBOX.bootstrap
nats kv get failures jobs.4213 --raw | jq .
nats kv get failures jobs.4213 --raw | jq -r .payload_base64 | base64 -d > payload.bin
```

## What a record does not do

A record is evidence, not a retry. A job whose message reached `max_deliver` is already `FAILED` in the database, and its `job.failed` webhook was sent, because the worker marks the failure terminal on the final delivery. A job that stayed `PROCESSING` because the worker died on its final delivery is failed by the stuck-job reaper after `STUCK_JOB_THRESHOLD_SECS` (default 7200 seconds).

A worker refuses to start when it cannot reach the `failures` bucket.
