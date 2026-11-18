---
title: Structured extraction
description: Extract validated JSON from any document by combining an LLM with a JSON Schema you define.
sidebar:
  order: 4
---

Structured extraction returns validated JSON from a document. Submit a PDF, web page or text alongside a JSON Schema. Xberg sends the document content and schema to the LLM you configure and returns the validated result.

Structured extraction calls an external model, so it is off until you configure a provider and key. See [Data handling](/concepts/data-handling/).

## What it does

Standard extraction returns text. Structured extraction returns exactly the fields you ask for, in the shape you define. The pipeline validates the output and, in strict mode, fails a job whose output does not comply.

Typical uses:

- Research papers: title, authors, abstract and findings
- Invoices: vendor, date, line items and total
- Job postings: title, salary, location and responsibilities
- Product pages: name, price, features and reviews

## Curated presets

Curated presets such as `invoice` use the deployment's vision model. Before you submit those jobs, configure the worker with `GEMINI_API_KEY` for Gemini or `VERTEXAI_PROJECT` for Vertex AI. Without that client, an accepted preset job ends as `failed` with an error that names the missing provider setting, instead of returning a plain extraction. Plain extraction and custom schemas with an explicit `llm` keep their normal routing. See [Presets](/guides/presets/).

## How to use it

### 1. Define the schema

Write a [JSON Schema (draft-07)](https://json-schema.org/) for the shape you want back.

```json
{
  "type": "object",
  "properties": {
    "title": { "type": "string" },
    "authors": { "type": "array", "items": { "type": "string" } },
    "abstract": { "type": "string" },
    "publication_year": { "type": "integer" }
  },
  "required": ["title", "authors"]
}
```

### 2. Submit a document

Add `structured_extraction` to the extraction config. `https://xberg.example.com` is a placeholder for your deployment's base URL.

```bash
curl -X POST https://xberg.example.com/v1/extract \
  -H "Authorization: Bearer $XBERG_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "urls": [{"url": "https://example.com/research-paper.pdf"}],
    "options": {
      "extraction_config": {
        "structured_extraction": {
          "schema": {
            "type": "object",
            "properties": {
              "title": {"type": "string"},
              "authors": {"type": "array", "items": {"type": "string"}},
              "abstract": {"type": "string"},
              "publication_year": {"type": "integer"}
            },
            "required": ["title", "authors"]
          },
          "schema_name": "research_paper",
          "schema_description": "Metadata from an academic research paper",
          "llm": {"model": "openai/gpt-4o-mini"}
        }
      }
    }
  }'
```

### 3. Receive the result

Each entry in `results` carries `structured_output`.

```json
{
  "job_id": "job_123",
  "status": "completed",
  "results": [
    {
      "content": "Lorem ipsum dolor sit amet...",
      "structured_output": {
        "title": "The Future of AI",
        "authors": ["Alice", "Bob"],
        "abstract": "We explore...",
        "publication_year": 2024
      }
    }
  ],
  "errors": [],
  "cached": false,
  "child_job_ids": [],
  "completed_at": "2026-09-15T12:00:00Z"
}
```

## Configuration

### Required fields

- **`schema`**: the JSON Schema (draft-07) the output must match.
- **`llm`**: the model to call. `model` is required and is a liter-llm routing ID such as `openai/gpt-4o-mini`. The provider is the prefix of `model`, so there is no separate `provider` field. Optional fields are `api_key`, `base_url`, `max_retries`, `max_tokens`, `temperature`, `timeout_secs` and `use_managed`.

### Optional fields

- **`schema_name`**: a name for the schema. Defaults to `"extraction"` and is passed to the model's structured-output mode.
- **`schema_description`**: a description that gives the model context.
- **`strict`**: when `true`, the output must match the schema exactly, with provider-dependent enforcement. When `false`, the default, Xberg validates the output but accepts minor mismatches.
- **`prompt`**: a custom Jinja2 prompt template. Omit it to use the Xberg default.

## Providers

Requests route through [liter-llm](https://github.com/xberg-io/liter-llm), which supports a catalog of 170+ providers, including OpenAI, Anthropic, Google, AWS Bedrock, Ollama, vLLM and any OpenAI-compatible endpoint. See the [liter-llm provider list](https://github.com/xberg-io/liter-llm#supported-providers) for the full registry.

A caller-supplied `base_url` passes an egress check, and an operator can restrict model endpoints to an allowlist. See [Security](/overview/security/).

## Strict and non-strict mode

**Strict mode** (`"strict": true`) requires the output to conform exactly. Some providers enforce this at the API level. It is slower and can fail when the model cannot produce valid output. Use it when you need guaranteed compliance and can tolerate occasional failures.

**Non-strict mode** (`"strict": false`) takes the model's best attempt and validates it afterward. It is faster and tolerates small mismatches. Use it for most cases, and switch to strict mode when you need guarantees.

## Custom prompts

Override the default template with your own.

```json
{
  "prompt": "Extract the following fields from the document:\n{% for key in schema.properties %}\n- {{ key }}: {{ schema.properties[key].description }}\n{% endfor %}\n\nDocument:\n{{ content }}"
}
```

The template can use `schema`, which is your JSON Schema, and `content`, which is the extracted document text.

## Error handling

When extraction fails, the job status is `"failed"` and the `errors` array lists error entries with `error_type`, `message` and optional `code`, `index` and `source`. A `code` in that entry is an integer assigned by the engine. The dotted string codes such as `rag.rerank.unavailable` belong to the error envelope on 4xx and 5xx responses, which is a different field.

If a job fails, loosen an over-restrictive schema or try a different provider.

## Related pages

- [Pipeline](/concepts/pipeline/) shows where structured extraction fits.
- [REST API reference](/reference/api/) has the complete `/v1/extract` schema.
