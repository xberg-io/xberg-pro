---
title: Backup and restore
description: Back up and restore PostgreSQL, the object store and secrets for Xberg Pro and Enterprise, and plan recovery objectives.
sidebar:
  order: 8
---

**Available in:** Pro, Enterprise

This page gives the backup and restore procedure for each stateful component of a self-hosted Xberg deployment. Use it to plan your recovery point objective (RPO) and to run a recovery after data loss. The chart runs no scheduled backup of its own, so schedule the backups below yourself.

## What holds state

Back up the first three components. The fourth is disposable and applies to Enterprise only.

| Component                   | Holds                                                                                                                                      | Loss impact                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| PostgreSQL                  | Projects, API keys, jobs, usage events, audit log, RAG collections and vectors (and on Enterprise, members)                                | Total. The deployment cannot start without it.                                                                  |
| Object store                | Extracted document bytes and cached embeddings                                                                                             | Results become unreadable. Metadata in PostgreSQL still points at the missing objects.                          |
| Secrets                     | Database URLs, signing keys, storage credentials, provider API keys, and on Pro the license token, `XBERG_ADMIN_KEY` and `INTEGRATION_KEK` | Services cannot start. Existing tokens stop validating, and stored integration credentials cannot be decrypted. |
| NATS JetStream (Enterprise) | Queued and in-flight jobs                                                                                                                  | Queued jobs are lost and clients resubmit them. Do not back up JetStream.                                       |

## PostgreSQL

### What the schema needs

The schema needs four extensions: `uuid-ossp`, `pgcrypto`, `btree_gin` and `vector`. It also uses `vectorscale` when the server provides it. A restore target without `vector` fails, because the vector columns cannot be created.

Row-level security is part of the schema. Every tenant-scoped table declares `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`. `pg_dump` writes the policies into the post-data section, so the data load runs before the policies exist, and a restore as the plain database owner succeeds.

### Logical backup

Run `pg_dump` in custom format, which supports parallel and selective restore:

```bash
pg_dump \
  --format=custom \
  --compress=9 \
  --no-owner \
  --file=xberg-$(date -u +%Y%m%dT%H%M%SZ).dump \
  "$DATABASE_URL"
```

Use `--no-owner` when the restore target uses different role names. Schedule the dump at least daily, which gives an RPO of up to 24 hours. Vector data dominates the dump size, so measure your first dump and size the backup volume from that number.

### Point-in-time recovery

Point-in-time recovery needs continuous WAL archiving. A logical dump alone cannot do it. Enable archiving on the server:

```ini
wal_level = replica
archive_mode = on
archive_command = 'test ! -f /archive/%f && cp %p /archive/%f'
```

Copy the archive directory to durable storage off the database host. After you enable archiving, take a base backup:

```bash
pg_basebackup --pgdata=/backup/base --format=tar --gzip --wal-method=stream --progress
```

Keep the base backup and every WAL segment written after it. Together they let you recover to any moment in that window.

On managed PostgreSQL, use the provider's equivalent. Cloud SQL, RDS and Azure Database each run continuous backups and offer a restore-to-timestamp operation. Turn it on and set the retention window. Cloud SQL does not offer `vectorscale`, so a Cloud SQL deployment uses the HNSW index method. See [PostgreSQL on Cloud SQL](/operate/cloud-sql/).

### Encryption

Encrypt every backup artifact at rest. A `pg_dump` file and a WAL segment both carry full tenant data, including RAG vectors and API key records. Enable bucket encryption with a customer-managed key (CMK), which gives you control over the key and its rotation:

```bash
# Google Cloud Storage
gcloud storage buckets update gs://BUCKET \
  --default-encryption-key=projects/PROJECT/locations/LOCATION/keyRings/RING/cryptoKeys/KEY

# Amazon S3
aws s3api put-bucket-encryption --bucket BUCKET \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"aws:kms","KMSMasterKeyID":"KEY_ARN"}}]}'
```

When the bucket cannot use a CMK, encrypt the dump on the client before upload:

```bash
age --encrypt --recipient age1... \
  --output xberg-$(date -u +%Y%m%dT%H%M%SZ).dump.age \
  xberg-$(date -u +%Y%m%dT%H%M%SZ).dump
```

`gpg --encrypt --recipient` works the same way for a GPG-based process. Treat the WAL archive the same way, and encrypt each segment as `archive_command` writes it, before it leaves the database host:

```ini
archive_command = 'age --encrypt --recipient age1... --output /archive/%f.age %p'
```

Restrict read access on the archive path to the restore role only.

### Restore from a logical dump

The restore target must be an empty database on a server that provides the four extensions, in a cluster where the Xberg roles already exist (created by the [database bootstrap](/operate/cloud-sql/)).

1. Create the empty database.

   ```bash
   createdb --owner=xberg_schema_migrator xberg
   ```

2. Install the extensions as an administrator who can create them.

   ```bash
   psql --dbname=xberg \
     --command='CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS btree_gin; CREATE EXTENSION IF NOT EXISTS vector;'
   ```

3. Restore the dump. Use `--jobs` to rebuild indexes in parallel.

   ```bash
   pg_restore \
     --dbname=xberg \
     --no-owner \
     --jobs=4 \
     xberg-20260817T031500Z.dump
   ```

The vector index rebuild dominates restore time. An HNSW or DiskANN index on a large collection takes minutes to hours, so plan the maintenance window from a measured restore.

### Verify the restore

Run all four checks before you point traffic at the restored database:

```sql
-- 1. The extensions are present.
SELECT extname FROM pg_extension ORDER BY extname;

-- 2. Row-level security is on and forced for every tenant-scoped table.
SELECT relname FROM pg_class
WHERE relrowsecurity AND NOT relforcerowsecurity;
-- Expect zero rows.

-- 3. The policies survived the restore.
SELECT count(*) FROM pg_policies WHERE schemaname = 'public';
-- Expect the same count as the source database.

-- 4. The tenant data is there. Run this as a superuser.
SELECT count(*) FROM projects;
```

Check 4 needs a superuser because `projects` forces row-level security. A plain count returns 0 for the table owner and for the application login, since the session sets no project or user context. No Xberg role holds `BYPASSRLS`.

Then run the product's migration against the restored database. The schema apply is declarative and idempotent, so it changes nothing when the restore is complete. On Helm, run `helm upgrade` with `migrations.enabled=true` and the installed chart version. A migration that reports pending schema changes means the dump predates the running application version. Let the migration finish before the services start serving.

## Object store

### Managed object storage

Enable object versioning on the bucket. Versioning protects against an accidental delete or overwrite, which is the common failure. Add a lifecycle rule that expires noncurrent versions after your retention window.

```bash
# Google Cloud Storage
gcloud storage buckets update gs://BUCKET --versioning

# Amazon S3
aws s3api put-bucket-versioning --bucket BUCKET \
  --versioning-configuration Status=Enabled
```

For a second copy in another region, enable the provider's cross-region replication. Avoid a periodic `rsync` of the whole bucket, because the bucket grows with every extraction and a full scan slows down every day.

### The `fs` storage provider

The `fs` provider writes to a mounted volume. Back up the volume instead of the individual objects. Take a volume snapshot on the same schedule as the database dump. On Kubernetes, use a `VolumeSnapshot` against a CSI driver that supports it.

Take the database dump and the volume snapshot close together. A wide gap leaves PostgreSQL rows that point at objects the snapshot does not hold.

### Restore the object store

Restore the bucket or volume before you start the services. A service that starts against an empty object store answers document reads with a not-found error and does not repair itself later.

## Secrets

The charts read every credential from a Kubernetes Secret. Back up the source of truth, not the rendered Secret. If you use External Secrets Operator, the source of truth is your secret manager, so back up that vault with its own procedure. If you set secrets directly in chart values, keep the values file in a private repository or a secret manager and never commit it.

The signing keys deserve their own policy. Keep each key in the secret manager under its own access policy and rotation schedule. Never store a key, or a copy of it, next to the backup. Record only the key identifier and version in the backup metadata, so a restore can pair itself with the correct key without exposing it. A leaked backup must not be enough to mint valid tokens. A restore with a different signing key invalidates every issued token, and all users must sign in again.

On Pro, `INTEGRATION_KEK` encrypts stored integration credentials. A restore with a different key leaves those credentials unreadable, so keep the same key across restores and upgrades.

## Restore drill

An untested backup is not a backup. Run a drill each quarter and record the result.

1. Provision a scratch database and a scratch bucket.
2. Restore the most recent dump into the scratch database.
3. Restore or copy the object store into the scratch bucket.
4. Deploy the chart against the scratch pair with `migrations.enabled: true`.
5. Create a project, submit an extraction and read the result back.
6. Run a RAG retrieve against a restored collection. This exercises the vector indexes, which the earlier steps do not.
7. Record the wall-clock time from step 2 to step 6. That number is your recovery time objective (RTO).

Delete the scratch resources after the drill.

## Recovery objectives

Your recovery point comes from the backup method, not from the schedule alone.

| Method                                  | Recovery point         | Recovery time                                            |
| --------------------------------------- | ---------------------- | -------------------------------------------------------- |
| Daily `pg_dump`                         | Up to 24 hours of loss | Measured by the drill. Index rebuild dominates.          |
| WAL archiving with a weekly base backup | Seconds                | Base restore plus WAL replay from the base backup.       |
| Managed provider continuous backup      | Seconds                | Provider-defined. Usually faster than a logical restore. |

Choose WAL archiving or a managed equivalent when losing a day of usage records is unacceptable. Usage events cannot be recomputed from the object store.
