---
title: Roadmap
description: What Xberg Pro and Enterprise do not do yet, and the capabilities on the roadmap.
---

This page lists capabilities that are not generally available today. It carries no dates, because Xberg commits to a delivery date only in a customer agreement. Every other page in this documentation describes shipped behavior.

## Planned

### Finer-grained API key scopes

API keys carry a `read` or `write` scope. Enterprise role-bound keys restrict a key to one custom role; per-capability scopes on standalone keys are planned. See [Authentication](/concepts/authentication/) and [Teams and roles](/guides/teams-and-roles/).

### Customer-managed key delegation

Delegating integration-credential encryption (`INTEGRATION_KEK`) to your own KMS or Vault. Today you supply the key encryption key to the deployment. See [Security](/overview/security/).

## Current limits

- **No answer generation.** Retrieval is the whole RAG surface. Xberg has no chat or answer endpoint, so the generation model stays yours.
- **No audio or video transcription on Pro or Enterprise.** Both reject audio and video input. Use Core for transcription.
- **No browser rendering on Pro.** Pro crawls over plain HTTP. Enterprise runs rendered crawls.

## Influence the roadmap

Customers raise priorities through their support channel. See [Support](/more/support/). Write to [contact@xberg.io](mailto:contact@xberg.io) to discuss a capability that is not listed here.
