---
title: Result access lifetime
description: Make extraction results unreadable after a fixed time on replicated Xberg Pro.
sidebar:
  order: 10
---

**Available in:** Pro (replicated deployments)

## When to use it

Use this when policy says a client must not be able to read an extraction result after a set time, for example 24 hours after the job finishes. After the lifetime passes, result and page reads return an error. It controls access only: the stored objects are not deleted.

It applies to replicated Pro, set up with the [deployment operator](/operate/deployment-operator/). A single-instance Pro install cannot enable it.

## Enable it

Add these variables to the configuration of a new generation, then roll it out with the operator:

```sh
PRO_RESULT_ACCESS_POLICY_EPOCH=1
PRO_RESULT_ACCESS_LIFETIME_SECS=86400
XBERG_DATA_POLICY=extraction_only
CACHE_ENABLED=false
CACHE_OBJECT_STORE_ENABLED=false
PRO_RAG_ENABLED=false
PRO_AUTO_TUNE_ENABLED=false
```

| Variable                          | Meaning                                                                 |
| --------------------------------- | ----------------------------------------------------------------------- |
| `PRO_RESULT_ACCESS_LIFETIME_SECS` | Seconds a result stays readable after the job finishes. 1 to 315360000. |
| `PRO_RESULT_ACCESS_POLICY_EPOCH`  | A positive integer you increase each time you change the policy.        |

Set both result access variables or neither. Setting only one makes startup fail. Startup also fails if the policy is combined with a single-instance install, the standard data policy or shared result caches. The private MCP listener in extraction mode (`mcp.mode=extraction`) also requires both variables.

The policy admits extraction jobs submitted inline or by multipart upload. These are refused while it is on: integration sources, document version attachment, crawl, and presigned upload creation and confirmation (including confirming a batch staged before you enabled it). Run those flows on a separate installation.

## Verify

Submit a job, then read its result before and after the lifetime. After the lifetime, a read returns HTTP 410 with the error code `job.result_expired`. To test quickly, deploy a generation with a short lifetime such as `PRO_RESULT_ACCESS_LIFETIME_SECS=60` and confirm the error after a minute.

## How changes apply

- Each job records the epoch and lifetime in force when it was accepted. Changing the variables affects only later jobs. It does not shorten, extend or restore access for existing jobs.
- Jobs accepted before you enabled the policy are not covered.
- The lifetime counts from the job's completion time. A read that started before expiry may finish for up to 30 seconds. Responses carry `Cache-Control: private, no-store`, but bytes already delivered cannot be recalled.

## What it does not do

By default, input files, results, page images and cache entries stay in storage after access expires. The policy does not expire input access, revoke storage URLs already issued, clean up backups or snapshots, or enable Enterprise result retention. To delete objects, apply lifecycle rules in your object store, or opt in to the S3 cleanup below. See [Backup and restore](/operate/backup-and-restore/) for versioning and retention considerations.

## Delete expired results on AWS S3 (optional)

Set `PRO_RESULT_S3_CLEANUP_ENABLED=true` on a generation to have the worker delete the specific S3 object version of each expired main result. It is off by default (`false` in the chart values). Use it only when your retention policy allows eligible results to be deleted physically.

Requirements:

- An extraction-only replicated generation on standard AWS S3 storage, with the installation and generation bound to the same storage namespace.
- Bucket versioning enabled, and a result prefix reserved for this installation's writers.
- The runtime identity has `s3:PutObject` and `s3:GetObject` on the prefix, plus `s3:DeleteObjectVersion`.
- The database migration is applied before you deploy a writer that records the new upload intent.

Scope:

- Only results with an exact version receipt are deleted. Results without a receipt, shared copies, inputs, page images, recovery context, other storage backends, backups and snapshots are left alone.
- Active reads, pending webhook callbacks and writes with uncertain completion keep their protections. Unacknowledged deletes are retried.
- Removing a project outright removes the cleanup ledger, so cleanup is not guaranteed after that.
- Removing the two access-policy variables stops new enrollment and leaves this option unchanged.

`PRO_INPUT_S3_CLEANUP_ENABLED` is the matching opt-in for abandoned inputs that were staged but never attached to a job. It is also `false` by default.

### Settle a result whose upload was not confirmed

If a result upload was not acknowledged, the writer records an unsettled intent and does not send a second upload. After the intent expires, settle it for one known project, job and artifact:

1. Apply the schema migration, deploy the compatible Pro runtime and drain all older Pro executors.
2. Run a separate maintenance upgrade that grants reconciliation access. This needs Pro chart 0.7.5 or later, because `migrations.retainedS3ReconciliationGrants` is not in earlier charts:

   ```sh
   helm upgrade ... --set migrations.retainedS3ReconciliationGrants=grant
   ```

   The default is `verify`, which is correct for ordinary upgrades. `grant` and `revoke` require maintenance migrations to be enabled with `contractRollback=false`.

3. From the admitted generation, using the same maintenance database and storage configuration:

   ```sh
   /app/xberg-admin retention reconcile-s3-result \
     --project-id "$PROJECT_ID" --job-id "$JOB_ID" --artifact-id "$ARTIFACT_ID"
   ```

   The command settles the intent only when a signed read confirms the bytes and version. An inconclusive read leaves it unsettled. The result stays expired, and deletion still passes the usual checks. For an abandoned input, use `reconcile-s3-input --project-id ... --physical-write-id ...`.

4. Before you downgrade the chart or binary, finish outstanding requests, then run another maintenance upgrade with `migrations.retainedS3ReconciliationGrants=revoke` and confirm the grants are gone.

## Azure Blob Storage

On standard Azure Blob Storage, the result writer records a version only when the upload returns one. Private MCP result reads require that exact version and never fall back to the current blob. Older results and writes without a version receipt cannot be read through MCP. Azure version deletion is not available as a cleanup option. Apply the database migration before you start a binary that records Azure versions.
