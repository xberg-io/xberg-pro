---
title: Presets
description: Apply a curated preset or save your own structured-extraction schema so requests stay short and results stay consistent.
sidebar:
  order: 5
---

**Available in:** Pro, Enterprise. Saved extraction settings on a preset are Enterprise only.

A preset names a prepared extraction setup. Instead of repeating a schema and settings on every request, you reference the preset by ID. Two kinds exist: curated presets that ship with Xberg, and saved presets that you create in a project.

## Curated presets

Curated presets are a read-only registry fixed at build time. The list is public and unpaginated:

```bash
curl "$XBERG_URL/v1/presets"
curl "$XBERG_URL/v1/presets/$PRESET_ID"
```

Each entry has an ID, a name and a description. Apply one to an extraction with `options.preset`:

```bash
curl -X POST "$XBERG_URL/v1/extract" \
  -H "Authorization: Bearer $XBERG_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "documents": [{ "filename": "invoice.pdf", "data": "<base64>" }],
    "options": { "preset": "invoice" }
  }'
```

A curated preset can run structured extraction, which needs a configured model. See [Structured extraction](/concepts/structured-extraction/) and the model settings in [Pro configuration](/reference/pro-configuration/#structured-extraction).

## Saved presets

A saved preset is a project-scoped, user-authored structured-extraction definition. Create one with a name and a JSON schema:

```bash
curl -X POST "$XBERG_URL/v1/saved_presets" \
  -H "Authorization: Bearer $XBERG_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "invoices",
    "description": "Invoice header fields",
    "preferred_call_mode": "text_only",
    "schema": {
      "type": "object",
      "properties": {
        "invoice_number": { "type": "string" },
        "total": { "type": "number" }
      }
    }
  }'
```

`name`, `schema` and `preferred_call_mode` are required. The routes are `GET /v1/saved_presets` (summaries, paginated), `GET`, `PATCH` and `DELETE` on `/v1/saved_presets/{preset_id}`. Reference one from an extraction with `options.saved_preset_id`. It is mutually exclusive with `options.preset`.

Two fields are stored and returned but do not change extraction today. `preferred_call_mode` (`text_only`, `vision_only` or `text_plus_vision`) is validated on write and not applied at extraction time, and `emit_citations` is not applied either. Do not rely on either to change results.

## Saved extraction settings (Enterprise)

On Enterprise, a saved preset can also carry `extraction_config`, which is applied beneath request and per-file options. Pro rejects this field. Supply LLM credentials, provider URLs and PDF passwords with each extraction request; a preset never stores them.

## SDK access

The SDKs wrap these routes as `create_saved_preset`, `get_saved_preset`, `update_saved_preset` and `delete_saved_preset` (camel case in TypeScript, Pascal case in Go), and `presets` for the curated list. See [docs.sdks.xberg.io](https://docs.sdks.xberg.io/guides/rag-auto-tune-presets/).
