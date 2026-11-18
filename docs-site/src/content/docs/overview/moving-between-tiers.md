---
title: Moving between tiers
description: How to move from Core to Pro, and from Pro to Enterprise, without rewriting your integration.
---

Pro and Enterprise are built from a single codebase and share one set of API types. Moving up is a deployment change, not a rewrite.

## Core to Pro

Pro wraps the same engine in a service. Your extraction settings and result shapes carry over, so results from Core and Pro share the same structure: `content`, `metadata`, and optionally `tables` and `chunks`.

1. Obtain a license. See [Pricing and licensing](/overview/pricing-and-licensing/).
2. Deploy Pro with [Docker Compose](/start/pro-docker/) or [Helm](/start/pro-helm/).
3. Replace in-process calls with REST or an [SDK](/start/sdks/). Pro extraction is asynchronous: a submission returns a job that you poll or receive by webhook.
4. Move queueing, retry and storage code out of your application. Pro owns them now.

## Pro to Enterprise

Enterprise serves the whole of Pro's API apart from two Pro-specific calls: the license endpoint and Pro's local-storage upload. A continuously enforced check keeps the surface aligned, so the API you build against does not move underneath you.

The SDKs are dual-target. One client library points at either deployment, so changing tiers means changing the base URL and credentials.

What Enterprise adds is the multi-user and multi-tenant layer:

- Teams, invitations and owner and member roles
- SAML 2.0 and SCIM provisioning
- Registered webhook endpoints with delivery history and replay
- Document versions and diff
- Data rooms
- Cross-project usage analytics
- Horizontal scale with workers that scale on queue depth

Enterprise installs from a private Helm chart and private images, by arrangement. See [Enterprise Helm](/start/enterprise-helm/).

## Moving data

Jobs, projects and API keys live in each deployment's PostgreSQL database. Plan the cutover so that new work goes to the new deployment while you drain in-flight jobs on the old one. Contact [contact@xberg.io](mailto:contact@xberg.io) for help planning a migration of existing state. See [Backup and restore](/operate/backup-and-restore/) for the data you would carry across.

## Moving down

The extraction results are plain data in your storage, so they stay readable on any tier. Capabilities that exist only on Enterprise, such as registered webhook endpoints, teams and data rooms, are not available after a move to Pro.
