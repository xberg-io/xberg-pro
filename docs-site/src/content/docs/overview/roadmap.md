---
title: Roadmap
description: What Xberg Pro and Enterprise do not do yet, and the capabilities on the roadmap.
---

This page lists capabilities that are not generally available today. It carries no dates, because Xberg commits to a delivery date only in a customer agreement. Every other page in this documentation describes shipped behavior.

## Planned

### Hosted API

A pay-per-page API on the same engine, with a free tier. It is built and tested. Pro and Enterprise stay self-hosted, and no hosted service is offered today.

### Finer-grained API key scopes and custom roles

API keys today carry a `read` or `write` scope, and Enterprise teams use fixed owner and member roles. Scopes tied to individual capabilities and custom roles are on the roadmap. See [Authentication](/concepts/authentication/) and [Teams and roles](/guides/teams-and-roles/).

### Customer-managed encryption keys

Delegation of credential encryption to your own KMS or Vault. Today, connected-source credentials are encrypted with a key encryption key you supply to the deployment. See [Security](/overview/security/).

## Current limits

These are boundaries of the shipped product, not commitments to change them.

- **No answer generation.** Retrieval is the whole RAG surface. There is no chat or answer endpoint, so the generation model stays yours.
- **No audio or video transcription on Pro or Enterprise.** Both reject audio and video input. Use Core for transcription.
- **No browser rendering on Pro.** Pro crawls over plain HTTP. Enterprise runs rendered crawls.
- **Monthly page and job limits are reported, not enforced.** Usage reporting shows consumption, but no request is refused against a monthly cap.

## Influence the roadmap

Customers raise priorities through their support channel. See [Support](/more/support/). Write to [contact@xberg.io](mailto:contact@xberg.io) to discuss a capability that is not listed here.
