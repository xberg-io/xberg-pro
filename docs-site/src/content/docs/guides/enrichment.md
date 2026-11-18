---
title: Enrichment
description: Add entities, keywords, classification labels and image captions to text you already have with the enrichment API.
sidebar:
  order: 4
---

**Available in:** Pro, Enterprise

Enrichment adds entities, keywords, classification labels and image captions to text you already have.

It is separate from extraction: you send text, not a document, and poll a job for the result. Keyword and entity extraction need no setup beyond a project API key. Classification and captioning call a language or vision model that you name in each request; see [Pro configuration](/reference/pro-configuration/#structured-extraction) for the provider credentials a deployment can supply.

## Submit text

`POST /v1/enrich` accepts up to 1 MB of `text` and an `options` object, and returns a job ID:

```bash
curl -X POST "$XBERG_URL/v1/enrich" \
  -H "Authorization: Bearer $XBERG_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Acme Corp signed a three-year supply agreement with Globex in Berlin.",
    "options": { "entities": true, "keywords": true }
  }'
```

The response is `{ "job_id": "<ULID>" }`. Unknown option keys are refused, so a typo returns an error rather than a `202` for work that will not happen.

## Options

| Option                 | Effect                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `entities`             | Extract named entities with NER                                                                                                                                          |
| `keywords`             | Extract keywords                                                                                                                                                         |
| `classification`       | Zero-shot classification of the whole text against a label set you supply                                                                                                |
| `chunk_classification` | Multi-label classification of chunks you supply, against a described label taxonomy. `/v1/enrich` has no chunking pipeline of its own, so you pass the chunk texts       |
| `captioning`           | Vision-model captions for images you supply                                                                                                                              |
| `labels`               | Candidate labels. Pro refuses non-empty values with `rag.label_classification.unsupported`, because it ships no classifier for this option; use `classification` instead |

`classification`, `chunk_classification` and `captioning` run on Pro, and Enterprise refuses them with `400`. Enterprise runs `keywords`, `entities` and `labels`. Unknown option keys are refused on both.

Each model-backed option names its model in an `llm` object. `llm.model` is required and uses the `provider/model` form, for example `openai/gpt-4o-mini`. Optional keys are `api_key`, `base_url`, `max_tokens`, `temperature`, `timeout_secs` and `max_retries`. When `api_key` is omitted, the deployment's own provider credentials apply, unless you set `base_url`. A request that sets `base_url` never falls back to them.

| Option                 | Required keys                                                        |
| ---------------------- | -------------------------------------------------------------------- |
| `classification`       | `labels` (at least one), `llm`. Optional `multi_label`               |
| `chunk_classification` | `chunks`, `definitions` (at least one `{label, description}`), `llm` |
| `captioning`           | `images` (base64-encoded bytes), `llm`                               |

A `400` reports empty or oversized `labels`, `chunks`, `definitions` or `images`, an endpoint that the egress policy refuses, or a model the deployment cannot authenticate. For example, a classification request:

```bash
curl -X POST "$XBERG_URL/v1/enrich" \
  -H "Authorization: Bearer $XBERG_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "The invoice is overdue and the customer is asking for a refund.",
    "options": {
      "classification": {
        "labels": ["billing", "support", "sales"],
        "multi_label": true,
        "llm": { "model": "openai/gpt-4o-mini" }
      }
    }
  }'
```

## Poll for the result

```bash
curl "$XBERG_URL/v1/enrich/$JOB_ID" \
  -H "Authorization: Bearer $XBERG_API_KEY"
```

The status is `pending`, `completed` with a `result`, or `failed` with an `error` message. The result carries `entities` (null when not requested), `keywords`, `classification` (null when not requested, an empty list when it ran and matched nothing), `chunk_classifications` and `captions`. The caption and chunk lists match the positions of the images and chunks you submitted.

## Capacity

Acceptance and execution are separate. A submission that arrives while every worker is busy waits in a queue. Pro refuses a submission only when the queue is also full, with `503` and a `Retry-After` header that gives the seconds to wait. Retry after that interval; a `503` without `Retry-After` does not say when the condition clears.

| Variable                    | Default | Meaning                                                                          |
| --------------------------- | ------- | -------------------------------------------------------------------------------- |
| `PRO_ENRICH_MAX_CONCURRENT` | 8       | Enrichment jobs that run at the same time                                        |
| `PRO_ENRICH_MAX_QUEUED`     | 32      | Accepted jobs that can wait. Each waiting job holds its request text, up to 1 MB |
