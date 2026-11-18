---
title: Support
description: Support channels for Xberg Core, Pro and Enterprise, and how to report a security issue.
---

## Channels by tier

| Tier       | Channels                                                                                               | Response terms         |
| ---------- | ------------------------------------------------------------------------------------------------------ | ---------------------- |
| Core       | [GitHub issues](https://github.com/xberg-io/xberg/issues) and [Discord](https://discord.gg/xt9WY3GnKR) | Community, best effort |
| Pro        | Email and a dedicated Slack channel                                                                    | Per your agreement     |
| Enterprise | A private channel                                                                                      | Contractual SLA        |

Pro and Enterprise customers receive channel details with their license. For anything else, write to [contact@xberg.io](mailto:contact@xberg.io).

## What to include in a request

A reproducible report gets a faster answer. Include:

- The product and the release or image tag.
- How you deploy: Docker Compose, Pro Helm or Enterprise Helm.
- What you expected and what happened, with the error text.
- Relevant log lines. Remove document content and credentials first.
- The license state if the problem looks license-related. `GET /healthz` reports a summary and `GET /v1/license` reports detail.

Never send documents that contain customer data unless your agreement covers it.

## Documentation issues

Report errors or gaps in these docs with the [documentation issue form](https://github.com/xberg-io/xberg-pro/issues/new/choose) on the public documentation repository.

## Report a security issue

Do not open a public issue for a vulnerability. Follow the [security policy](https://github.com/xberg-io/xberg-pro/security/policy), which lists the maintainer addresses, the private reporting form and the response targets.

Reports on Xberg Pro and Xberg Enterprise themselves are in scope: the container images, Helm charts, APIs and SDKs. For how the product defends against common attacks, see [Security](/overview/security/).
