---
title: Pipeline
description: The four stages of the Xberg pipeline, acquire, extract, enrich, and embed and retrieve, with the request that drives each.
sidebar:
  order: 2
---

Xberg chains four stages. Each wraps an open-source project that you can adopt on its own, or use together in one self-hosted backend. The platform is a composable component that your agents and pipelines plug into for content and retrieval.

## The four stages

| Stage              | What it does                                                                                                                            | Built on                                                                                                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Acquire            | Fetches the web over resolver-protected HTTP. Submit `urls[]` to `/v1/extract` and the worker crawls before extraction.                 | [crawlberg](https://github.com/xberg-io/crawlberg)                                                                                                                                               |
| Extract            | Reads 107 file formats into text, tables and metadata, understands 371 programming languages, and converts HTML to Markdown losslessly. | [Xberg](https://github.com/xberg-io/xberg), [html-to-markdown](https://github.com/xberg-io/html-to-markdown), [tree-sitter-language-pack](https://github.com/xberg-io/tree-sitter-language-pack) |
| Enrich             | Applies structured extraction against JSON schemas, vision-model OCR, keywords and named entities.                                      | Xberg and [liter-llm](https://github.com/xberg-io/liter-llm)                                                                                                                                     |
| Embed and retrieve | Builds document collections, ingest pipelines, hybrid retrieval and reranking on pgvector.                                              | The Xberg RAG service                                                                                                                                                                            |

Features that call a model are off until you configure a provider. See [Data handling](/concepts/data-handling/).

The examples use `https://xberg.example.com` as a placeholder for your deployment's base URL.

## Acquire: crawl the web

Submit URLs in the `urls[]` field of `POST /v1/extract`.

```bash
curl -X POST https://xberg.example.com/v1/extract \
  -H "Authorization: Bearer $XBERG_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "urls": [
      {"url": "https://example.com"},
      {"url": "https://example.com/blog"}
    ]
  }'
```

The worker crawls each URL, converts HTML to Markdown, and either saves the crawled documents or fans them out as child extraction jobs. Control this with `crawl_config.save`. See [Crawling](/guides/crawling/).

## Extract: process documents

Submit documents as multipart form data, or reference large files through a presigned upload. Xberg recognizes 107 formats across 141 extensions, including PDFs, images, Office files and code.

```bash
curl -X POST https://xberg.example.com/v1/extract \
  -H "Authorization: Bearer $XBERG_API_KEY" \
  -F "documents=@research-paper.pdf"
```

Limits and exceptions:

- A single `POST /v1/extract` call carries at most 10 documents on Pro and Enterprise. An eleventh gets a `400`.
- To hand off more in one round trip, presign them with `POST /v1/uploads/presign`. A presign batch holds at most 100 documents.
- Audio and video are rejected on both tiers, before any bytes upload. Use Core when you need transcription.

The worker extracts text, tables and metadata. For code files, tree-sitter grammars provide code-aware chunking. The output shape matches Core: `content`, `metadata`, and optionally `tables` and `chunks`.

## Enrich: structure and understand

Add [structured extraction](/concepts/structured-extraction/) to return validated JSON that matches a schema you define.

```bash
curl -X POST https://xberg.example.com/v1/extract \
  -H "Authorization: Bearer $XBERG_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "urls": [{"url": "https://example.com/paper"}],
    "options": {
      "extraction_config": {
        "structured_extraction": {
          "schema": {
            "type": "object",
            "properties": {
              "title": {"type": "string"},
              "authors": {"type": "array", "items": {"type": "string"}}
            },
            "required": ["title", "authors"]
          },
          "llm": {"model": "openai/gpt-4o-mini"}
        }
      }
    }
  }'
```

The model call goes through liter-llm, which supports a large catalog of providers. Keywords, entities and labels come from [enrichment](/guides/enrichment/).

## Embed and retrieve: build RAG collections

Create a collection, then ingest extracted text. The service chunks, enriches and embeds it asynchronously.

```bash
curl -X POST https://xberg.example.com/v1/rag/collections \
  -H "Authorization: Bearer $XBERG_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "research_papers",
    "embedding_dim": 1024,
    "embedding_source": "managed_local"
  }'
```

Ingest through `POST /v1/rag/collections/{name}/documents`, and poll `GET /v1/rag/jobs/{job_id}` for progress. Retrieval uses hybrid search with optional reranking and metadata filtering. See [RAG](/guides/rag/).

## Example: URL to retrieval

```bash
# 1. Crawl and extract in one request
curl -X POST https://xberg.example.com/v1/extract \
  -H "Authorization: Bearer $XBERG_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"urls": [{"url": "https://example.com/paper"}]}'

# 2. Index the extracted text
curl -X POST https://xberg.example.com/v1/rag/collections/research_papers/documents \
  -H "Authorization: Bearer $XBERG_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"kind": "text", "external_id": "paper-1", "text": "<content returned by step 1>"}'

# 3. Retrieve
curl -X POST https://xberg.example.com/v1/rag/collections/research_papers/retrieve \
  -H "Authorization: Bearer $XBERG_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "neural networks"}'
```

The result is a URL crawled, extracted, embedded and ready to retrieve for your application. Retrieval is the end of the pipeline: Xberg has no answer endpoint, so your own model turns retrieved chunks into an answer.
