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

Use `code` for programmatic checks, `message` for display and `details` for the structured payload specific to each case. The catalogue below lists the codes a client can receive. Some further codes are defined but never emitted. They appear under [Reserved codes](#reserved-codes) so that you do not write a branch that can never run. See the [RAG guide](/guides/rag/) for the endpoints themselves.

## Catalogue

| HTTP | Code                                      | Trigger                                                                                                                                                                                                                                                | Details fields                                                                                                                             |
| ---- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 400  | `rag.response.invalid`                    | The RAG backend returned a reply this build could not parse.                                                                                                                                                                                           | `deserialize_error`                                                                                                                        |
| 400  | `rag.label_classification.unsupported`    | Collection creation requested automatic label classification (`label_vocabulary` or `label_classifier_threshold` on `CreateCollectionRequest`). No build ships an ingest-time classifier. Supply labels through `enrichment_overrides.labels` instead. | `field`                                                                                                                                    |
| 404  | `rag.disabled`                            | RAG is off for this project, or `PRO_RAG_ENABLED=false` on Pro.                                                                                                                                                                                        | `project_id`                                                                                                                               |
| 404  | `rag.collection.not_found`                | The `{name}` path parameter does not resolve in the active project.                                                                                                                                                                                    | `name`                                                                                                                                     |
| 404  | `rag.job.not_found`                       | A referenced RAG job id does not resolve, or access is denied.                                                                                                                                                                                         | none                                                                                                                                       |
| 409  | `rag.collection.conflict`                 | The collection name already exists in this project.                                                                                                                                                                                                    | `name`                                                                                                                                     |
| 422  | `rag.request.invalid`                     | The request body failed validation.                                                                                                                                                                                                                    | varies by field                                                                                                                            |
| 422  | `rag.vector.dim_mismatch`                 | The supplied vector dimension does not match the collection.                                                                                                                                                                                           | ingest: `expected`, `got`, `chunk_index`; retrieve, mismatched width: `expected`, `got`; retrieve, out-of-range width: `got`, `min`, `max` |
| 422  | `rag.filter.complexity_exceeded`          | A filter exceeded a depth, breadth or size bound.                                                                                                                                                                                                      | `kind`, `observed`, `cap`                                                                                                                  |
| 422  | `rag.filter.unknown_field`                | A filter references a field the collection does not have.                                                                                                                                                                                              | `field`                                                                                                                                    |
| 422  | `rag.filter.type_mismatch`                | A filter operation is not valid for the field's type.                                                                                                                                                                                                  | `field`, `operation`                                                                                                                       |
| 422  | `rag.rerank.invalid`                      | Rerank was requested where the collection forbids it.                                                                                                                                                                                                  | `reason`                                                                                                                                   |
| 422  | `rag.migrate.cross_dimension.unsupported` | The migration target dimension differs from the collection's.                                                                                                                                                                                          | `embedding_source`, `expected`, `got`                                                                                                      |
| 422  | `rag.migrate.version_not_greater`         | The migration target embedding version is not greater than the current one.                                                                                                                                                                            | `target_embedding_version`, `current_embedding_version`                                                                                    |
| 429  | `rag.quota_exceeded`                      | The collection document quota is reached.                                                                                                                                                                                                              | `limit`, `current`                                                                                                                         |
| 500  | `rag.retrieve.failed`                     | Retrieve failed for a reason other than timeout or service outage.                                                                                                                                                                                     | none                                                                                                                                       |
| 500  | `rag.retrieve.internal`                   | The vector store reported an internal error. The message is generic and the cause is in the service log.                                                                                                                                               | none                                                                                                                                       |
| 500  | `rag.collection.config_invalid`           | A stored collection config does not match the shape this build expects.                                                                                                                                                                                | field-shape case: `field`; embedding-width case (the embedding source produces a different width than the collection): `expected`, `got`   |
| 501  | `rag.rerank.unavailable`                  | This build ships no reranker for the requested kind.                                                                                                                                                                                                   | `kind`                                                                                                                                     |
| 503  | `rag.unavailable`                         | No RAG service responded to the request.                                                                                                                                                                                                               | none                                                                                                                                       |
| 504  | `rag.retrieve.timeout`                    | Retrieve exceeded the 30-second budget.                                                                                                                                                                                                                | none                                                                                                                                       |

## Reserved codes

These constants are defined but nothing emits them, so no client can receive them today:

`rag.rerank.model_unavailable`, `rag.rerank.timeout`, `rag.rate_limited`, `rag.limiter.unavailable`, `rag.migrate.not_implemented`, `rag.migrate.in_progress`, `rag.embedding_source.locked`, `rag.index_method.locked`.

Do not branch on them. If one of them starts being emitted, it moves into the catalogue above.

`rag.migrate.job_not_found` is a related quirk and not a reserved code. The migration endpoints raise it through the generic not-found error, whose `code` is always the fixed string `not_found`. The RAG-specific name reaches the client only as the `message` text, never as `code`, so a client cannot branch on it as a `code` value. The same applies to a missing collection referenced from a migration operation: `rag.collection.not_found` surfaces as `message` there, even though it is a real `code` value on the collection endpoints.

## Validation order

The order of `4xx` checks relative to a database or reranker call depends on the endpoint. These checks are pure request-shape checks and run before any database or reranker call:

- `rag.request.invalid`
- `rag.label_classification.unsupported`
- `rag.migrate.cross_dimension.unsupported`
- `rag.migrate.version_not_greater`

The remaining codes fire only after a database call has already happened:

- `rag.collection.conflict` comes from the collection insert.
- `rag.rerank.invalid` fires only after the collection has been loaded by name.
- On the retrieve path, `rag.vector.dim_mismatch`, `rag.filter.complexity_exceeded`, `rag.filter.unknown_field` and `rag.filter.type_mismatch` come from the vector store, that is, after its call returns.

Do not assume validation-before-database ordering for a code outside the first group.

## Rerank fallback

A successful retrieve response can still surface a rerank problem through `score_breakdown.rerank_fallback` instead of an error code. A rerank timeout or failure never fails the whole request. It falls back to the primary-stage ordering:

- Rerank timeout (per-collection budget exceeded): `rerank_fallback` is `"timeout"`. No dedicated error code exists for this case, and the request still returns `200`.
- Rerank failure, for example a scoring error: `rerank_fallback` is `"error"`.

`rag.rerank.unavailable` is different in kind. It short-circuits the whole request before any retrieval work, because Xberg probes the reranker capability registry at request time.

## Code format

Every code starts with `rag.` and uses only lowercase letters, digits, underscores and dots. No code ends with a dot or contains `..`, and no two codes collide.
