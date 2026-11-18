---
title: Teams and roles
description: Invite members to a project, assign Owner or Member roles, and define custom roles with granular permissions.
sidebar:
  order: 22
---

**Available in:** Enterprise

Teams and roles control who can do what in an Enterprise project.

Each member holds a base role, Owner or Member, and can also hold custom roles that grant specific permissions. Custom roles are also what [SCIM group mappings](/guides/scim/) and role-bound API keys point at.

These routes belong to the backend control plane. Call them with a session token for a signed-in project member, or use the Team page of the web console. Enable the web console with `frontend.enabled=true` in the chart values.

## Base roles

| Role     | Meaning                                                                                                                                        |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `OWNER`  | Full control of the project, including members, roles, SSO, SCIM and deletion. SSO enforcement does not apply to owners, as a break-glass path |
| `MEMBER` | Works in the project within the permissions of their custom roles                                                                              |

## Invite and manage members

Invite a person by email with a base role and, for a `MEMBER`, optional custom roles:

```bash
curl -X POST "$XBERG_URL/v1/projects/$PROJECT_ID/invitations" \
  -H "Authorization: Bearer $SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "email": "analyst@example.com", "role": "MEMBER", "custom_role_ids": ["<role uuid>"] }'
```

`GET /v1/projects/{id}/invitations` lists open invitations and `DELETE .../invitations/{inv_id}` revokes one. If SAML SSO is enabled, an invitee signs in through the identity provider; see [SAML single sign-on](/guides/saml-sso/). With SCIM, members are created and removed from the identity provider instead.

| Route                                                   | Purpose                                                           |
| ------------------------------------------------------- | ----------------------------------------------------------------- |
| `GET /v1/projects/{id}/members`                         | List members and their roles. `limit` accepts 1-1000, default 100 |
| `PATCH /v1/projects/{id}/members/{user_id}`             | Set the base role to `OWNER` or `MEMBER`                          |
| `DELETE /v1/projects/{id}/members/{user_id}`            | Remove a member                                                   |
| `PATCH /v1/projects/{id}/members/{user_id}/custom-role` | Assign custom roles with `custom_role_ids`                        |

## Custom roles

A custom role is a named set of permissions. Create one, then assign it to members:

```bash
curl -X POST "$XBERG_URL/v1/projects/$PROJECT_ID/roles" \
  -H "Authorization: Bearer $SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Extraction operator",
    "description": "Run and read extractions, no administration",
    "permissions": ["extraction.execute", "extraction.read", "job.read", "job.cancel", "document.read"]
  }'
```

Read, update and delete roles at `/v1/projects/{id}/roles` and `/v1/projects/{id}/roles/{role_id}`. Permissions are fixed identifiers. They include:

| Area                | Permissions                                                                                                                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project             | `project.read`, `project.update`, `project.delete`                                                                                                                                                                     |
| Extraction and jobs | `extraction.execute`, `extraction.read`, `job.read`, `job.cancel`, `document.read`                                                                                                                                     |
| RAG and tuning      | `rag.read`, `rag.update`, `preset.read`, `preset.manage`, `auto_tune.read`, `auto_tune.manage`                                                                                                                         |
| Members and roles   | `member.read`, `member.update`, `member.remove`, `member.leave`, `role.read`, `role.create`, `role.update`, `role.delete`, `role.assign`                                                                               |
| Invitations         | `invitation.read`, `invitation.create`, `invitation.revoke`                                                                                                                                                            |
| API keys            | `api_key.read`, `api_key.create`, `api_key.regenerate`, `api_key.revoke`                                                                                                                                               |
| Integrations        | `integration.read`, `integration.create`, `integration.delete`, `integration.connect`, `integration.disconnect`, `integration_document.read`                                                                           |
| Webhooks            | `webhook.read`, `webhook.create`, `webhook.update`, `webhook.delete`, `webhook.test`, `webhook_delivery.read`, `webhook_delivery.retry`                                                                                |
| Identity            | `scim.read`, `scim.manage`, `audit.read`                                                                                                                                                                               |
| Usage               | `usage.read`, `analytics.read`, `sandbox.execute`                                                                                                                                                                      |
| Data rooms          | `data_room.read`, `data_room.create`, `data_room.update`, `data_room.delete`, `data_room.manage`, `data_room.item.write`, `data_room.member.manage`, `data_room.transfer`, `data_room.publish`, `data_room.audit.read` |

A member's effective permissions are the union of all their roles. The full list of project permissions is in the backend OpenAPI specification; see the [API reference](/reference/api/).

## Role-bound API keys

`POST /v1/projects/{id}/api-keys/role-bound` issues a key limited to one custom role. A service that only submits documents then holds a key that cannot manage members or read the audit log. See [Projects and API keys](/guides/projects-and-api-keys/).
