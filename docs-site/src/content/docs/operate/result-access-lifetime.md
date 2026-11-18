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

Set both result access variables or neither. Setting only one makes startup fail. Startup also fails if the policy is combined with a single-instance install, the standard data policy or shared result caches.

The policy admits extraction jobs submitted inline or by multipart upload. These are refused while it is on: integration sources, document version attachment, crawl, and presigned upload creation and confirmation (including confirming a batch staged before you enabled it). Run those flows on a separate installation.

## Verify

Submit a job, then read its result before and after the lifetime. After the lifetime, a read returns HTTP 410 with the error code `job.result_expired`. To test quickly, deploy a generation with a short lifetime such as `PRO_RESULT_ACCESS_LIFETIME_SECS=60` and confirm the error after a minute.

## How changes apply

- Each job records the epoch and lifetime in force when it was accepted. Changing the variables affects only later jobs. It does not shorten, extend or restore access for existing jobs.
- Jobs accepted before you enabled the policy are not covered.
- The lifetime counts from the job's completion time. A read that started before expiry may finish for up to 30 seconds. Responses carry `Cache-Control: private, no-store`, but bytes already delivered cannot be recalled.

## What it does not do

Input files, results, page images and cache entries stay in storage after access expires. The policy does not expire input access, revoke storage URLs already issued, clean up backups or snapshots, or enable Enterprise result retention. To delete objects, apply lifecycle rules in your object store. See [Backup and restore](/operate/backup-and-restore/) for versioning and retention considerations.
