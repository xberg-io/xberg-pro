---
title: PostgreSQL 18 on Cloud SQL
description: Bootstrap an empty Xberg database on Google Cloud SQL for PostgreSQL 18, and the general requirements for any managed PostgreSQL.
sidebar:
  order: 5
---

**Available in:** Pro, Enterprise

Xberg needs a PostgreSQL database you provision yourself. This page lists what a managed PostgreSQL service must provide, then walks through a fresh bootstrap on Google Cloud SQL for PostgreSQL 18. The bundled bootstrap supports both products and is provider-neutral: it runs from the operator's machine and needs no superuser authority. AWS RDS and other managed services use the same procedure with their own endpoint and administrator credential.

## Managed PostgreSQL requirements

| Requirement        | Detail                                                                                                                                                                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Version            | PostgreSQL 15 to 18. The restricted (non-superuser) bootstrap supports 16 to 18. PostgreSQL 15 needs a true superuser.                                                                                                                          |
| Extensions         | `uuid-ossp`, `pgcrypto`, `btree_gin` and `vector` (pgvector 0.8.0 or newer). The administrator must be able to create them, or to transfer provider-preinstalled extension routines.                                                            |
| Optional extension | `vectorscale` for DiskANN indexes. Cloud SQL does not offer it, so the product uses the pgvector HNSW path. On Enterprise set `vectorstore.defaultIndexMethod: hnsw`.                                                                           |
| Administrator      | A login with `LOGIN`, `CREATEROLE`, `CREATEDB` and database `CREATE`, without `SUPERUSER`, `BYPASSRLS` or `REPLICATION`. Admission is capability-based, so provider role names such as `cloudsqlsuperuser` or `rds_superuser` are not required. |
| Roles              | The bootstrap creates fixed capability roles and eight login roles. Roles are cluster-global.                                                                                                                                                   |
| Row-level security | Tenant tables enable and force row-level security. No role holds `BYPASSRLS`.                                                                                                                                                                   |
| Dedicated instance | Use one PostgreSQL instance for each independently administered Xberg deployment. Separate databases or custom login names do not isolate the fixed roles, and migrations change shared role memberships.                                       |

Never give the PostgreSQL administrator credential, the schema-owner credential or the physical-migration credential to a runtime pod. The chart never stores or mounts the administrator credential.

## Scope of this procedure

Use this procedure for an empty database on a dedicated instance. The restricted path accepts only an empty database or one already produced by this bootstrap. It refuses a marker-less database that has Xberg roles or non-extension relations in `public`, before it changes anything. It does not convert a legacy Cloud SQL database. For an existing installation, contact support for the reviewed upgrade procedure.

## Prepare the instance

Create an empty database and set a password for the built-in `postgres` login. That login must keep the Cloud SQL defaults: `LOGIN INHERIT CREATEROLE CREATEDB NOSUPERUSER NOBYPASSRLS NOREPLICATION`, with direct membership in `cloudsqlsuperuser`. Do not create Xberg roles yourself.

Allow the operator machine to connect, either through an authorized network path or through the Cloud SQL Auth Proxy. The example below uses the proxy on `127.0.0.1`. Its local leg is plaintext, and the proxy encrypts the connection to Cloud SQL.

Point `CHART_DIR` at the extracted chart of the exact release you will install, either `pro` or `xberg-enterprise`:

```shell
export CHART_DIR=/path/to/pro
test -f "$CHART_DIR/charts/_distribution/files/pro-db-bootstrap.sh" || exit 1
test -f "$CHART_DIR/charts/_distribution/files/managed-postgres-fresh-bootstrap.sql" || exit 1
```

Cloud SQL for PostgreSQL 18 must offer `uuid-ossp`, `pgcrypto`, `btree_gin` and `vector`. The bootstrap creates them.

## Run the fresh bootstrap

Set the connection parameters and eight distinct Xberg login passwords. Keep every password distinct from the Cloud SQL administrator password.

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
export MIGRATION_PLAN_DATABASE=xberg_schema_plan
export PLANNING_DATABASE_BOOTSTRAP=true
export PLANNING_EXTENSIONS_FILE="$CHART_DIR/charts/_distribution/files/extensions-prepare.sql"
export POSTGRES_PASSWORD_URLENCODED=REPLACE_WITH_PERCENT_ENCODED_ADMINISTRATOR_PASSWORD
export POSTGRES_MIGRATION_PASSWORD_URLENCODED=REPLACE_WITH_PERCENT_ENCODED_SCHEMA_MIGRATOR_PASSWORD
export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD_URLENCODED}@${PGHOST}:${PGPORT}/${POSTGRES_DB}"
export MIGRATION_DATABASE_URL="postgresql://xberg_schema_migrator:${POSTGRES_MIGRATION_PASSWORD_URLENCODED}@${PGHOST}:${PGPORT}/${POSTGRES_DB}"
export PRO_DB_BOOTSTRAP_MODE=standard
export PRO_DB_BOOTSTRAP_PHASE=all
export PRO_DB_INITIALIZE_SCHEMA=true
export PRO_DB_DEFER_CLAIMS_ENABLE=true
export SCHEMA_DIRECTORY="$CHART_DIR/charts/_distribution/files"
sh "$CHART_DIR/charts/_distribution/files/pro-db-bootstrap.sh"
```

The `*_URLENCODED` variables hold URL-safe encodings of the passwords, while the bootstrap password variables keep the raw values.

The command does the following:

- Creates eight login roles and the sealed broker topology.
- Grants the restricted role administrator exactly 21 broker functions.
- Installs the production schema and extensions.
- Prepares the dedicated planning database and its extensions.
- Transfers the production database to `xberg_role_broker`.
- Activates the vector-index broker contract.

The planning database is created while the administrator holds temporary, cleanup-guarded `SET` authority on `xberg_schema_owner`, which the bootstrap returns before activation. A closing census verifies that no login can inherit or set the root or broker role, and that `xberg_schema_owner` no longer has `CREATEDB`.

The bootstrap is recoverable after an interruption. Run the same command again with the same credentials, and it validates the produced topology and finishes any pending handoff or activation. The `cloudsql` mode value remains a compatibility alias for existing automation, so new installations use the default `standard` mode.

Store the chart's database URLs in the Secrets described in your product's install guide. Keep the schema-owner credential with the operator instead of placing it in Kubernetes. Never copy `POSTGRES_PASSWORD` or its URL into a Kubernetes Secret or workload.

## Install the chart

Keep these legacy-only values disabled for a fresh database:

```yaml
migrations:
  planningDatabaseBootstrap: false
  cloudSqlRoleBootstrap:
    enabled: false
  brokerTransitionDatabaseUrlSecret:
    name: ""
    key: ""
```

Then follow the normal configuration and install steps for your product: [Pro on Kubernetes](/start/pro-helm/) or [Enterprise on Kubernetes](/start/enterprise-helm/). The local bootstrap has already created the schema and activated the broker contract, so the normal migration hooks validate and reconcile it in one Helm install. The legacy two-run `cloudSqlRoleBootstrap` hook sequence does not apply.

After the product is Ready, rotate or remove the Cloud SQL administrator password from the operator environment. Cloud SQL records one unavoidable `ADMIN TRUE, INHERIT FALSE, SET FALSE` edge from that login to `xberg_role_root`. Bootstrap fails closed if the provider cannot preserve that exact edge, and the closing census rejects every inheritable or settable login path to the root or broker role.

## Rotate an application login

Provision the next Secret before you change a workload. Point `migrations.applicationDatabaseUrlSecret` at the next URL while `secrets.databaseUrlSecret` still selects the current URL. Run the hooks, switch the workload selector, and verify readiness before you delete the old credential.

## Existing Cloud SQL databases

`migrations.cloudSqlRoleBootstrap` exists only for the older, already-contracted ownership-transfer lifecycle. It expects an existing legacy owner, a separately provisioned disposable `xberg_role_bootstrap` login and an existing broker contract. It does not bootstrap a fresh database.

Legacy managed databases without the broker contract are unsupported. Do not set `migrations.brokerTransitionDatabaseUrlSecret` to bypass that refusal, because the legacy cutover needs an unrestricted PostgreSQL administrator identity that Cloud SQL does not provide. Contact support before you change such a database.
