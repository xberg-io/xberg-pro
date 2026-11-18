---
title: Security
description: The security model of Xberg Pro and Enterprise, from tenant isolation and outbound request controls to credential encryption and the audit log.
---

Xberg is built for multi-project use, so each layer assumes that a caller may be hostile. This page summarizes the controls. For where data lives and what leaves a deployment, see [Data handling](/concepts/data-handling/).

## Threat model

The two highest-priority defenses are database-level isolation between projects and safe outbound HTTP. A compromised API key must not expose another project's data, and it must not let an attacker reach internal services or cloud metadata. The model assumes an attacker who can:

- Authenticate with a stolen or self-generated API key.
- Send arbitrary input to any endpoint, including job content, webhook URLs, crawl URLs, storage endpoints and RAG queries.

## Project isolation

Every query runs under PostgreSQL row-level security keyed on the project. The API sets the project for the request, and the database refuses rows that belong to any other project. A stolen key for one project cannot read, write or delete another project's jobs, collections or audit entries. The constraint lives in the database, so it holds even if application code has a bug. Both Pro and Enterprise enforce it.

## Authentication

- API keys are revocable, hashed before lookup, scoped to one project, and carry a `read` or `write` scope. See [Authentication](/concepts/authentication/).
- Single sign-on works with any OIDC provider, with email-domain allowlisting.
- Enterprise adds SAML 2.0 and SCIM provisioning.

## Outbound request controls

Outbound HTTP goes through a guard with a deny-by-default IP policy. It applies to webhook delivery, crawling, storage endpoints, OAuth flows and source connectors.

- The guard blocks private, loopback, link-local, multicast and other reserved ranges, and cloud metadata endpoints. It checks the resolved IP, so a hostname that resolves to a blocked address is refused.
- Redirects are re-validated at every hop, up to 5 redirects.
- Every outbound request has a connect timeout of 5 seconds, a read timeout of 20 seconds and a total timeout of 30 seconds.
- Webhook URLs are validated at registration and again on every delivery attempt. A URL that resolves to a blocked address fails permanently with `ssrf_policy_violation`.
- Custom storage endpoints are disabled unless you list them in `STORAGE_ENDPOINT_ALLOWLIST`, a comma-separated list of exact hosts or leading-dot suffixes.
- Caller-supplied model endpoints are validated at submission and again before each engine call. When `PRO_VLM_ENDPOINT_ALLOWLIST` (Pro) or `VLM_ENDPOINT_ALLOWLIST` (Enterprise) is set, it becomes a closed list: every model endpoint, public or private, must appear on it.

Add network-level egress rules as an independent boundary. For Kubernetes, a NetworkPolicy that admits only the destinations you expect means a flaw in application code still meets a second barrier.

## Credentials at rest

Connected-source credentials and OAuth tokens are encrypted at rest with AES-256-GCM envelope encryption. The key encryption key comes from `INTEGRATION_KEK`, and an operator can rotate it, which re-wraps stored credentials in the background.

## Audit log

State-changing operations are written to an append-only, hash-chained audit log: project, API-key, integration, crawl and job-submission events. A verification routine proves the chain is unaltered. See [Audit log](/guides/audit-log/) and [Audit chain](/operate/audit-chain/).

## Licensing and telemetry

License verification is offline, with no phone-home and no usage beacon. See [Pricing and licensing](/overview/pricing-and-licensing/).

## Certifications

Xberg does not hold SOC 2 or ISO 27001 certification, and no audit is in progress. A self-hosted deployment runs inside your own certified boundary and inherits your controls.

## Report a vulnerability

Do not open a public issue. See [Support](/more/support/#report-a-security-issue).
