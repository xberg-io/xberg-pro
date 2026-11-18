---
title: RAG errors
description: Error codes returned by the RAG endpoints, with HTTP status, trigger and the structured details each carries.
sidebar:
  order: 5
---

**Available in:** Pro, Enterprise

Every RAG endpoint returns errors under the standard error envelope:

```json
{
  "error": {
    "code": "rag.collection.not_found",
    "message": "Collection \"docs\" not found",
    "details": { "name": "docs" }
  }
}
```

Use `code` for programmatic checks, `message` for display and `details` for the structured payload specific to each case. The catalogue below lists the codes a client can receive. See the [RAG guide](/guides/rag/) for the endpoints themselves.

## Catalogue

| HTTP | Code                                      | Trigger                                                                                                                                                                                                                                                 | Details fields                                                                                                                             |
| ---- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 400  | `rag.response.invalid`                    | The RAG service returned a reply that could not be parsed.                                                                                                                                                                                              | `deserialize_error`                                                                                                                        |
| 400  | `rag.label_classification.unsupported`    | Collection creation requested automatic label classification (`label_vocabulary` or `label_classifier_threshold` in the collection creation request). Xberg has no ingest-time classifier. Supply labels through `enrichment_overrides.labels` instead. | `field`                                                                                                                                    |
| 403  | `rag.policy_denied`                       | The operator data policy (`extraction_only`) denies RAG reads and writes.                                                                                                                                                                               | none                                                                                                                                       |
| 404  | `rag.disabled`                            | RAG is off for this project, or `PRO_RAG_ENABLED=false` on Pro.                                                                                                                                                                                         | `project_id`                                                                                                                               |
| 404  | `rag.collection.not_found`                | The `{name}` path parameter does not resolve in the active project.                                                                                                                                                                                     | `name`                                                                                                                                     |
| 404  | `rag.job.not_found`                       | A referenced RAG job id does not resolve, or access is denied.                                                                                                                                                                                          | none                                                                                                                                       |
| 409  | `rag.collection.conflict`                 | The collection name already exists in this project.                                                                                                                                                                                                     | `name`                                                                                                                                     |
| 422  | `rag.request.invalid`                     | The request body failed validation.                                                                                                                                                                                                                     | varies by field                                                                                                                            |
| 422  | `rag.vector.dim_mismatch`                 | The supplied vector dimension does not match the collection.                                                                                                                                                                                            | ingest: `expected`, `got`, `chunk_index`; retrieve, mismatched width: `expected`, `got`; retrieve, out-of-range width: `got`, `min`, `max` |
| 422  | `rag.filter.complexity_exceeded`          | A filter exceeded a depth, breadth or size bound.                                                                                                                                                                                                       | `kind`, `observed`, `cap`                                                                                                                  |
| 422  | `rag.filter.unknown_field`                | A filter references a field the collection does not have.                                                                                                                                                                                               | `field`                                                                                                                                    |
| 422  | `rag.filter.type_mismatch`                | A filter operation is not valid for the field's type.                                                                                                                                                                                                   | `field`, `operation`                                                                                                                       |
| 422  | `rag.rerank.invalid`                      | Rerank was requested where the collection forbids it.                                                                                                                                                                                                   | `reason`                                                                                                                                   |
| 422  | `rag.migrate.cross_dimension.unsupported` | The migration target dimension differs from the collection's.                                                                                                                                                                                           | `embedding_source`, `expected`, `got`                                                                                                      |
| 422  | `rag.migrate.version_not_greater`         | The migration target embedding version is not greater than the current one.                                                                                                                                                                             | `target_embedding_version`, `current_embedding_version`                                                                                    |
| 422  | `rag.retrieve.response_too_large`         | The retrieve result exceeds its size limit. Lower `top_k` or request less content.                                                                                                                                                                      | none                                                                                                                                       |
| 429  | `rag.quota_exceeded`                      | The collection document quota is reached.                                                                                                                                                                                                               | `limit`, `current`                                                                                                                         |
| 500  | `rag.collection.load_failed`              | The collection could not be loaded during retrieve. The cause is in the service log.                                                                                                                                                                    | none                                                                                                                                       |
| 500  | `rag.retrieve.failed`                     | Retrieve failed for a reason other than timeout or service outage.                                                                                                                                                                                      | none                                                                                                                                       |
| 500  | `rag.retrieve.internal`                   | The vector store reported an internal error. The message is generic and the cause is in the service log.                                                                                                                                                | none                                                                                                                                       |
| 500  | `rag.collection.config_invalid`           | A stored collection config does not match the shape this build expects.                                                                                                                                                                                 | field-shape case: `field`; embedding-width case (the embedding source produces a different width than the collection): `expected`, `got`   |
| 501  | `rag.rerank.unavailable`                  | This build ships no reranker for the requested kind.                                                                                                                                                                                                    | `kind`                                                                                                                                     |
| 503  | `rag.retrieve.embed_failed`               | The query could not be embedded. The cause is in the service log.                                                                                                                                                                                       | none                                                                                                                                       |
| 503  | `rag.retrieve.limit_exceeded`             | The project's concurrent retrieve limit is reached (`RAG_RETRIEVE_CONCURRENCY_PER_PROJECT`).                                                                                                                                                            | none                                                                                                                                       |
| 503  | `rag.unavailable`                         | No RAG service responded to the request.                                                                                                                                                                                                                | none                                                                                                                                       |
| 504  | `rag.retrieve.timeout`                    | Retrieve exceeded its deadline, 30 seconds by default. On Enterprise, `RAG_RETRIEVE_TIMEOUT_SECS` sets it.                                                                                                                                              | none                                                                                                                                       |

## Migration endpoints

The migration endpoints report a missing migration job or a missing collection through the generic not-found error, whose `code` is always the fixed string `not_found`. The specific name, `rag.migrate.job_not_found` or `rag.collection.not_found`, appears only in `message`. Do not branch on it as a `code` value there.

## Private MCP listener errors

The private [MCP listener](/reference/pro-configuration/#private-mcp-listener) returns these codes as tool errors, not as HTTP statuses. It also returns `rag.collection.not_found` and `rag.retrieve.response_too_large` from the table above.

| Code                          | Trigger                                                                                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rag.invalid_cursor`          | The continuation is malformed, was issued for another project, or was signed with a different `MCP_CURSOR_SIGNING_KEY`.                                   |
| `rag.document_page_too_large` | A document summary exceeds 4,096 combined bytes of external ID, title and MIME type, or the page exceeds the response budget. Retry with a smaller limit. |
| `rag.policy_unavailable`      | The listener could not confirm the project's access policy in time, or the required release grants are missing. It returns no data.                       |

On Enterprise, retrieval also passes through the RAG service, which can return these codes to the MCP client:

| Code                             | Trigger                                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `rag.policy_denied`              | The operator data policy denies RAG reads.                                                           |
| `rag.retrieve.deadline_exceeded` | The retrieval deadline passed before the service answered.                                           |
| `rag.retrieve.response_invalid`  | The service produced a reply that did not match the requested collection or could not be serialized. |
| `rag.retrieve.clock_unavailable` | The service could not read the system clock to check the deadline.                                   |

## Validation order

Four codes are pure request-shape checks and return before any database or reranker work: `rag.request.invalid`, `rag.label_classification.unsupported`, `rag.migrate.cross_dimension.unsupported` and `rag.migrate.version_not_greater`.

Every other `4xx` code can fire after work has started. For example, `rag.collection.conflict` comes from the insert, `rag.rerank.invalid` needs the collection loaded, and the retrieve filter and dimension errors come back from the vector store. Do not assume a request failed before it touched the database.

## Rerank fallback

A successful retrieve response can still surface a rerank problem through `score_breakdown.rerank_fallback` instead of an error code. A rerank timeout or failure never fails the whole request. It falls back to the primary-stage ordering:

- Rerank timeout (per-collection budget exceeded): `rerank_fallback` is `"timeout"`. No dedicated error code exists for this case, and the request still returns `200`.
- Rerank failure, for example a scoring error: `rerank_fallback` is `"error"`.

`rag.rerank.unavailable` is different in kind. It rejects the whole request before any retrieval work.

Every code starts with `rag.` and uses lowercase letters, digits, underscores and dots.
