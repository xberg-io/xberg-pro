---
title: Managed PostgreSQL and Cloud SQL
description: Requirements for a managed PostgreSQL database, and a step-by-step bootstrap of an empty database on Google Cloud SQL for PostgreSQL 18.
sidebar:
  order: 5
---

**Available in:** Pro, Enterprise

Xberg needs a PostgreSQL database that you provision. This page lists what a managed PostgreSQL service must provide, then bootstraps an empty database on Google Cloud SQL for PostgreSQL 18.

The bootstrap script ships in the chart archive for both products. It runs from your machine and needs no superuser. AWS RDS and other managed services use the same steps with their own endpoint and administrator credential.

## Requirements

| Requirement        | Detail                                                                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Version            | PostgreSQL 15 to 18. The non-superuser bootstrap supports 16 to 18. PostgreSQL 15 needs a true superuser.                                                                                                     |
| Extensions         | `uuid-ossp`, `pgcrypto`, `btree_gin` and `vector` (pgvector 0.8.0 or newer). The administrator must be able to create them.                                                                                   |
| Optional extension | `vectorscale` for DiskANN indexes. Cloud SQL does not offer it, so the product uses the pgvector HNSW path. On Enterprise set `vectorstore.defaultIndexMethod: hnsw`.                                         |
| Administrator      | A login with `LOGIN`, `CREATEROLE`, `CREATEDB` and database `CREATE`, without `SUPERUSER`, `BYPASSRLS` or `REPLICATION`. Provider role names such as `cloudsqlsuperuser` or `rds_superuser` are not required. |
| Roles              | The bootstrap creates fixed roles and eight login roles. Roles are cluster-global.                                                                                                                            |
| Dedicated instance | Use one PostgreSQL instance for each independently administered Xberg deployment. Separate databases or custom login names do not isolate the fixed roles.                                                    |

Never give the administrator credential, the schema-owner credential or the physical-migration credential to a runtime pod. The chart never stores or mounts the administrator credential.

## Scope

This procedure is for an empty database on a dedicated instance. The script accepts only an empty database or one it produced earlier. It refuses a database that already has Xberg roles or tables in `public`, before it changes anything.

It does not convert an existing Cloud SQL database. For an existing installation, contact [support](/more/support/).

## Bootstrap an empty database

1. **Prepare the instance.** Create an empty database and set a password for the built-in `postgres` login. Keep its Cloud SQL defaults: `LOGIN INHERIT CREATEROLE CREATEDB NOSUPERUSER NOBYPASSRLS NOREPLICATION`, with direct membership in `cloudsqlsuperuser`. Do not create Xberg roles yourself.

2. **Allow your machine to connect**, through an authorized network path or the Cloud SQL Auth Proxy. The example uses the proxy on `127.0.0.1`. Its local leg is plaintext, and the proxy encrypts the connection to Cloud SQL.

3. **Locate the chart files.** Point `CHART_DIR` at the extracted chart of the release you will install, either `pro` or `xberg-enterprise`:

   ```shell
   export CHART_DIR=/path/to/pro
   test -f "$CHART_DIR/charts/_distribution/files/pro-db-bootstrap.sh" || exit 1
   test -f "$CHART_DIR/charts/_distribution/files/managed-postgres-fresh-bootstrap.sql" || exit 1
   ```

4. **Set the connection and passwords.** Choose eight distinct login passwords, each different from the administrator password. The `*_URLENCODED` variables hold URL-safe encodings of the passwords. The plain variables hold the raw values.

   ```shell
   export PGHOST=127.0.0.1
   export PGPORT=5432
   export PGSSLMODE=disable
   export POSTGRES_DB=xberg
   export POSTGRES_USER=postgres
   export POSTGRES_PASSWORD=REPLACE_WITH_CLOUD_SQL_ADMINISTRATOR_PASSWORD
   export PGPASSWORD="$POSTGRES_PASSWORD"
   export POSTGRES_APPLICATION_PASSWORD=REPLACE_WITH_APPLICATION_PASSWORD
   export POSTGRES_MAINTENANCE_PASSWORD=REPLACE_WITH_MAINTENANCE_PASSWORD
   export POSTGRES_SCHEMA_OWNER_PASSWORD=REPLACE_WITH_SCHEMA_OWNER_PASSWORD
   export POSTGRES_MIGRATION_PASSWORD=REPLACE_WITH_SCHEMA_MIGRATOR_PASSWORD
   export POSTGRES_ROLE_ADMIN_PASSWORD=REPLACE_WITH_ROLE_ADMIN_PASSWORD
   export POSTGRES_INDEX_WORKER_PASSWORD=REPLACE_WITH_VECTOR_INDEX_WORKER_PASSWORD
   export POSTGRES_VECTOR_BROKER_PASSWORD=REPLACE_WITH_VECTOR_BROKER_PASSWORD
   export POSTGRES_PHYSICAL_MIGRATION_PASSWORD=REPLACE_WITH_PHYSICAL_MIGRATION_PASSWORD
   export POSTGRES_PASSWORD_URLENCODED=REPLACE_WITH_PERCENT_ENCODED_ADMINISTRATOR_PASSWORD
   export POSTGRES_MIGRATION_PASSWORD_URLENCODED=REPLACE_WITH_PERCENT_ENCODED_SCHEMA_MIGRATOR_PASSWORD
   export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD_URLENCODED}@${PGHOST}:${PGPORT}/${POSTGRES_DB}"
   export MIGRATION_DATABASE_URL="postgresql://xberg_schema_migrator:${POSTGRES_MIGRATION_PASSWORD_URLENCODED}@${PGHOST}:${PGPORT}/${POSTGRES_DB}"
   ```

5. **Set the bootstrap options and run the script.**

   ```shell
   export MIGRATION_PLAN_DATABASE=xberg_schema_plan
   export PLANNING_DATABASE_BOOTSTRAP=true
   export PLANNING_EXTENSIONS_FILE="$CHART_DIR/charts/_distribution/files/extensions-prepare.sql"
   export PRO_DB_BOOTSTRAP_MODE=standard
   export PRO_DB_BOOTSTRAP_PHASE=all
   export PRO_DB_INITIALIZE_SCHEMA=true
   export PRO_DB_DEFER_CLAIMS_ENABLE=true
   export SCHEMA_DIRECTORY="$CHART_DIR/charts/_distribution/files"
   sh "$CHART_DIR/charts/_distribution/files/pro-db-bootstrap.sh"
   ```

   The script creates the eight login roles, installs the schema and extensions, prepares the planning database (used to preview schema changes) and verifies the result.

6. **If the script is interrupted, run it again** with the same credentials. It validates what exists and finishes the rest.

7. **Store the database URLs** in the Secrets that your product's install guide describes. Keep the schema-owner credential with the operator instead of placing it in Kubernetes. Never copy `POSTGRES_PASSWORD` or its URL into a Kubernetes Secret or workload.

## Install the chart

1. Leave these values at their defaults (disabled) for a fresh database. They apply only to older installations:

   ```yaml
   migrations:
     planningDatabaseBootstrap: false
     cloudSqlRoleBootstrap:
       enabled: false
   ```

2. Follow the install steps for your product: [Pro on Kubernetes](/start/pro-helm/) or [Enterprise on Kubernetes](/start/enterprise-helm/). The bootstrap already created the schema, so the migration hooks only validate and reconcile it in one Helm install.

3. When the product is Ready, rotate or remove the Cloud SQL administrator password from your operator environment.

## Rotate an application login

1. Create the next Secret before you change a workload.
2. Point `migrations.applicationDatabaseUrlSecret` at the next URL while `secrets.databaseUrlSecret` still selects the current URL.
3. Run the hooks and switch the workload selector.
4. Verify readiness, then delete the old credential.
