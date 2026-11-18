---
title: Result access lifetime
description: Limit how long newly admitted extraction results stay readable on generation-bound Xberg Pro.
sidebar:
  order: 10
---

**Available in:** Pro, generation-bound (replicated) deployments

Generation-bound Xberg Pro can limit access to newly admitted inline extraction results for a fixed time. The mode expires access through the job result and page handlers. It does not delete stored objects.

## Enable prospectively

Start with an admitted generation configured through the [deployment operator](/operate/deployment-operator/). Keep its installation, generation, storage and configuration digest bindings. Add these variables to that generation's configuration:

```sh
PRO_RESULT_ACCESS_POLICY_EPOCH=1
PRO_RESULT_ACCESS_LIFETIME_SECS=86400
XBERG_DATA_POLICY=extraction_only
CACHE_ENABLED=false
CACHE_OBJECT_STORE_ENABLED=false
PRO_RAG_ENABLED=false
PRO_AUTO_TUNE_ENABLED=false
```

Unset both result access variables to leave the feature disabled. Setting only one fails startup. The epoch must be a positive integer, and the lifetime must be between 1 and 315360000 seconds. Startup also fails when the policy is enabled in unbound singleton mode, with the standard data policy, or with shared result caches enabled. The normal generation startup checks, including required authentication and shared storage, still apply.

The supported admission cohort is inline or multipart leaf extraction without document attachment. Integration sources and document version attachment are refused, and crawl is unsupported in the generation-bound runtime. Presigned upload creation and confirmation are refused while this policy is enabled, including confirmation of a batch staged before activation. Use a separate installation, or leave this mode disabled, for those flows.

## Access and policy changes

Job creation, quota admission, recovery inputs and the accepted result policy commit together. Each newly admitted job records the configured epoch and lifetime. Jobs without an enrollment stay unmanaged, so enabling the mode does not apply retention to historical jobs.

The database records terminal completion time. Once completion plus the accepted lifetime has elapsed, a new result read returns HTTP 410 with `job.result_expired`, even before any cleanup runs. A read acquired before expiry has a bounded 30-second read lease, and retained payload responses use `Cache-Control: private, no-store`. Bytes already delivered cannot be recalled.

Changing the configured epoch or lifetime affects later admissions only. It neither shortens nor lengthens an existing job's accepted lifetime, and it cannot restore expired access. Record policy changes with a new epoch and the generation's configuration digest. No bulk endpoint activates the policy for historical jobs.

## Storage boundary

Input objects, results, page objects, recovery context and historical cache entries can remain stored after access expires. This mode runs no per-job physical cleanup and makes no promise about deletion time or content erasure. It does not:

- Expire input access.
- Revoke storage URLs that were already issued.
- Reconcile backups or snapshots.
- Activate Enterprise protected-result retention.

To remove stored objects, apply lifecycle rules on your object store. See [Backup and restore](/operate/backup-and-restore/) for versioning and retention considerations.
