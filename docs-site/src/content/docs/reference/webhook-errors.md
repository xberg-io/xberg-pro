---
title: Webhook delivery errors
description: How Xberg classifies webhook delivery failures, which are retried, and how to resolve each one.
sidebar:
  order: 6
---

**Available in:** Pro, Enterprise

Webhook delivery attempts can fail for network or policy reasons. Each attempt is recorded with a `success` flag, an optional `status_code` and an `error`. `error` carries a free-text message. Two policy failures use fixed values: `webhook_url_denied_by_policy` and `webhook_url_not_on_allowlist`. Xberg also classifies each failure as transient or permanent. Only transient failures are retried. See the [webhooks guide](/guides/webhooks/) for setup and payloads.

## How failures are classified

| Outcome                                                                                             | Retried        | Cause                                                                                                                                                                             | What to do                                                                                                                                         |
| --------------------------------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2xx response                                                                                        | Not applicable | Delivery succeeded.                                                                                                                                                               | Nothing.                                                                                                                                           |
| `429` response                                                                                      | Yes            | The endpoint asked to be retried.                                                                                                                                                 | No action needed. Xberg retries automatically.                                                                                                     |
| `500` to `599` response, or an unrecognized status                                                  | Yes            | Webhook server error.                                                                                                                                                             | Review your webhook handler logs.                                                                                                                  |
| `400` to `499` response other than `429`                                                            | No             | Webhook client error. Xberg treats it as permanent, since retrying an unchanged request against a `4xx` response rarely succeeds.                                                 | Fix the handler or payload issue that produced the `4xx`, then redeliver manually.                                                                 |
| Network or transport failure (timeout, connection refused, DNS failure, response body too large)    | Yes            | The request never reached the endpoint, or never completed against it. `error` carries the transport failure kind. The message is deliberately generic and omits the request URL. | Verify the webhook URL is reachable from the platform. Check firewall rules if the URL is on a private network.                                    |
| SSRF policy violation (`error` is `webhook_url_denied_by_policy` or `webhook_url_not_on_allowlist`) | No             | The webhook URL resolves to a denied IP address, or falls outside a configured allowlist.                                                                                         | Point the webhook at a public endpoint outside the denied ranges, or add it to the allowlist. See [SSRF policy violation](#ssrf-policy-violation). |
| Too many redirects                                                                                  | No             | The endpoint's response chain exceeded the redirect limit.                                                                                                                        | Point the webhook URL directly at its final destination.                                                                                           |

Delivery makes up to 5 attempts: the first attempt plus 4 retries. The retries wait 5 s, 30 s, 300 s and 300 s, plus jitter, so the whole window is roughly 635 seconds and not 24 hours. On Pro, `PRO_WEBHOOK_MAX_RETRIES` changes the attempt count and `PRO_WEBHOOK_HTTP_TIMEOUT_SECS` the per-request timeout. See [Xberg Pro configuration](/reference/pro-configuration/#tuning). On Enterprise the schedule is fixed. See [Xberg Enterprise configuration](/reference/enterprise-configuration/#webhook-service).

## SSRF policy violation

When a webhook URL resolves to an IP address in the deny-by-default blocklist, delivery is refused permanently with `error` set to `webhook_url_denied_by_policy`. When an explicit allowlist is configured and the host is not on it, `error` is `webhook_url_not_on_allowlist`. The blocked ranges are:

- RFC 1918 private networks: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
- This network: `0.0.0.0/8`
- Carrier-grade NAT and Tailscale: `100.64.0.0/10`
- Cloud metadata services: `169.254.0.0/16` (AWS EC2, GCP, Azure)
- IETF protocol assignments and DS-Lite: `192.0.0.0/24`
- Documentation ranges: `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`
- Benchmarking: `198.18.0.0/15`
- Reserved, including broadcast `255.255.255.255`: `240.0.0.0/4`
- Multicast: `224.0.0.0/4` and `ff00::/8`
- Loopback: `127.0.0.0/8` and IPv6 `::/96`, which covers the unspecified address, loopback and the deprecated IPv4-compatible form, not just `::1`
- NAT64: `64:ff9b::/96`
- 6to4: `2002::/16`
- IPv6 unique-local: `fc00::/7`
- IPv6 link-local: `fe80::/10`

This failure is permanent. Xberg never sends the request and schedules no retries. To resolve it:

1. Point the webhook URL at a public-facing endpoint, for example a domain with a public IP.
2. If the receiver must stay on a private network, expose it through a public-facing reverse proxy or API gateway.
3. Update the webhook URL in the project's web console.

The next job completion attempts delivery to the updated URL.
