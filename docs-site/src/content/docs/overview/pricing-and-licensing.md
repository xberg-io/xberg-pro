---
title: Pricing and licensing
description: How Xberg Pro and Enterprise are priced and licensed, how the offline license token works, and how to buy or trial.
---

## Licensing model

Xberg Core is MIT-licensed and free for commercial use. Xberg Pro and Xberg Enterprise are proprietary software and work the same way:

1. You sign a license agreement with Xberg.
2. Xberg issues your license.
3. You install and run the product under that license.

For Pro, the license is a signed token that the image verifies offline (see below). For Enterprise, the license comes with your agreement together with access to the Enterprise images.

Pro is one product. A valid license turns on everything Pro does, and nothing is sold as an add-on. Capabilities such as RAG and Auto-Tune are operator switches, not separate entitlements.

## Pricing

Pricing is per license, by contract. Xberg publishes no list prices. The price depends on the product, the scale of the deployment and the support level in your agreement.

## The license token

Pro verifies a signed token offline.

- **Validity.** Each token is issued for 180 days.
- **Grace.** After expiry, a grace period keeps the service running while it logs warnings on every evaluation. The grace length travels in the token and is 30 days for current issuance.
- **After grace.** The service stops accepting new work, drains the work in flight and exits.
- **No phone-home.** Verification runs against a key inside the image. Xberg runs no activation server, heartbeat or usage beacon, including in air-gapped installs.
- **Pre-flight check.** A verification command in the image catches a bad or expired token before it reaches a cluster.

Renew before the 180 days end. Alert on the license metrics so that grace is a safety margin, not a routine. Token mechanics, the verification command, metrics and renewal are in [Licensing](/reference/licensing/).

## Buy or trial

Email [contact@xberg.io](mailto:contact@xberg.io) to buy a license or to arrange a trial. Say which product you are interested in, how you plan to deploy it and roughly how many documents you process. Xberg replies with an agreement. Once it is signed, you receive your license.

The `ghcr.io/xberg-io/xberg-pro` image is public and multi-arch (`linux/amd64` and `linux/arm64`), but it does not start without a valid token. The Enterprise Helm chart is public; the Enterprise images are provided with your license.

## Third-party components

Third-party components keep their own license terms. The open-source engine's terms are in the [Xberg Core repository](https://github.com/xberg-io/xberg).
