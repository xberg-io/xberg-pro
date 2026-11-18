---
title: Licensing
description: How the Xberg Pro license token works, what happens when it is missing or expired, and how to verify, monitor and renew it.
sidebar:
  order: 4
---

**Available in:** Pro

Xberg Pro is licensed by commercial contract, and the container enforces that contract. This page describes the token, its lifecycle and the outage semantics plainly: a license fault stops the service. Read it before you deploy a token, not after an incident. For commercial terms, see [Pricing and licensing](/overview/pricing-and-licensing/).

## What the token is

`XBERG_LICENSE_KEY` is an Ed25519-signed token in the form `base64url(payload).base64url(signature)`. The payload is a JSON object naming the licensee, the plan and the validity window.

Pro verifies the token against the public keys built into the image. An image can carry more than one key, and a token verifies if it matches any of them, so Xberg can rotate the signing key without re-imaging deployed instances. A token that does not decode to exactly this shape is invalid.

The token grants the whole product. Pro is not feature-tiered by license: once a token verifies, every capability is available.

## A valid license is required to start

Pro refuses to start without a valid license that is unexpired or within its grace window. Pro has no free tier, no evaluation mode and no degraded-but-running state for a missing or bad license. An absent, malformed or beyond-grace token stops the process with exit code 78 and a message in the logs that names the cause.

This is a deliberate trade of availability for enforceability: a license fault becomes a customer outage. The lifecycle below and the pre-flight verification tool exist to keep that outage from being a surprise.

## Lifecycle: 180 days, then a grace window, then stop

Every token is issued for 180 days. The grace period is carried in the token as the `grace_days` claim rather than compiled into the binary, so it can change per issuance without a format break. Issuance currently sets it to 30 days, but read your own token's `GET /v1/license` response (or `xberg-admin license verify`) instead of assuming 30. Pro rejects a token whose `grace_days` exceeds 365. Pro re-evaluates the license state hourly against the wall clock, so an instance running across its expiry observes the transition without a restart.

| State                                          | What happens                                                                  | What you see                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Valid                                          | Serves normally.                                                              | Nothing, until 30 days and 7 days before expiry, when Pro logs a warning.                                                                                                                                                                                                                       |
| Grace (past `expires_at`, within `grace_days`) | Keeps serving.                                                                | One `WARN` log line on every hourly evaluation naming the license, licensee, expiry and days of grace remaining. The warning does not escalate. The state also shows on `/healthz`, at `GET /v1/license`, in the web console and in `xberg_license_valid` (a 0/1 gauge, not a warning channel). |
| Beyond grace, invalid or absent                | Stops accepting new work, drains work already in flight, then exits non-zero. | In Kubernetes this renders as a crash loop. The reason is in the pod logs.                                                                                                                                                                                                                      |

Grace exists because the most likely cause of an expired license is a missed renewal, not unlicensed use. Draining rather than aborting means a lapse never destroys work that was already running. Grace does not remove the eventual stop. It gives you the token's `grace_days` of warned runway to fix it.

## Verify a token before you deploy it

`xberg-admin`, which ships inside the image, has a `license verify` subcommand for pre-flight checks:

```bash
docker run --rm --entrypoint /app/xberg-admin ghcr.io/xberg-io/xberg-pro:<version> \
  license verify --token "$XBERG_LICENSE_KEY"
```

Replace `<version>` with the image tag you are about to deploy. Verification checks the token against the key baked into that specific build, and a token that is otherwise well-formed will not verify against the wrong build. This is how you catch a bad or expired token before it becomes a crash loop instead of after.

## Read the current state

`GET /v1/license` (admin-authenticated) returns the current license state, the licensee, the license id and plan, and the expiry, grace window and days remaining.

`GET /healthz` (unauthenticated, for orchestrator liveness probes) reports a summary state for dashboards and quick checks that do not need the full detail. The state is one of `licensed`, `grace`, `expired`, `invalid` or `unlicensed`.

## Alert on expiry before it happens

Scrape `/metrics` (`PRO_METRICS_ADDR`, default `0.0.0.0:9090`) and alert on these series:

- `xberg_license_valid` is `1` only while the license is valid and `0` throughout the grace window and beyond. Pro re-evaluates it on the hourly loop above, with 5 minutes of clock-skew tolerance on top, so the drop to `0` can lag the token's actual `expires_at` by up to roughly 65 minutes. Account for that lag in any alert threshold, not just the token's `grace_days` window.
- `xberg_license_expiry_timestamp_seconds` is the token's `expires_at` as a Unix timestamp, so you can alert on "expires within N days" directly. It reads `0.0` for the `invalid` and `absent` states because there is no claims payload to read an expiry from. An "expires within N days" alert must exclude or special-case those states rather than treating `0` as an imminent expiry.
- `xberg_license_state{state="..."}` is `1` for the current state and `0` for every other label, so a panel can select on it directly. The labels are `valid`, `grace`, `expired`, `invalid` and `absent`. These differ from the state names `/healthz` and `GET /v1/license` report (`licensed` and `unlicensed` rather than `valid` and `absent`), although the underlying states are the same.

Alert well before the token's `grace_days` window opens. Grace is a safety margin for an already-late renewal, not a normal part of the rotation cadence. See [Observability](/observability/) for dashboards and scrape setup.

## Renewal

Reissue is tied to your commercial agreement. Contact [contact@xberg.io](mailto:contact@xberg.io) ahead of the 180-day expiry to receive a new token. Set the new `XBERG_LICENSE_KEY` and restart the container, or roll the deployment in Kubernetes. Pro cannot swap the token in place: it reads the environment variable at boot and re-validates it hourly, so a restart is required to pick up a new value.

## No phone-home

Verification is entirely offline. Pro uses no activation server, no heartbeat and no callback to Xberg infrastructure at any point in the lifecycle above, including expiry and grace. This holds for air-gapped deployments exactly as it does for connected ones. See [Air-gapped installs](/operate/air-gapped/).

The license is a cryptographically signed contract artifact that Pro evaluates locally, not a service you depend on. This does not change the enforcement described above: Pro checks the token against a key already inside the image, and the outcome is still a hard stop past grace. It means only that Xberg's own availability never becomes a factor in that outcome.
