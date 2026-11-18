---
title: SAML single sign-on
description: Let a project sign in through your SAML 2.0 identity provider, with domain verification, optional just-in-time provisioning and enforced SSO.
sidebar:
  order: 20
---

**Available in:** Enterprise

SAML single sign-on lets members of a project sign in with your company's SAML 2.0 identity provider.

Enterprise acts as a SAML 2.0 service provider for project-scoped sign-in. Microsoft Entra ID is the first supported identity provider. A project owner uploads the provider's federation metadata and verifies the company's email domains, and members then sign in with their company account.

## Configure the service provider

Set `AUTH_ENABLED=true` and give the backend all four SAML values. They are required together: the backend refuses to start when only some are set.

| Variable                  | Meaning                                                              |
| ------------------------- | -------------------------------------------------------------------- |
| `SAML_SP_ENTITY_ID`       | Stable service-provider entity ID, normally the public metadata URL  |
| `SAML_SP_ACS_URL`         | Public URL of `POST /auth/saml/acs`                                  |
| `SAML_SP_PRIVATE_KEY_PEM` | PEM private key that signs authentication requests                   |
| `SAML_SP_CERTIFICATE_PEM` | Matching PEM certificate, published in the service-provider metadata |

The two public URLs go under `backend.env` in the chart values:

```yaml
backend:
  env:
    AUTH_ENABLED: "true"
    SAML_SP_ENTITY_ID: "https://app.example.com/auth/saml/metadata"
    SAML_SP_ACS_URL: "https://app.example.com/auth/saml/acs"
```

The key and certificate come from a Secret that you create, and go through `backend.extraEnv`:

```yaml
backend:
  extraEnv:
    - name: SAML_SP_PRIVATE_KEY_PEM
      valueFrom:
        secretKeyRef:
          name: xberg-saml-sp
          key: private-key.pem
    - name: SAML_SP_CERTIFICATE_PEM
      valueFrom:
        secretKeyRef:
          name: xberg-saml-sp
          key: certificate.pem
```

Download the service-provider metadata from `GET /auth/saml/metadata`.

## Connect Entra ID

1. In Entra, create an Enterprise Application, upload the service-provider metadata, and configure email and display-name claims.
2. Download the federation metadata XML.
3. A project owner registers it as a provider:

   ```bash
   curl -X POST "$XBERG_URL/v1/projects/$PROJECT_ID/saml/providers" \
     -H "Authorization: Bearer $SESSION_TOKEN" \
     -H "Content-Type: application/json" \
     -d "$(jq -n --rawfile xml federation-metadata.xml \
       '{label: "Entra ID", metadata_xml: $xml, enabled: true, jit_enabled: false, idp_initiated_enabled: false, enforce_sso: false}')"
   ```

Xberg does not fetch metadata URLs; you upload the XML. It is limited to 1 MiB and can hold several active signing certificates, so you can rotate the identity provider's certificate without an outage. The provider settings are:

| Field                   | Meaning                                                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `label`                 | Display name                                                                                                               |
| `metadata_xml`          | Federation metadata XML                                                                                                    |
| `enabled`               | Turns the provider on                                                                                                      |
| `jit_enabled`           | Provision members on first sign-in. Off by default; without it, a matching project member or pending invitation must exist |
| `idp_initiated_enabled` | Accept sign-in started at the identity provider. Off by default                                                            |
| `enforce_sso`           | Require SSO for the project. Project owners are exempt, as a break-glass path                                              |
| `attribute_mapping`     | Optional exact, case-sensitive SAML attribute names: `email_attribute` and `display_name_attribute`                        |

Manage a provider at `/v1/projects/{project_id}/saml/providers/{provider_id}`, its attribute mapping at `.../attribute-mapping`, and send a test sign-in with `POST .../test`, then read the outcome at `.../test/{test_id}`.

## Verify your domains

Domain verification is required before sign-in discovery and before JIT provisioning. Add each company domain, publish the returned TXT record, then verify:

```bash
curl -X POST "$XBERG_URL/v1/projects/$PROJECT_ID/saml/domains" \
  -H "Authorization: Bearer $SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "provider_id": "<provider uuid>", "domain": "example.com" }'

curl -X POST "$XBERG_URL/v1/projects/$PROJECT_ID/saml/domains/example.com/verify" \
  -H "Authorization: Bearer $SESSION_TOKEN"
```

The TXT record is published at `_xberg-saml.<domain>`.

## Sign in

A browser sign-in starts at `/auth/saml/login?email=<address>`. The assertion consumer service validates signatures, issuer, audience, destination, recipient, timestamps, request correlation, replay keys, duplicate IDs and XML-wrapping defenses. It then redirects with a short-lived, single-use exchange code. The session JWT is returned only by `POST /auth/saml/exchange` and never appears in a URL.

For identity-provider-initiated sign-in, enable `idp_initiated_enabled`, use the same advertised ACS URL, and set Relay State to `idp:<provider UUID>` from the project SAML settings. The signed assertion issuer must still match the uploaded metadata.

Pair SAML with [SCIM provisioning](/guides/scim/) to create and remove members automatically, and with [custom roles](/guides/teams-and-roles/) to control what they can do. Run a sign-in test with a real tenant, rotate between two signing certificates, and confirm that an expired or replayed response is refused, before you enforce SSO.
