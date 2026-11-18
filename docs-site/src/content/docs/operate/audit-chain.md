---
title: Verify the audit chain
description: Check that a project's audit log is intact with the xberg-admin verifier, and backfill the hash chain for rows that predate it.
sidebar:
  order: 13
---

**Available in:** Pro

Every `audit_log` row commits to its predecessor by hash. A row that is altered or deleted after the fact leaves the chain unable to close. Verification walks a project's chain and reports the first break, which turns the audit log from a record into evidence. For what the log captures, see the [audit log guide](/guides/audit-log/).

The verifier ships in the Pro image as `/app/xberg-admin`. It reads the container's own `DATABASE_URL`, so an auditor needs no direct database session, which is the privilege an audit trail exists to make unnecessary.

## Run it

On Kubernetes, the chart deploys a single-replica StatefulSet whose container is named `pro`. The pod is named `<release>-pro-0` unless the release name already contains `pro`. In that case the chart's naming collapses the suffix, so a release named `xberg-pro` gives a pod named `xberg-pro-0`. Check `kubectl get pods` if you are unsure:

```bash
kubectl exec -it <release>-pro-0 -c pro -- \
  /app/xberg-admin audit-chain verify --project-id <uuid>
```

On Docker Compose:

```bash
docker compose -f docker-compose.pro.yml exec pro \
  /app/xberg-admin audit-chain verify --project-id <uuid>
```

The command exits `0` when the chain is intact and non-zero when it is broken, so a scheduled job can alert on the status code alone.

## One project per run

The verifier takes exactly one project ID and does not sweep. `audit_log` forces row-level security and the product has no `BYPASSRLS` role, so nothing can ask the database which projects exist without an escape-hatch policy that any caller could also satisfy. Drive the command from a project list you keep outside the database.

The SQL function refuses to run without the matching project context instead of returning no rows. A verification control must not answer "intact" when it means "I saw nothing".

## Read a break

An intact chain prints one line. A break prints the offending row, its position and the reason, followed by an `expected:` and a `found:` hash line. Each renders as `-` when the reason, for example `not_backfilled`, carries no hash to compare.

| Reason               | Meaning                                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `not_backfilled`     | A row is still at sequence 0. The project's rows predate the chain and were never numbered.                                      |
| `preamble_missing`   | The rows that predate the chain no longer match what the backfill recorded. The whole preamble was removed, or its last row was. |
| `seq_gap`            | The sequence skips a position, which means a deleted row unless it was the newest.                                               |
| `prev_hash_mismatch` | The row does not commit to its predecessor.                                                                                      |
| `row_hash_mismatch`  | The row's content differs from what was hashed.                                                                                  |

Only `not_backfilled` has a routine remedy. The other four mean rows changed after they were written, and the row the command names is where to start looking.

## Backfill once per project

A deployment that carried audit rows before the chain existed reports `not_backfilled` and never reports intact until those rows are numbered:

```bash
kubectl exec -it <release>-pro-0 -c pro -- \
  /app/xberg-admin audit-chain backfill --project-id <uuid>
```

Run it once per project. A second run finds nothing and reports zero rows. The backfill writes a marker row that commits to the preamble's length and last hash, which is what later lets `preamble_missing` catch a preamble deleted wholesale.
