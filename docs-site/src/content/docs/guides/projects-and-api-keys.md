---
title: Projects and API keys
description: Isolate work in projects, issue scoped API keys with expiry, and learn which credential authenticates which call.
sidebar:
  order: 8
---

**Available in:** Pro, Enterprise. Key regeneration, role-bound keys and project extraction defaults are Enterprise only.

A project is the unit of isolation. Jobs, documents, collections, presets, webhooks, integrations and audit entries belong to one project, and PostgreSQL row-level security enforces the boundary. An API key belongs to one project and cannot read or write another.

## Credentials

| Credential                         | Use                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| Project API key (`kz_...`)         | Data-plane calls from your services: extract, jobs, RAG, presets                 |
| Admin key (`XBERG_ADMIN_KEY`, Pro) | Instance control plane: create projects and keys, read the license and audit log |
| Session token                      | A signed-in person in the dashboard, through OIDC on Pro or SSO on Enterprise    |

Send keys as `Authorization: Bearer <key>`. Keys carry the prefix `kz_` and are shown in full only once, when you create them. See [Authentication](/concepts/authentication/).

## Create a project

On Pro, the admin key or a signed-in owner creates a project with a name and a URL-safe slug. Optional quota overrides are `max_file_size_mb` and `max_monthly_jobs`:

```bash
curl -X POST "$XBERG_URL/v1/projects" \
  -H "Authorization: Bearer $XBERG_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Claims intake", "slug": "claims-intake", "max_monthly_jobs": 50000 }'
```

`GET /v1/projects` lists the caller's own projects. `GET`, `PATCH` and `DELETE` on `/v1/projects/{project_id}` read, rename and delete one. A bare data-plane key cannot list projects, because its credential already names one.

A person who belongs to several projects selects one per request with the `X-Project-ID` header, or `project_id` in a JSON body. A project API key cannot select a different project.

## Create an API key

```bash
curl -X POST "$XBERG_URL/v1/projects/$PROJECT_ID/api-keys" \
  -H "Authorization: Bearer $XBERG_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "name": "ingest-service", "scope": "write", "expires_at": "2027-06-30T00:00:00Z" }'
```

| Field        | Meaning                                                                             |
| ------------ | ----------------------------------------------------------------------------------- |
| `name`       | Descriptive name. Optional on Pro, required on Enterprise                           |
| `scope`      | `write` (default) or `read`. A `read` key is refused on POST, PUT, PATCH and DELETE |
| `expires_at` | Optional ISO 8601 timestamp. Both tiers reject the key after it                     |

The response returns `id`, `key_prefix`, `scope`, `created_at` and, once only, the plaintext `key`. Store it in your secret manager immediately. `GET /v1/projects/{project_id}/api-keys` lists metadata (name, prefix, scope, timestamps) and never the key. `DELETE /v1/projects/{project_id}/api-keys/{key_id}` revokes one. Use a separate key per service so you can revoke one without touching the others, and use `read` keys for dashboards and reporting.

## Enterprise controls

On Enterprise, the backend serves the same routes under `/v1/projects/{id}/api-keys`, plus:

- `POST /v1/projects/{id}/api-keys/{key_id}/regenerate` replaces a key's secret and returns the new plaintext once.
- `POST /v1/projects/{id}/api-keys/role-bound` issues a key restricted to a custom project role, so its permissions are a subset of that role. See [Teams and roles](/guides/teams-and-roles/).

## Limits and usage

`GET /v1/usage` returns aggregate extraction usage for the authenticated project between inclusive start and exclusive end dates, and defaults to the current month. Per-project quotas on Pro are the `max_file_size_mb` and `max_monthly_jobs` overrides. Administrative actions are recorded in the [audit log](/guides/audit-log/).
