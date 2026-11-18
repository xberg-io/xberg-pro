---
title: Document versions
description: Track successive extractions of the same logical document, list its versions and diff any two of them.
sidebar:
  order: 24
---

**Available in:** Enterprise

Document versions tie successive extractions of the same logical document into one lineage. When you resubmit a changed file under the same `document_id`, Xberg records it as the next version, keeps every earlier extraction, and can compute a diff between any two. Pro has no lineage feature and does not accept caller-supplied document IDs.

## Submit a new version

Supply a `document_id` with the file. In a multipart request, add a text part named `document_id-<filename>` whose value is the document UUID:

```bash
curl -X POST "$XBERG_URL/v1/extract" \
  -H "Authorization: Bearer $XBERG_API_KEY" \
  -F "contract.pdf=@contract-v2.pdf" \
  -F "document_id-contract.pdf=3f0c6c2e-8d1b-4a53-9a4e-52c1d0b7e9aa"
```

In a JSON request, set `document_id` on the document entry. When you omit it, the server mints a new identifier and the extraction starts a new lineage.

The `202` response lists one entry under `documents` for each submission, with the `document_id` and the `version_sequence` it received. Keep the `document_id` in your own records; it is the handle for every call below.

## List versions

```bash
curl "$XBERG_URL/v1/documents/$DOCUMENT_ID/versions?limit=50" \
  -H "Authorization: Bearer $XBERG_API_KEY"
```

The response lists every extraction that shares the `document_id`, newest first. Each entry carries that version's job metadata: status, filename, page and byte counts and timestamps. It does not carry the extraction result. `limit` accepts values up to 200, and larger values are clamped. `offset` is clamped to 0-1,000,000.

Fetch the latest version, with its result, from `GET /v1/documents/{document_id}`. `GET /v1/documents` lists the project's documents. To read an earlier version's result, take its job ID from the versions list and call `GET /v1/jobs/{id}/result`.

## Diff two versions

`from` and `to` each name a version by its sequence number or by the job ID that produced it. Naming the same version for both is a `400`:

```bash
curl "$XBERG_URL/v1/documents/$DOCUMENT_ID/diff?from=1&to=2" \
  -H "Authorization: Bearer $XBERG_API_KEY"
```

A diff already computed for the same pair is served from cache. Xberg attempts a new diff inline with a two-second budget. If it finishes, the response is `200` with the diff. If not, the computation continues in the background and the response is `202` with a `diff_job_id`. Poll it:

```bash
curl "$XBERG_URL/v1/documents/$DOCUMENT_ID/diff/$DIFF_JOB_ID" \
  -H "Authorization: Bearer $XBERG_API_KEY"
```

## Combine with other features

[Data rooms](/guides/data-rooms/) hold project documents by `document_id`. A project API key sees only its own project's documents, and a request that names another project answers `403`.
