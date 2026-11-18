---
title: Security
description: The security model of Xberg Pro and Enterprise, from tenant isolation and outbound request controls to credential encryption and the audit log.
---

This page summarizes the controls in Xberg Pro and Enterprise. For where data lives and what leaves a deployment, see [Data handling](/concepts/data-handling/).

## Design goals

Two controls matter most: database-level isolation between projects, and safe outbound HTTP. A leaked API key for one project must not expose another project's data. User-supplied URLs, such as webhook, crawl and storage endpoints, must not reach internal services or cloud metadata.

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
- By default, an outbound request has a connect timeout of 5 seconds, a read timeout of 20 seconds and a total timeout of 30 seconds. `SAFE_HTTP_CONNECT_TIMEOUT_SECS`, `SAFE_HTTP_READ_TIMEOUT_SECS` and `SAFE_HTTP_TOTAL_TIMEOUT_SECS` override them, and the read timeout cannot exceed the total.
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

Xberg does not hold SOC 2 or ISO 27001 certification. A self-hosted deployment runs inside your own certified boundary and inherits your controls.

## Report a vulnerability

Do not open a public issue. See [Support](/more/support/#report-a-security-issue).
