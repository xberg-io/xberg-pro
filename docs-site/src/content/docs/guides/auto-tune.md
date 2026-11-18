---
title: Auto-tune
description: Search extraction settings against your own ground truth, review the leaderboard and promote the winner to a reusable tuning profile.
sidebar:
  order: 7
---

**Available in:** Pro, Enterprise. Requires a valid Pro license.

Auto-tune sweeps extraction settings, such as OCR backends and their options, over sample documents you supply with expected output. It scores each candidate configuration, holds back part of the documents to score the winner, and returns a leaderboard. You then promote the best configuration to a named tuning profile.

A valid license grants the feature. Operators can switch it off with `PRO_AUTO_TUNE_ENABLED=false`, which makes every `/v1/auto-tune` and `/v1/tuning-profiles` request answer `404` with `auto_tune.disabled`.

## Check what the deployment can search

Ask which OCR backends and options this deployment supports before you build a search configuration:

```bash
curl "$XBERG_URL/v1/auto-tune/capabilities" \
  -H "Authorization: Bearer $XBERG_API_KEY"
```

## Submit a run

The request is multipart. A JSON `request` part describes the documents and their ground truth, with optional `budget`, `search` and `routing`, and one `file` part per document is matched to it by filename:

```bash
curl -X POST "$XBERG_URL/v1/auto-tune" \
  -H "Authorization: Bearer $XBERG_API_KEY" \
  -F 'request={
    "documents": [
      {
        "filename": "invoice.pdf",
        "ground_truth_kind": "markdown",
        "ground_truth": "# Invoice 1042\n\nTotal: 1,250.00"
      }
    ],
    "webhook": { "url": "https://example.com/hooks/auto-tune", "secret": "REPLACE_WITH_RANDOM_SECRET" }
  };type=application/json' \
  -F "file=@invoice.pdf"
```

`ground_truth_kind` is `markdown`, `plaintext` or `structured`. For `structured`, `ground_truth` is a JSON string encoding `{"schema": ..., "expected": ...}`, and both parts are required. Set `routing` to `true` to tune per-document routing in addition to the global configuration. The response carries an `auto_tune_job_id` (a ULID).

## Follow the run

```bash
curl "$XBERG_URL/v1/auto-tune/$AUTO_TUNE_JOB_ID" \
  -H "Authorization: Bearer $XBERG_API_KEY"
```

Poll until the status is terminal, or use the optional `webhook` to receive `auto_tune.completed` or `auto_tune.failed`; see [Webhooks](/guides/webhooks/#auto-tune-events). `POST /v1/auto-tune/{id}/stop` asks the run to finish cooperatively and keep what it has found.

## Read the result and promote

```bash
curl "$XBERG_URL/v1/auto-tune/$AUTO_TUNE_JOB_ID/result" \
  -H "Authorization: Bearer $XBERG_API_KEY"

curl -X POST "$XBERG_URL/v1/auto-tune/$AUTO_TUNE_JOB_ID/promote" \
  -H "Authorization: Bearer $XBERG_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "name": "invoices-tuned" }'
```

The result holds the leaderboard and the winning configuration. Promotion writes a named, reusable tuning profile. Manage profiles with `GET /v1/tuning-profiles`, and `GET` or `DELETE` on `/v1/tuning-profiles/{id}`.

## Limits

These variables cap what one run can consume. Raise them only with the memory and CPU to match.

| Variable                            | Default | Meaning                                                                     |
| ----------------------------------- | ------- | --------------------------------------------------------------------------- |
| `PRO_AUTO_TUNE_MAX_CONCURRENCY`     | 2       | Trials evaluated at the same time within one run                            |
| `PRO_AUTO_TUNE_MAX_TRIALS`          | 64      | Candidate configurations per run; overrides `max_trials` in the config file |
| `PRO_AUTO_TUNE_MAX_DOCUMENTS`       | 50      | Documents accepted per run                                                  |
| `PRO_AUTO_TUNE_MAX_ACTIVE_JOBS`     | 3       | Runs active at the same time                                                |
| `PRO_AUTO_TUNE_MAX_WALL_CLOCK_SECS` | 900     | Wall-clock budget of one run                                                |
| `PRO_AUTO_TUNE_TOLERANCE`           | 0.01    | Scores within this distance of the best count as a tie                      |
| `PRO_AUTO_TUNE_HELD_OUT_FRACTION`   | 0.3     | Share of documents held back to score the winner                            |

The search ladder itself, the structured set of settings to explore, lives in the optional TOML file at `XBERG_PRO_CONFIG_FILE`. Environment variables win over the file. See [Pro configuration](/reference/pro-configuration/#auto-tune).
