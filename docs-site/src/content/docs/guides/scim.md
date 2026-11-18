---
title: SCIM provisioning
description: Provision and deprovision project members and map identity-provider groups to custom roles with SCIM 2.0, validated for Microsoft Entra ID.
sidebar:
  order: 21
---

**Available in:** Enterprise

SCIM provisioning creates and removes project members automatically from your identity provider.

Each project exposes one tenant-isolated SCIM 2.0 endpoint. Your identity provider creates, updates and deactivates project members through it, and group memberships map to custom project roles. Microsoft Entra ID is the validated provider. A project owner enables it by creating a connection, as described below.

## What is supported

The endpoint implements the discovery routes of RFC 7643 and RFC 7644 (`ServiceProviderConfig`, `ResourceTypes`, `Schemas`), Users and Groups, pagination, allowlisted equality filters, weak ETags, deactivation and restoration. Deactivation removes only the provisioned project membership. SCIM cannot create an Owner membership, and an existing Owner is never claimed or demoted by SCIM.

## Create a connection

A project owner creates a connection from the Team page, or with the API. Each project has one active connection:

```bash
curl -X POST "$XBERG_URL/v1/projects/$PROJECT_ID/scim/connections" \
  -H "Authorization: Bearer $SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "display_name": "Entra ID" }'
```

The response returns the connection, a `client_secret`, its `client_secret_expires_at`, the `token_endpoint` and the SCIM `base_url`. The secret is shown once and expires after two years, so rotate it before then. Copy these values into the provisioning configuration of an Entra enterprise application, then run **Test Connection**.

Rotate the credential with `POST /v1/projects/{id}/scim/connections/{connection_id}/rotate`, which replaces the secret and revokes its existing access tokens. Disable the connection with `.../revoke`.

## Authentication

The identity provider authenticates with OAuth 2.0 client credentials at `/scim/v2/{connection_id}/oauth2/token`. The endpoint accepts RFC 6749 HTTP Basic credentials and the form-encoded fallback Entra uses; a request that supplies both is rejected. Access tokens expire after six hours. Xberg stores only SHA-256 hashes of credentials and tokens. The SCIM routes live under `/scim/v2/{connection_id}/Users` and `/scim/v2/{connection_id}/Groups`.

## Map groups to roles

After Entra creates the groups, a project owner maps each one to custom roles. List the groups, then assign roles:

```bash
curl "$XBERG_URL/v1/projects/$PROJECT_ID/scim/connections/$CONNECTION_ID/groups" \
  -H "Authorization: Bearer $SESSION_TOKEN"

curl -X PUT "$XBERG_URL/v1/projects/$PROJECT_ID/scim/connections/$CONNECTION_ID/groups/$GROUP_ID/roles" \
  -H "Authorization: Bearer $SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "role_ids": ["<custom role uuid>"] }'
```

Mappings accept only project custom-role IDs. A member in several groups gets the union of their permissions, and an unmapped group grants nothing. Create the roles first; see [Teams and roles](/guides/teams-and-roles/).

## Sign-in linkage and deprovisioning

At sign-in, Xberg links an active provisioned membership to the stable OIDC subject, using the email from the verified identity-provider claim. This makes the membership usable without trusting a client-supplied identifier. When SCIM deactivates a user, the next authenticated request is rejected for this project, while access to the user's other projects is unchanged.

## Validate before production

1. Create a non-gallery enterprise application in your Entra tenant.
2. Configure the generated SCIM and OAuth endpoints and run **Test Connection**.
3. Assign pilot users and groups. Confirm create, update, deactivate, restore, group membership and role changes.
4. Confirm that a deactivated user's next request is rejected for this project.

Use a disposable connection for rotation tests, because rotation is persistent. For SSO alongside provisioning, see [SAML single sign-on](/guides/saml-sso/).
