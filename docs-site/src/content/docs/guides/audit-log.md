---
title: Audit log
description: Read the per-project record of who did what, filter it by action, and understand how entries are written and retained.
sidebar:
  order: 9
---

**Available in:** Pro, Enterprise

The audit log records who did what in a project, so you can review security-relevant and administrative actions.

Each entry has a named action such as `job.submit`. Entries are written in the same database that holds the project. The log needs no setup. A failed audit write is counted in the `audit_write_failures_total{action}` metric instead of being dropped silently, so alert on that metric.

## Read the log

On the data plane, `GET /v1/audit` returns the entries of the caller's own project. It requires an admin or the project owner:

```bash
curl "$XBERG_URL/v1/audit?action=job.submit&limit=50&offset=0" \
  -H "Authorization: Bearer $XBERG_ADMIN_KEY"
```

| Parameter             | Rule                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| `action`              | Optional. Matches a known audit action exactly, for example `job.submit`. Unknown actions answer `400` |
| `limit`               | 1-100, default 50. Values outside the range are rejected                                               |
| `offset`              | 0-1,000,000, default 0. Values outside the range are rejected                                          |
| `X-Project-ID` header | Selects a project for a signed-in member. A project API key cannot select another project              |

A caller that is neither an admin nor the project owner gets `403`. An unknown `action` or an out-of-range page value gets `400`.

On Enterprise, the web console backend serves the same data to project members at `GET /v1/projects/{id}/audit`.

## Integrity

Audit entries form a hash chain, so a missing or altered row is detectable, and the Pro image ships a verifier. See [Audit chain](/operate/audit-chain/) for how to run it. Retrieval audit records are kept for `ragAudit.retentionDays` on Enterprise or `RAG_AUDIT_RETENTION_DAYS` on Pro (default 90); query text is stored only when the collection sets `audit_query_content`.

## Related

Webhook delivery history on Enterprise has its own seven-day record, described in [Webhooks](/guides/webhooks/#delivery-history-and-redelivery). Audit and job metrics are listed in [Observability](/observability/).
