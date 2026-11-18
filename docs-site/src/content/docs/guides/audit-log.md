---
title: Audit log
description: Read the per-project record of who did what, filter it by action, and understand how entries are written and retained.
sidebar:
  order: 9
---

**Available in:** Pro, Enterprise

The audit log records security-relevant and administrative actions in a project, each under a named action such as `job.submit`. Entries are written in the same database that holds the project, and a failed audit write is counted in the `audit_write_failures_total{action}` metric instead of being dropped silently.

## Read the log

On the data plane, `GET /v1/audit` returns the entries of the caller's own project. It requires an admin or the project owner:

```bash
curl "$XBERG_URL/v1/audit?action=job.submit&limit=50&offset=0" \
  -H "Authorization: Bearer $XBERG_ADMIN_KEY"
```

| Parameter             | Rule                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| `action`              | Optional. Matches a known audit action exactly, for example `job.submit`. Unknown actions answer `400` |
| `limit`               | 1-100, default 50                                                                                      |
| `offset`              | 0-1,000,000, default 0                                                                                 |
| `X-Project-ID` header | Selects a project for a signed-in member. A project API key cannot select another project              |

On Enterprise, the dashboard backend serves the same data to project members at `GET /v1/projects/{id}/audit`.

## Integrity

Audit entries form a hash chain, so a missing or altered row is detectable, and the Pro image ships a verifier. See [Audit chain](/operate/audit-chain/) for how to run it. Retrieval audit rows for RAG (`rag_audit_events`) are kept for `RAG_AUDIT_RETENTION_DAYS` (default 90, range 1-36,500); the maintenance loop drops a monthly partition once the whole month is past that age.

## Related

Webhook delivery history on Enterprise has its own seven-day record, described in [Webhooks](/guides/webhooks/#delivery-history-and-redelivery). Audit and job metrics are listed in [Observability](/observability/).
