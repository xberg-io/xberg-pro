---
title: Install Xberg Pro with Docker Compose
description: Run Xberg Pro as one container next to PostgreSQL on a single host, from license token to first API key.
sidebar:
  order: 1
---

Xberg Pro runs as one container that serves the REST API on port 8080, the bundled dashboard on port 3000 and Prometheus metrics on port 9090. PostgreSQL is the only other service. Documents and results go to local disk by default, or to S3, GCS or Azure Blob Storage.

Use this page for a single host: an evaluation, a proof of concept or a small production deployment. For Kubernetes, use [Install Xberg Pro with Helm](/start/pro-helm/).

The install has six steps. Each step ends with a check. Do not continue until the check passes.

1. [Get the install files](#1-get-the-install-files)
2. [Generate credentials](#2-generate-credentials)
3. [Write the Compose file](#3-write-the-compose-file)
4. [Start Pro](#4-start-pro)
5. [Check the license](#5-check-the-license)
6. [Create a project and an API key](#6-create-a-project-and-an-api-key)

## Prerequisites

- A Linux or macOS host with Docker Engine and the Compose plugin, plus `curl`, `jq` and OpenSSL.
- [Helm](https://helm.sh/docs/intro/install/) 3.8 or newer, used once to download the install files. It needs no cluster.
- Disk for the `/data` volume. Model and result caches take about 20 GiB of it, and accepted documents and results are retained with the corpus.
- A Pro license token from Xberg. Contact [contact@xberg.io](mailto:contact@xberg.io) if you do not have one. See [Licensing](/reference/licensing/).
- Internet access to `ghcr.io` and `us-central1-docker.pkg.dev`. Both are public and need no login. The container refuses to start without a valid license.

The Pro image is published for `linux/amd64` and `linux/arm64`.

## 1. Get the install files

You do not need access to any private repository. The Pro Helm chart is public, and its archive carries the database bootstrap script and SQL that the Compose stack mounts. The same chart release also names the image digest that matches those files.

Download the chart and look up the image. Set `VERSION` to the chart release you were given, or to the latest published release. The example uses `0.7.4`:

```shell
export VERSION=0.7.4
mkdir xberg-pro && cd xberg-pro
helm pull oci://us-central1-docker.pkg.dev/xberg-public-assets/helm-charts/pro \
  --version "$VERSION" --untar
export PRO_CHART_DIR="$PWD/pro"
helm show values "$PRO_CHART_DIR" | sed -n '/^image:/,/^imagePullSecrets:/p'
```

Set `PRO_IMAGE` to the `repository` and `digest` that the output shows:

```shell
export PRO_IMAGE="REPLACE_WITH_REPOSITORY@REPLACE_WITH_DIGEST"
```

Copy the bootstrap files into the working directory. The Compose file mounts `scripts/` as the bootstrap script directory and `sql/` as the schema directory:

```shell
mkdir -p scripts sql
cp "$PRO_CHART_DIR"/charts/_distribution/files/pro-db-bootstrap.sh scripts/
cp "$PRO_CHART_DIR"/charts/_distribution/files/*.sql sql/
```

The chart archive does not carry the small script that enables vector-index claims after the first start, because the Helm chart does that in a hook. Create it for Compose:

```shell
cat > scripts/pro-db-claims-enable.sh <<'SCRIPT'
#!/bin/sh
set -eu

physical_migration_role=xberg_physical_migration_login

: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${POSTGRES_PHYSICAL_MIGRATION_PASSWORD:?POSTGRES_PHYSICAL_MIGRATION_PASSWORD is required}"

PGPASSWORD="$POSTGRES_PHYSICAL_MIGRATION_PASSWORD" \
  PGOPTIONS='-c role=xberg_vector_index_activation_admin' \
  psql --set=ON_ERROR_STOP=1 --username "$physical_migration_role" --dbname "$POSTGRES_DB" <<'SQL'
SELECT to_regrole('xberg_vector_index_activation_admin') IS NOT NULL AS activation_role_exists
\gset
\if :activation_role_exists
  SELECT to_regprocedure(
    'vector_control.set_vector_index_ddl_worker_claims_enabled(boolean)'
  ) IS NOT NULL AS setter_exists
  \gset
  \if :setter_exists
    SELECT vector_control.set_vector_index_ddl_worker_claims_enabled(TRUE);
  \else
    DO $body$ BEGIN RAISE EXCEPTION 'vector index claims setter is missing'; END $body$;
  \endif
\else
  DO $body$ BEGIN RAISE EXCEPTION 'vector index activation role is missing'; END $body$;
\endif
SQL
SCRIPT
chmod +x scripts/*.sh
```

The script fails with a named error when the activation role or the setter function is missing, which means the bootstrap and the image come from different releases.

Always take the bootstrap files from the chart release that matches the image you run. Mixing versions fails the schema checks at startup.

**Check.** The directories hold the files, and the image pulls:

```shell
ls scripts
ls sql | wc -l
docker pull "$PRO_IMAGE"
```

`ls scripts` lists `pro-db-bootstrap.sh` and `pro-db-claims-enable.sh`. The SQL count is 40 or more. The pull ends with `Status: Downloaded` or `Image is up to date`.

## 2. Generate credentials

Pro uses nine distinct PostgreSQL logins, one per role, so a leaked application credential cannot alter the schema. Generate all passwords once, the control-plane key and the optional integration keys into a protected env file. Export `XBERG_LICENSE_KEY` (the token, without a trailing newline) first, then run the command in a subshell so that its options do not stay in your terminal:

```shell
export XBERG_LICENSE_KEY=REPLACE_WITH_LICENSE_TOKEN
(
  set -euC
  umask 077
  {
    for role in ADMIN APPLICATION MAINTENANCE INDEX_WORKER VECTOR_BROKER \
      MIGRATION SCHEMA_OWNER ROLE_ADMIN PHYSICAL_MIGRATION; do
      printf 'PRO_POSTGRES_%s_PASSWORD=%s\n' "$role" "$(openssl rand -hex 24)"
    done
    printf 'XBERG_ADMIN_KEY=kz_%s\n' "$(openssl rand -hex 24)"
    printf 'XBERG_LICENSE_KEY=%s\n' "$XBERG_LICENSE_KEY"
    printf 'PRO_IMAGE=%s\n' "$PRO_IMAGE"
    printf 'PRO_PULL_POLICY=missing\n'
    printf 'INTEGRATION_KEK=%s\n' "$(openssl rand -base64 32)"
    printf 'INTEGRATION_STATE_SECRET=%s\n' "$(openssl rand -base64 32)"
  } > .env.pro
)
```

The `set -C` option makes the command fail instead of overwriting an existing `.env.pro`. If the command fails part way, delete the partial file and run it again.

Keep this file and do not commit it. The nine passwords must stay the same across restarts, because the bootstrap service rotates the database roles to match them. `XBERG_ADMIN_KEY` cannot be recovered from the data volume.

`INTEGRATION_KEK` and `INTEGRATION_STATE_SECRET` enable the integration hub for [source connectors](/guides/source-connectors/). Set both or neither. Pro refuses to start with only one.

**Check.** The file holds nine passwords and the other values:

```shell
grep -c '^PRO_POSTGRES_.*_PASSWORD=' .env.pro
grep -c -E '^(XBERG_ADMIN_KEY|XBERG_LICENSE_KEY|PRO_IMAGE)=.+' .env.pro
```

The first command prints `9` and the second prints `3`.

## 3. Write the Compose file

Save this as `docker-compose.pro.yml`. It starts PostgreSQL with pgvector, runs the one-shot `db-bootstrap` service that creates roles and applies the schema, then starts Pro. The `db-claims-enable` service runs once after Pro is ready:

```yaml title="docker-compose.pro.yml"
services:
  postgres:
    image: pgvector/pgvector:pg18
    environment:
      POSTGRES_USER: xberg
      POSTGRES_PASSWORD: "${PRO_POSTGRES_ADMIN_PASSWORD:?Set PRO_POSTGRES_ADMIN_PASSWORD}"
      POSTGRES_DB: xberg
      POSTGRES_APPLICATION_PASSWORD: "${PRO_POSTGRES_APPLICATION_PASSWORD:?Set PRO_POSTGRES_APPLICATION_PASSWORD}"
      POSTGRES_MAINTENANCE_PASSWORD: "${PRO_POSTGRES_MAINTENANCE_PASSWORD:?Set PRO_POSTGRES_MAINTENANCE_PASSWORD}"
      POSTGRES_INDEX_WORKER_PASSWORD: "${PRO_POSTGRES_INDEX_WORKER_PASSWORD:?Set PRO_POSTGRES_INDEX_WORKER_PASSWORD}"
      POSTGRES_VECTOR_BROKER_PASSWORD: "${PRO_POSTGRES_VECTOR_BROKER_PASSWORD:?Set PRO_POSTGRES_VECTOR_BROKER_PASSWORD}"
      POSTGRES_MIGRATION_PASSWORD: "${PRO_POSTGRES_MIGRATION_PASSWORD:?Set PRO_POSTGRES_MIGRATION_PASSWORD}"
      POSTGRES_SCHEMA_OWNER_PASSWORD: "${PRO_POSTGRES_SCHEMA_OWNER_PASSWORD:?Set PRO_POSTGRES_SCHEMA_OWNER_PASSWORD}"
      POSTGRES_ROLE_ADMIN_PASSWORD: "${PRO_POSTGRES_ROLE_ADMIN_PASSWORD:?Set PRO_POSTGRES_ROLE_ADMIN_PASSWORD}"
      POSTGRES_PHYSICAL_MIGRATION_PASSWORD: "${PRO_POSTGRES_PHYSICAL_MIGRATION_PASSWORD:?Set PRO_POSTGRES_PHYSICAL_MIGRATION_PASSWORD}"
      PRO_DB_INITIALIZE_SCHEMA: "true"
      PRO_DB_DEFER_CLAIMS_ENABLE: "true"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U xberg -d xberg -h 127.0.0.1 -p 5432"]
      interval: 5s
      timeout: 3s
      retries: 15
    volumes:
      - ./scripts/pro-db-bootstrap.sh:/docker-entrypoint-initdb.d/00-pro-db-bootstrap.sh:ro
      - ./sql:/schema:ro
      - postgres-socket:/var/run/postgresql

  db-bootstrap:
    image: pgvector/pgvector:pg18
    user: postgres
    network_mode: none
    read_only: true
    tmpfs:
      - /tmp:rw,noexec,nosuid,nodev,size=16m
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
    depends_on:
      postgres:
        condition: service_healthy
    restart: "no"
    environment:
      PGHOST: /var/run/postgresql
      POSTGRES_USER: xberg
      POSTGRES_PASSWORD: "${PRO_POSTGRES_ADMIN_PASSWORD}"
      POSTGRES_DB: xberg
      POSTGRES_APPLICATION_PASSWORD: "${PRO_POSTGRES_APPLICATION_PASSWORD}"
      POSTGRES_MAINTENANCE_PASSWORD: "${PRO_POSTGRES_MAINTENANCE_PASSWORD}"
      POSTGRES_INDEX_WORKER_PASSWORD: "${PRO_POSTGRES_INDEX_WORKER_PASSWORD}"
      POSTGRES_VECTOR_BROKER_PASSWORD: "${PRO_POSTGRES_VECTOR_BROKER_PASSWORD}"
      POSTGRES_PHYSICAL_MIGRATION_PASSWORD: "${PRO_POSTGRES_PHYSICAL_MIGRATION_PASSWORD}"
      POSTGRES_SCHEMA_OWNER_PASSWORD: "${PRO_POSTGRES_SCHEMA_OWNER_PASSWORD}"
      POSTGRES_ROLE_ADMIN_PASSWORD: "${PRO_POSTGRES_ROLE_ADMIN_PASSWORD}"
      POSTGRES_MIGRATION_PASSWORD: "${PRO_POSTGRES_MIGRATION_PASSWORD}"
      PRO_DB_INITIALIZE_SCHEMA: "false"
      PRO_DB_DEFER_CLAIMS_ENABLE: "true"
    entrypoint: ["/bootstrap/pro-db-bootstrap.sh"]
    volumes:
      - ./scripts:/bootstrap:ro
      - ./sql:/schema:ro
      - postgres-socket:/var/run/postgresql

  pro:
    image: ${PRO_IMAGE:?Set PRO_IMAGE to the image digest from the chart}
    pull_policy: ${PRO_PULL_POLICY:-missing}
    stop_grace_period: "3720s"
    depends_on:
      db-bootstrap:
        condition: service_completed_successfully
    environment:
      DATABASE_URL: "postgres://xberg_app:${PRO_POSTGRES_APPLICATION_PASSWORD}@postgres:5432/xberg"
      MAINTENANCE_DATABASE_URL: "postgres://xberg_maintenance_login:${PRO_POSTGRES_MAINTENANCE_PASSWORD}@postgres:5432/xberg"
      VECTOR_INDEX_BROKER_DATABASE_URL: "postgres://xberg_vector_index_broker_login:${PRO_POSTGRES_VECTOR_BROKER_PASSWORD}@postgres:5432/xberg"
      VECTOR_INDEX_QUEUE_DATABASE_URL: "postgres://xberg_index_worker_login:${PRO_POSTGRES_INDEX_WORKER_PASSWORD}@postgres:5432/xberg"
      VECTOR_INDEX_WORKER_LOGIN: xberg_index_worker_login
      VECTOR_INDEX_MIGRATION_LOGIN: xberg_schema_migrator
      VECTOR_INDEX_BROKER_LOGIN: xberg_vector_index_broker_login
      VECTOR_INDEX_PHYSICAL_MIGRATION_LOGIN: xberg_physical_migration_login
      MAINTENANCE_DB_POOL_SIZE: "16"
      PRO_BIND_ADDR: 0.0.0.0:8080
      PRO_METRICS_ADDR: 0.0.0.0:9090
      LOG_LEVEL: info
      STORAGE_PROVIDER: fs
      STORAGE_BUCKET: xberg
      STORAGE_FS_ROOT: /data/xberg
      PRO_MAX_CONCURRENCY: "4"
      PRO_MAX_UPLOAD_BYTES: "104857600"
      PRO_SHUTDOWN_DRAIN_SECS: "30"
      SESSION_COOKIE_SECURE: "${SESSION_COOKIE_SECURE:-true}"
      CACHE_ENABLED: "true"
      CACHE_DIR: /data/xberg-cache
      CACHE_MAX_BYTES: "10737418240"
      CACHE_TTL_SECS: "604800"
      XBERG_VECTORSTORE_DEFAULT_INDEX_METHOD: hnsw
      HF_HOME: /data/hf
      XBERG_RAG_WARMUP_ENABLED: "false"
      XBERG_EMBEDDING_ENGINE_CACHE_MAX_RESIDENT: "2"
      XBERG_RERANKER_ENGINE_CACHE_MAX_RESIDENT: "2"
      INTEGRATION_KEK: "${INTEGRATION_KEK:-}"
      INTEGRATION_STATE_SECRET: "${INTEGRATION_STATE_SECRET:-}"
      PRO_INTEGRATION_SYNC_ENABLED: "${PRO_INTEGRATION_SYNC_ENABLED:-false}"
      PRO_INTEGRATION_SYNC_CURSOR_KEY: "${PRO_INTEGRATION_SYNC_CURSOR_KEY:-}"
      SFTP_HOST_ALLOWLIST: "${SFTP_HOST_ALLOWLIST:-}"
      PRO_AUTH_MODE: "${PRO_AUTH_MODE:-required}"
      XBERG_DATA_POLICY: "${XBERG_DATA_POLICY:-standard}"
      XBERG_ADMIN_KEY: "${XBERG_ADMIN_KEY:-}"
      XBERG_LICENSE_KEY: "${XBERG_LICENSE_KEY:-}"
    ports:
      - "127.0.0.1:${PRO_WEB_PORT:-3000}:3000"
      - "127.0.0.1:${PRO_HTTP_PORT:-8080}:8080"
      - "127.0.0.1:${PRO_METRICS_PORT:-9090}:9090"
    read_only: true
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
    tmpfs:
      - /tmp:rw,noexec,nosuid,nodev,size=64m
    volumes:
      - xberg-data:/data
    healthcheck:
      test:
        - CMD
        - node
        - -e
        - >-
          const urls = ['http://127.0.0.1:8080/readyz',
          'http://127.0.0.1:9091/readyz', 'http://127.0.0.1:9092/readyz'];
          Promise.all(urls.map((u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u + ' ' + r.status); })))
          .then(() => process.exit(0), (e) => { console.error(String(e)); process.exit(1); });
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 120s

  db-claims-enable:
    image: pgvector/pgvector:pg18
    user: postgres
    network_mode: none
    read_only: true
    tmpfs:
      - /tmp:rw,noexec,nosuid,nodev,size=16m
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
    depends_on:
      pro:
        condition: service_healthy
    restart: "no"
    environment:
      PGHOST: /var/run/postgresql
      POSTGRES_DB: xberg
      POSTGRES_PHYSICAL_MIGRATION_PASSWORD: "${PRO_POSTGRES_PHYSICAL_MIGRATION_PASSWORD}"
    entrypoint: ["/bootstrap/pro-db-claims-enable.sh"]
    volumes:
      - ./scripts:/bootstrap:ro
      - postgres-socket:/var/run/postgresql

volumes:
  xberg-data:
  postgres-socket:
```

Ports bind to the loopback address on purpose. A published Docker port bypasses the host firewall, so put a TLS reverse proxy in front of 8080 and 3000 before you expose Pro. The default `fs` storage provider writes to the `xberg-data` volume. To use object storage instead, see [Configuration](#configuration).

**Check.** Compose accepts the file and resolves every variable:

```shell
docker compose --env-file .env.pro -f docker-compose.pro.yml config --quiet && echo OK
```

The command prints `OK`. A message that starts with `required variable` names a value missing from `.env.pro`.

## 4. Start Pro

Start the stack and wait for the readiness check, then enable the vector-index claims that the bootstrap deferred. The second command runs once after every fresh `up`:

```shell
docker compose --env-file .env.pro -f docker-compose.pro.yml up --detach --wait pro
docker compose --env-file .env.pro -f docker-compose.pro.yml run --rm --no-deps db-claims-enable
```

On a new volume, the PostgreSQL init hook creates the roles and applies the schema before Pro starts. The first start also pulls the image and can take a few minutes.

For a plain-HTTP evaluation on one machine, add `SESSION_COOKIE_SECURE=false` to `.env.pro`. Keep the default `true` for any TLS deployment.

**Check.** The `pro` service is healthy and answers on its probes:

```shell
docker compose --env-file .env.pro -f docker-compose.pro.yml ps pro
curl --fail http://localhost:8080/healthz
curl --fail http://localhost:8080/readyz
curl --fail http://localhost:9090/metrics | head -n 5
```

`ps` shows `healthy`. `/healthz` reports that the process is alive. `/readyz` also checks PostgreSQL, the object store and the embedded vector-index worker, and answers `503` until each responds. Use `/readyz` for load-balancer and orchestrator checks.

If Pro does not become healthy, read the log:

```shell
docker compose --env-file .env.pro -f docker-compose.pro.yml logs pro | tail -n 30
```

## 5. Check the license

Pro verifies `XBERG_LICENSE_KEY` locally against the signing key baked into the image. No network call is involved, so air-gapped hosts are licensed the same way. Without a verifiable token Pro exits with code 78 and the Compose health check never passes.

**Check.** Read the license state with the admin key:

```shell
export XBERG_ADMIN_KEY=$(grep '^XBERG_ADMIN_KEY=' .env.pro | cut -d= -f2-)
curl --fail -H "Authorization: Bearer $XBERG_ADMIN_KEY" http://localhost:8080/v1/license
```

The response reports the licensee, plan, expiry, grace window and days remaining. See [Licensing](/reference/licensing/) for renewal and the grace period.

## 6. Create a project and an API key

Pro keeps work in projects, and API keys belong to a project. Use the admin key to create the first project:

```shell
export XBERG_URL=http://localhost:8080

export PROJECT_ID=$(curl -sX POST "$XBERG_URL/v1/projects" \
  -H "Authorization: Bearer $XBERG_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "Documents", "slug": "documents"}' | jq -r .id)
echo "$PROJECT_ID"
```

Then create a key for it:

```shell
export XBERG_API_KEY=$(curl -sX POST "$XBERG_URL/v1/projects/$PROJECT_ID/api-keys" \
  -H "Authorization: Bearer $XBERG_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "ingest-service"}' | jq -r .key)
```

The `key` field in the response is the full plaintext key and appears only once. Store it in your secret manager. See [Projects and API keys](/guides/projects-and-api-keys/) for scopes, expiry and quotas.

**Check.** The key authenticates against the data plane:

```shell
curl --fail -H "Authorization: Bearer $XBERG_API_KEY" "$XBERG_URL/v1/usage"
```

The response is a JSON usage report with `total_documents` set to `0`. Continue with the [quickstart](/start/quickstart/).

## Sign in to the dashboard

The dashboard listens on `http://localhost:3000`. Human sign-in needs an OpenID Connect (OIDC) identity provider. An API key cannot create a browser session. Choose one of three paths:

- **API only.** Skip the dashboard and call the REST API with `XBERG_ADMIN_KEY` or a project key. No identity provider is needed.
- **OIDC sign-in.** Register a public OIDC client with PKCE, then set `OIDC_ISSUER_URL`, `OIDC_AUDIENCE`, `JWT_SECRET`, the three `NEXT_PUBLIC_OIDC_*` values and an allowlist (`PRO_ALLOWED_EMAILS` or `PRO_ALLOWED_EMAIL_DOMAINS`). Set `PRO_ADMIN_EMAILS` to the people who manage the instance. No first user becomes admin automatically. [Pro configuration](/reference/pro-configuration/#dashboard-sign-in-with-oidc) lists every variable and gives a Compose override.
- **No authentication, evaluation only.** Add `PRO_AUTH_MODE=disabled` to `.env.pro` and recreate the stack. The UI and API then use a single persisted local workspace without login or API key. Anyone who can reach the service can use it, so restrict network access.

## Configuration

Compose sets the minimum Pro needs. Add other variables under the `pro` service's `environment:` block, and recreate the service with `up --detach pro`. The common ones:

| Variable                             | Purpose                                                                    |
| ------------------------------------ | -------------------------------------------------------------------------- |
| `STORAGE_PROVIDER`, `STORAGE_BUCKET` | `fs` (default), `s3`, `gcs` or `azure`, and the bucket or container name   |
| `PRO_PUBLIC_API_URL`                 | The externally reachable origin of the API. Required for presigned uploads |
| `CORS_ALLOWED_ORIGINS`               | Browser origins allowed to call the API. Empty sends no CORS headers       |
| `PRO_MAX_CONCURRENCY`                | Maximum concurrent extraction tasks                                        |
| `PRO_MAX_UPLOAD_BYTES`               | Request body limit. The default is 100 MiB                                 |
| `OTEL_EXPORTER_OTLP_ENDPOINT`        | Turns on OTLP export of traces, logs and metrics                           |
| `XBERG_PRO_CONFIG_FILE`              | Path of an optional TOML file, mounted into the container                  |

For S3 credentials, the AWS credential chain and the Azure and GCS settings, see [Pro configuration](/reference/pro-configuration/#storage-provider-specific) and [AWS storage](/operate/aws-storage/). The full variable list is in [Pro configuration](/reference/pro-configuration/).

## Upgrade

Pro stops while the packaged role and schema migrations run. The upgrade is a maintenance interval, not a rolling update. Plain `docker compose up` does not drain a running instance before the migration, so use this sequence:

1. Back up the PostgreSQL volume and the `xberg-data` volume. See [Backup and restore](/operate/backup-and-restore/).
2. Download the chart release for the new version as in [step 1](#1-get-the-install-files), then copy `pro-db-bootstrap.sh` and the `*.sql` files over the ones in `scripts/` and `sql/`.
3. Set `PRO_IMAGE` in `.env.pro` to the digest that release names, and pull it:

   ```shell
   docker compose --env-file .env.pro -f docker-compose.pro.yml pull pro
   ```

4. Stop Pro and wait for it to exit, which drains in-flight jobs:

   ```shell
   docker compose --env-file .env.pro -f docker-compose.pro.yml stop pro
   ```

5. Run the bootstrap again, start Pro and enable claims:

   ```shell
   docker compose --env-file .env.pro -f docker-compose.pro.yml run --rm db-bootstrap
   docker compose --env-file .env.pro -f docker-compose.pro.yml up --detach --wait pro
   docker compose --env-file .env.pro -f docker-compose.pro.yml run --rm --no-deps db-claims-enable
   ```

On an existing volume, `db-bootstrap` rotates the nine role passwords to the values in `.env.pro`, repairs role membership and rebuilds the grants. Keep all nine passwords stable between routine restarts, because changing one is a credential rotation. A bootstrap failure leaves Pro stopped. Fix the reported error and rerun the same step. Read the release notes for the target version first, and see [Upgrades](/operate/upgrades/) for the policy across versions.

Do not downgrade across a schema-ownership boundary by starting an older image. Contact [support](/more/support/) for a version-specific rollback plan.
