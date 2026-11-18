---
title: Install Xberg Pro with Helm
description: Deploy the singleton Xberg Pro StatefulSet on Kubernetes with your own pgvector-enabled PostgreSQL, from chart download to upgrade and rollback.
sidebar:
  order: 2
---

This guide installs the default singleton deployment: one Pro StatefulSet at one replica, backed by your own pgvector-enabled PostgreSQL database. For fixed replicas and red/green deployments, use the extraction-only profile and the [deployment operator](/operate/deployment-operator/).

The chart and the Pro image are public, so you need no access to any private repository or registry. The install has seven steps, and each ends with a check. Do not continue until the check passes.

1. [Download the chart](#download-the-chart)
2. [Prepare the database](#database-bootstrap)
3. [Create the Secrets](#secrets)
4. [Configure the values](#configuration)
5. [Install the chart](#install)
6. [Verify the deployment](#verification)
7. [Create a project and an API key](#create-a-project-and-an-api-key)

## Prerequisites

- Helm 4, `kubectl`, `curl` and `jq` on the machine that runs the install. Choose Kubernetes using [Helm's support matrix](https://helm.sh/docs/topics/version_skew/); the cluster must run Kubernetes 1.29 or newer, and its nodes must be `amd64` or `arm64`.
- PostgreSQL 15 to 18 with the pgvector (`vector`) extension, version 0.8.0 or newer, available. The machine that runs the install must reach it.
- `psql` and the GNU `timeout` command on that machine, for the database bootstrap.
- A Pro license token and a commercial license to run the Pro image. See [Licensing](/reference/licensing/). Contact [contact@xberg.io](mailto:contact@xberg.io) if you do not have them.
- Cluster nodes that can pull `ghcr.io/xberg-io/xberg-pro` anonymously, or an authorized mirror.
- An ingress controller if you expose Pro externally. Use at most one of `ingress`, `gke.ingress` or `istio`.

## Download the chart

Use an empty working directory. The public chart needs no registry login. Public availability does not grant an open-source license: the archive's `LICENSE` and your commercial agreement apply.

Set `VERSION` to the chart release you were given, or to the latest published release. The example uses `0.7.4`:

```shell
export VERSION=0.7.4
export PRO_CHART="oci://us-central1-docker.pkg.dev/xberg-public-assets/helm-charts/pro"
helm pull "$PRO_CHART" --version "$VERSION" --untar
export PRO_CHART_DIR="$PWD/pro"
cp "$PRO_CHART_DIR/charts/_distribution/examples/values.yaml" pro-values.yaml
export PRO_VALUES_FILE="$PWD/pro-values.yaml"
```

If you received a chart archive directly, extract it with `tar -xzf pro-$VERSION.tgz` in the working directory and set `PRO_CHART_DIR` to the extracted `pro` directory. Every later command uses `$PRO_CHART_DIR`.

The extracted chart holds three things you use during the install:

| Path                                            | Content                                             |
| ----------------------------------------------- | --------------------------------------------------- |
| `$PRO_CHART_DIR/charts/_distribution/files/`    | The database bootstrap scripts and the complete SQL |
| `$PRO_CHART_DIR/charts/_distribution/examples/` | The example values file                             |
| `$PRO_CHART_DIR/values.yaml`                    | Every value the chart accepts, with comments        |

Keep the extracted chart for bootstrap, configuration, installation and upgrades. Use the bootstrap files from the same chart version you install. Do not download another version during an installation.

The released chart pins the Pro image to an exact digest, and the example values inherit it. Every chart-managed container, including database Jobs and `helm test`, uses that image. Nodes pull it anonymously from GHCR, so `imagePullSecrets` stays empty. If you use a private mirror, copy the image, set both `image.repository` and `image.digest` from the copied artifact, and configure node identity, a kubelet credential provider or a registry Secret for the mirror. Mirror the migration artifact image (`migrations.artifactImage`) too when nodes cannot reach the public registry. Do not invent a version tag.

**Check.** The chart renders its metadata and the files exist:

```shell
helm show chart "$PRO_CHART_DIR" | grep -E '^(name|version):'
test -f "$PRO_CHART_DIR/charts/_distribution/files/pro-db-bootstrap.sh" && echo OK
test -f "$PRO_VALUES_FILE" && echo OK
```

The chart reports `name: pro` and the version you set. Both `test` commands print `OK`.

## Example values

This is the example values file. You copied it as `pro-values.yaml`. Replace the hostnames, OIDC settings, administrator addresses, TLS Secret and PostgreSQL CIDR with your own:

```yaml title="pro-values.yaml"
imagePullSecrets: []

secrets:
  name: xberg-pro-secrets

maintenance:
  databaseUrlSecret:
    name: xberg-pro-secrets
    key: MAINTENANCE_DATABASE_URL

vectorIndexWorker:
  databaseUrlSecret:
    name: xberg-pro-vector-index-worker
    key: DATABASE_URL
  brokerDatabaseUrlSecret:
    name: xberg-pro-vector-index-broker
    key: DATABASE_URL
  physicalMigrationDatabaseUrlSecret:
    name: xberg-pro-vector-index-physical-migration
    key: DATABASE_URL

migrations:
  planningDatabaseBootstrap: false
  databaseUrlSecret:
    name: xberg-pro-schema-migrator
    key: DATABASE_URL
  roleAdminDatabaseUrlSecret:
    name: xberg-pro-role-admin
    key: ROLE_ADMIN_DATABASE_URL

configMap:
  FRONTEND_BASE_URL: https://pro.example.com
  PRO_PUBLIC_API_URL: https://pro.example.com
  OAUTH_CALLBACK_BASE_URL: https://pro.example.com
  OIDC_ISSUER_URL: https://issuer.example.com
  OIDC_AUDIENCE: xberg-pro
  OIDC_JWKS_URI: https://issuer.example.com/.well-known/jwks.json
  NEXT_PUBLIC_OIDC_ISSUER_URL: https://issuer.example.com
  NEXT_PUBLIC_OIDC_CLIENT_ID: xberg-dashboard
  NEXT_PUBLIC_OIDC_REDIRECT_URI: https://pro.example.com/auth/callback
  PRO_ALLOWED_EMAIL_DOMAINS: example.com
  PRO_ADMIN_EMAILS: admin@example.com

ingress:
  enabled: true
  className: nginx
  hosts:
    - pro.example.com
  tls:
    - secretName: pro-tls
      hosts:
        - pro.example.com

networkPolicy:
  enabled: true
  ingressControllerNamespace: ingress-nginx
  postgresCidrs:
    - 10.20.0.0/24

persistence:
  claimTemplateMode: fresh
```

`persistence.claimTemplateMode: fresh` fits a new release. GitOps reconciliation must use `existing` and the installed request; see [Persistent volume](#persistent-volume).

## Database bootstrap

Use a dedicated PostgreSQL server or cluster for each independently administered Xberg deployment. Separate databases or custom login names do not isolate the fixed Xberg capability roles. Do not install independent Pro and Enterprise releases on the same PostgreSQL server, because migrations and rollbacks change shared role memberships. A separate PostgreSQL instance is enough; a separate Kubernetes cluster is not required.

For every fresh PostgreSQL installation, create an empty target database and run the bootstrap once as its PostgreSQL administrator. The bootstrap creates the capability roles, the eight runtime logins and the schema.

`PRO_DB_BOOTSTRAP_MODE=standard` works on every provider and needs no superuser authority. For a restricted administrator it selects the managed-PostgreSQL path automatically. AWS RDS and Google Cloud SQL use this same command. The restricted path needs:

- PostgreSQL 16 or newer.
- An administrator login with direct `CREATEROLE`, `CREATEDB` and `CREATE` on the target database, and without `BYPASSRLS` or `REPLICATION`.
- The ability to create the `uuid-ossp`, `pgcrypto`, `btree_gin` and `vector` extensions, or a provider that preinstalls them with routines the administrator can transfer. Check extension availability for your engine version. The bootstrap fails before it creates Xberg roles when it cannot prepare the extensions.

For AWS RDS, set `PGHOST` to the RDS endpoint and `POSTGRES_USER` to the instance master user. For Cloud SQL, set them to the Auth Proxy endpoint and the database administrator; see [Cloud SQL](/operate/cloud-sql/). For RDS runtime connections, combine AWS's RDS CA bundle with the Pro image's public roots and mount it with `SSL_CERT_FILE`.

Set the connection details and the eight role passwords, then run the bootstrap. Generate each password as a distinct random value and store it in your secret manager:

```shell
export PGHOST=postgres.example.com
export PGPORT=5432
export POSTGRES_DB=xberg
export POSTGRES_USER=postgres_admin
export POSTGRES_PASSWORD=REPLACE_WITH_ADMINISTRATOR_PASSWORD
export PGPASSWORD="$POSTGRES_PASSWORD"
export POSTGRES_APPLICATION_PASSWORD=REPLACE_WITH_APPLICATION_PASSWORD
export POSTGRES_MAINTENANCE_PASSWORD=REPLACE_WITH_MAINTENANCE_PASSWORD
export POSTGRES_SCHEMA_OWNER_PASSWORD=REPLACE_WITH_SCHEMA_OWNER_PASSWORD
export POSTGRES_MIGRATION_PASSWORD=REPLACE_WITH_SCHEMA_MIGRATOR_PASSWORD
export POSTGRES_ROLE_ADMIN_PASSWORD=REPLACE_WITH_ROLE_ADMIN_PASSWORD
export POSTGRES_INDEX_WORKER_PASSWORD=REPLACE_WITH_VECTOR_INDEX_WORKER_PASSWORD
export POSTGRES_VECTOR_BROKER_PASSWORD=REPLACE_WITH_VECTOR_BROKER_PASSWORD
export POSTGRES_PHYSICAL_MIGRATION_PASSWORD=REPLACE_WITH_PHYSICAL_MIGRATION_PASSWORD
export PRO_DB_BOOTSTRAP_MODE=standard
export PRO_DB_BOOTSTRAP_PHASE=all
export PRO_DB_INITIALIZE_SCHEMA=true
export PRO_DB_DEFER_CLAIMS_ENABLE=true
export MIGRATION_PLAN_DATABASE=xberg_schema_plan
export PLANNING_DATABASE_BOOTSTRAP=true
export PLANNING_EXTENSIONS_FILE="$PRO_CHART_DIR/charts/_distribution/files/extensions-prepare.sql"
export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${PGHOST}:${PGPORT}/${POSTGRES_DB}"
export MIGRATION_DATABASE_URL="postgresql://xberg_schema_migrator:${POSTGRES_MIGRATION_PASSWORD}@${PGHOST}:${PGPORT}/${POSTGRES_DB}"
export SCHEMA_DIRECTORY="$PRO_CHART_DIR/charts/_distribution/files"
sh "$PRO_CHART_DIR/charts/_distribution/files/pro-db-bootstrap.sh"
sh "$PRO_CHART_DIR/charts/_distribution/files/prepare-schema-planning-database.sh"
```

The bootstrap also creates the separate planning database named in `MIGRATION_PLAN_DATABASE`, which Helm uses to compute schema changes. On managed PostgreSQL it creates that database while a temporary, cleanup-guarded authority is active and removes the authority before it finishes. The last command validates the result, and on self-managed PostgreSQL it creates the database.

Run this procedure on an empty database only. If it was interrupted, rerun the same command with the same administrator and role credentials. It validates the recorded role graph and schema layout, then resumes without recreating existing tables or data. Unknown or incomplete schemas and unexpected ownership or grants are rejected before any repair. For an established installation, use [Upgrade and rollback](#upgrade-and-rollback) instead of initialization.

Never give administrator, schema-owner or physical-migration credentials to runtime pods. The role-admin Secret holds the restricted `xberg_role_admin` login, and the ownership SQL refuses a superuser.

**Check.** Both scripts finish without an error message, and the application login connects:

```shell
PGPASSWORD="$POSTGRES_APPLICATION_PASSWORD" \
  psql -h "$PGHOST" -p "$PGPORT" -U xberg_app -d "$POSTGRES_DB" -c 'SELECT current_user'
```

`psql` prints `xberg_app`. If a script fails, read its last message. It names the missing capability or extension.

## Secrets

Create the namespace and the seven Secrets that the example values reference. Percent-encode passwords inside database URLs, and replace every placeholder with the value it names. Run the snippet in Bash or Zsh:

```bash
kubectl create namespace xberg-pro
database_suffix='@postgres.example.com:5432/xberg'
application_url="postgresql://xberg_app:REPLACE_APPLICATION_PASSWORD${database_suffix}"
maintenance_url="postgresql://xberg_maintenance_login:REPLACE_MAINTENANCE_PASSWORD${database_suffix}"
migration_url="postgresql://xberg_schema_migrator:REPLACE_SCHEMA_MIGRATOR_PASSWORD${database_suffix}"
role_admin_url="postgresql://xberg_role_admin:REPLACE_WITH_ROLE_ADMIN_PASSWORD${database_suffix}"
worker_url="postgresql://xberg_index_worker_login:REPLACE_VECTOR_INDEX_WORKER_PASSWORD${database_suffix}"
broker_url="postgresql://xberg_vector_index_broker_login:REPLACE_VECTOR_BROKER_PASSWORD${database_suffix}"
physical_url="postgresql://xberg_physical_migration_login:REPLACE_PHYSICAL_MIGRATION_PASSWORD${database_suffix}"
license_file='REPLACE_WITH_LICENSE_FILE_PATH'
kubectl -n xberg-pro create secret generic xberg-pro-secrets \
  --from-literal=DATABASE_URL="$application_url" \
  --from-literal=MAINTENANCE_DATABASE_URL="$maintenance_url" \
  --from-literal=JWT_SECRET='REPLACE_WITH_RANDOM_SESSION_SECRET' \
  --from-literal=XBERG_ADMIN_KEY='REPLACE_WITH_RANDOM_ADMIN_API_KEY' \
  --from-file=XBERG_LICENSE_KEY=<(tr -d '\r\n' < "$license_file")
kubectl -n xberg-pro create secret generic xberg-pro-schema-migrator \
  --from-literal=DATABASE_URL="$migration_url"
kubectl -n xberg-pro create secret generic xberg-pro-role-admin \
  --from-literal=ROLE_ADMIN_DATABASE_URL="$role_admin_url"
kubectl -n xberg-pro create secret generic xberg-pro-vector-index-worker \
  --from-literal=DATABASE_URL="$worker_url"
kubectl -n xberg-pro create secret generic xberg-pro-vector-index-broker \
  --from-literal=DATABASE_URL="$broker_url"
kubectl -n xberg-pro create secret generic xberg-pro-vector-index-physical-migration \
  --from-literal=DATABASE_URL="$physical_url"
kubectl -n xberg-pro create secret tls pro-tls \
  --cert=REPLACE_WITH_CERTIFICATE_PATH --key=REPLACE_WITH_PRIVATE_KEY_PATH
```

The license-file substitution removes CR and LF bytes that text files may end with. Pro requires the exact token without a trailing newline, and the token never appears in a command argument. Remember `XBERG_ADMIN_KEY`: you use it in [the last step](#create-a-project-and-an-api-key).

The TLS Secret is unnecessary when `ingress.enabled=false` or your ingress controller issues the certificate.

For OAuth integrations, add both `INTEGRATION_KEK` and `INTEGRATION_STATE_SECRET` to `xberg-pro-secrets`. Each must be the base64 encoding of 32 random bytes. Pro refuses a configuration that contains only one of them.

**Check.** All seven Secrets exist:

```shell
kubectl -n xberg-pro get secrets
```

The list shows `xberg-pro-secrets`, `xberg-pro-schema-migrator`, `xberg-pro-role-admin`, `xberg-pro-vector-index-worker`, `xberg-pro-vector-index-broker`, `xberg-pro-vector-index-physical-migration` and `pro-tls`.

## Configuration

Edit `$PRO_VALUES_FILE`. Replace the public hostname, OIDC settings, administrator addresses, TLS Secret name and PostgreSQL CIDR. The example names every Secret the chart reads, so keep its Secret keys complete.

OIDC needs two sets of keys. Pro verifies tokens with `OIDC_ISSUER_URL`, `OIDC_AUDIENCE` and `OIDC_JWKS_URI`. The dashboard starts the sign-in in the browser with `NEXT_PUBLIC_OIDC_ISSUER_URL`, `NEXT_PUBLIC_OIDC_CLIENT_ID` and `NEXT_PUBLIC_OIDC_REDIRECT_URI`. With only the first set, Pro accepts tokens but the sign-in page refuses to start.

### Network policies

With `networkPolicy.enabled: true`, the chart restricts pod traffic:

- For PostgreSQL in the same cluster, set `networkPolicy.postgresNamespace` to its namespace and remove `networkPolicy.postgresCidrs`.
- For PostgreSQL outside the cluster, set `networkPolicy.postgresCidrs` to its reachable CIDRs.
- Add other destinations, such as a private object store, under `networkPolicy.extraEgress`.
- Crawling and webhook delivery reach the public web on the ports in `networkPolicy.publicEgressPorts`, which holds 80 and 443. A crawl seed or webhook receiver on any other port needs its own `extraEgress` rule, or the request times out with no message that names the policy.
- Set `configMap.OTEL_EXPORTER_OTLP_ENDPOINT` only for an in-cluster collector, then set `networkPolicy.otlpNamespace` and `networkPolicy.otlpPort` to match it. Admit an external collector through `extraEgress`.

### Authentication

To turn authentication off for an evaluation, set `configMap.PRO_AUTH_MODE: "disabled"`. The UI and API then use a persisted local workspace without OAuth, login or an API key. Omit `JWT_SECRET` and `XBERG_ADMIN_KEY` from the runtime Secret and clear the OIDC values. The database Secrets stay required. Anyone who can reach the service can use this workspace, so restrict network access. The default is `required`.

### Storage

The default filesystem storage uses the `/data` volume. For object storage, set `configMap.STORAGE_PROVIDER` and `configMap.STORAGE_BUCKET`:

- GCS supports workload identity.
- S3 uses the default AWS credential chain, including EKS Pod Identity and IRSA; see [AWS storage](/operate/aws-storage/). For explicit credentials, set `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` together in `xberg-pro-secrets`, plus `S3_SESSION_TOKEN` for temporary credentials.
- For Azure, add `AZURE_STORAGE_ACCOUNT` and `AZURE_STORAGE_ACCESS_KEY` to that Secret.

Keep `configMap.PRO_PUBLIC_API_URL` set to the externally reachable HTTP(S) origin for every storage provider. Upload capabilities are one-use PUT URLs on Pro, and an unset origin makes presign return `503`. Route `/v1/uploads/local` directly to Pro and allow request bodies up to `PRO_MAX_UPLOAD_BYTES` at your ingress. The included standard, GKE and Istio routes do this. A customer-managed proxy needs the same rule.

Pro keeps minimal cleanup records for uploads whose writers cannot be confirmed finished. Monitor `pro_upload_retained_unknown_writers` and `pro_upload_oldest_unknown_writer_age_seconds` on `/metrics`. Both are gauges without project labels. The count can stay above zero after an upgrade. Investigate sustained growth, or an age beyond what you expect, for writer disconnects and cleanup failures. Do not delete these records or treat URL expiry or lifecycle rules as proof that a writer finished.

### Persistent volume

The default 100 GiB claim reserves about 20 GiB for model and result caches, including the 10 GiB `configMap.CACHE_MAX_BYTES` ceiling. Accepted documents and results are retained with the corpus, and upload cleanup only removes expired staging data. Set `persistence.size` above 100 GiB when the corpus needs more than the remaining 80 GiB or so.

`persistence.size` applies to fresh claims only. Kubernetes does not resize an existing claim when you change this value, and the StatefulSet claim template is immutable. Set `persistence.claimTemplateMode: fresh` only while creating a release. A live `helm upgrade` preserves the installed claim template automatically.

Argo CD, GitOps and other renderers that cannot read the cluster cannot see the installed template. Use `fresh` for the initial sync. Before the next sync, capture the installed template as a values file and include that file in every later render:

```shell
export RELEASE=xberg-pro
export NAMESPACE=xberg-pro
kubectl -n "$NAMESPACE" get statefulset \
  -l "app.kubernetes.io/name=pro,app.kubernetes.io/instance=$RELEASE" -o json |
  jq -e '
    [.items[].spec.volumeClaimTemplates[] | select(.metadata.name == "data")] |
    if length != 1 then error("exactly one installed data template is required") else
    {persistence: {claimTemplateMode: "existing", existingClaimTemplate: {
      metadata: .[0].metadata,
      spec: .[0].spec
    }}} end' > pro-existing-claim.json
```

Keep this captured template unchanged, even after you expand the claim. The optional `persistence.existingClaimTemplateSize` must match the captured request. Do not delete the StatefulSet or the claim to bypass an immutable-template error. To grow the volume, expand the claim directly:

```shell
export RELEASE=xberg-pro
export NAMESPACE=xberg-pro
STATEFULSET="$(kubectl -n "$NAMESPACE" get statefulset \
  -l "app.kubernetes.io/name=pro,app.kubernetes.io/instance=$RELEASE" \
  -o jsonpath='{.items[0].metadata.name}')"
test -n "$STATEFULSET"
DATA_PVC="data-${STATEFULSET}-0"
STORAGE_CLASS="$(kubectl -n "$NAMESPACE" get pvc "$DATA_PVC" -o jsonpath='{.spec.storageClassName}')"
test "$(kubectl get storageclass "$STORAGE_CLASS" -o jsonpath='{.allowVolumeExpansion}')" = true
kubectl -n "$NAMESPACE" patch pvc "$DATA_PVC" --type merge \
  -p '{"spec":{"resources":{"requests":{"storage":"200Gi"}}}}'
kubectl -n "$NAMESPACE" wait pvc "$DATA_PVC" \
  --for=jsonpath='{.status.capacity.storage}'=200Gi --timeout=10m
```

Replace `200Gi` with the new size. When `allowVolumeExpansion` is not `true`, follow your storage provider's data migration procedure to a larger claim. Do not delete the existing claim.

### Memory

The chart requests 16 GiB of memory and limits it to 24 GiB, which fits `PRO_MAX_CONCURRENCY` of 4 with the RAG models loaded. Size `resources.limits.memory` from the models you use and the number of concurrent documents. Large multi-page documents can use around 1 GiB of working memory each, on top of the models. `PRO_ENGINE_MAX_THREADS` sets the shared extraction thread budget, and peak memory grows with it on multi-page scans. Raise the memory limit when you raise it. See [Pro configuration](/reference/pro-configuration/#tuning).

Pro keeps two embedding engines and two reranker engines resident by default. Raise `configMap.XBERG_EMBEDDING_ENGINE_CACHE_MAX_RESIDENT` and `configMap.XBERG_RERANKER_ENGINE_CACHE_MAX_RESIDENT` to retain more. Eviction is least recently used, and an active request can keep an evicted engine alive until it finishes, so the count is not a hard memory ceiling. Set each bound at least as high as the number of collection presets used at the same time, or alternating requests rebuild engines after eviction. Recurring RAG warmup is off by default, because warming more presets than the bound would rebuild and evict them every 15 minutes.

### Migration safety flags

Keep `migrations.allowDestructive`, `migrations.allowLocking` and `migrations.allowDataRepair` set to `false` unless a reviewed, coordinated schema change or data repair needs them. The extracted `$PRO_CHART_DIR/values.yaml` lists the complete value surface, and [Pro configuration](/reference/pro-configuration/) lists every environment variable.

**Check.** The values render without errors:

```shell
helm lint --strict "$PRO_CHART_DIR" -f "$PRO_VALUES_FILE"
helm template xberg-pro "$PRO_CHART_DIR" -n xberg-pro -f "$PRO_VALUES_FILE" >/dev/null && echo OK
```

`helm lint` reports `0 chart(s) failed`, and the second command prints `OK`. An error that names a missing Secret or value tells you which entry to fix.

## Install

Install the chart. The command waits for the migration hooks and the StatefulSet to finish, and allows 20 minutes:

```shell
helm install xberg-pro "$PRO_CHART_DIR" \
  -n xberg-pro -f "$PRO_VALUES_FILE" \
  --wait --timeout 20m
```

**Check.** Helm reports the release as deployed:

```shell
helm status xberg-pro -n xberg-pro | grep -E '^STATUS'
```

The output is `STATUS: deployed`. If the install stops with `Job Failed` for a migration hook, see [Troubleshooting](#troubleshooting).

## Verification

Wait for the rollout, run the chart tests and forward the service ports:

```shell
kubectl -n xberg-pro rollout status statefulset/xberg-pro --timeout=10m
kubectl -n xberg-pro get pods,services,ingresses
helm test xberg-pro -n xberg-pro --logs
kubectl -n xberg-pro port-forward service/xberg-pro 8080:8080 3000:3000
```

In a second terminal, while the port-forward runs:

```shell
curl --fail http://127.0.0.1:8080/healthz
curl --fail http://127.0.0.1:8080/readyz
```

`/healthz` proves the process is alive. `/readyz` also verifies the database identities and the object store. `helm test` ends with `Phase: Succeeded`. Open `http://127.0.0.1:3000` to check that the dashboard sign-in page loads. OIDC sign-in needs the configured public origin and the registered redirect URI, so use the public URL for an authenticated test.

## Create a project and an API key

Pro keeps work in projects, and API keys belong to a project. With the port-forward still running, use the `XBERG_ADMIN_KEY` you put in `xberg-pro-secrets`:

```shell
export XBERG_URL=http://127.0.0.1:8080
export XBERG_ADMIN_KEY=REPLACE_WITH_THE_ADMIN_KEY_FROM_THE_SECRET

export PROJECT_ID=$(curl -sX POST "$XBERG_URL/v1/projects" \
  -H "Authorization: Bearer $XBERG_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "Documents", "slug": "documents"}' | jq -r .id)

export XBERG_API_KEY=$(curl -sX POST "$XBERG_URL/v1/projects/$PROJECT_ID/api-keys" \
  -H "Authorization: Bearer $XBERG_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "ingest-service"}' | jq -r .key)
```

The `key` field is the full plaintext key and appears only once. Store it in your secret manager. See [Projects and API keys](/guides/projects-and-api-keys/).

**Check.** The key authenticates:

```shell
curl --fail -H "Authorization: Bearer $XBERG_API_KEY" "$XBERG_URL/v1/usage"
```

The response is a JSON usage report. Continue with the [quickstart](/start/quickstart/).

## Troubleshooting

When `helm install` or `helm upgrade` stops with `Job Failed` for a migration hook, read the hook's pod first:

```shell
kubectl -n xberg-pro describe pod -l job-name=xberg-pro-topology-guard
kubectl -n xberg-pro get events --sort-by=.lastTimestamp | grep -i -E 'pull|deadline'
```

An image pull failure is the first cause to check. The pod shows `ImagePullBackOff` with the image name, and the events carry the registry response, for example `401 Unauthorized`. Confirm the image reference and anonymous pull access for the public defaults. For a private mirror, configure its credentials in `imagePullSecrets` and run the install again. The first hook, the topology guard, pulls the same Pro image as the StatefulSet, so a pull failure stops it within two minutes and leaves the failed pod for inspection. For another hook, replace the `job-name` label value with the Job name from the Helm message.

## Run Pro with multiple replicas

Use `deployment.mode=replicated` for extraction-only Pro with 2 to 32 replicas per generation, on distinct nodes. A replicated generation needs:

- An external PostgreSQL service and a shared AWS S3, Google Cloud Storage or Azure Blob namespace.
- Required API authentication, `dataPolicy=extraction_only`, and Pro RAG and Auto-Tune disabled.
- `persistence.enabled=false` and `migrations.enabled=false` on the generation releases. Plan database maintenance separately, at installation scope.
- A customer-managed layer-7 upstream whose connection draining you verified, before you set `deployment.traffic.connectionDrainingConfirmed=true`.

On native Kubernetes, set `deployment.adapter=native` and install each immutable generation as its own Helm release, with the registered installation and generation IDs, the storage namespace identity and the configuration and policy digests. Pin the platform image manifest and match its architecture in `nodeSelector`. With a separately installed Argo Rollouts controller, set `deployment.adapter=argo-rollouts` and `deployment.argo.publishOnly=true` to publish the desired generation, and the installation operator creates the Rollout and manages the public Service.

Register the installation, qualify cross-Pod storage, admit the generation and verify serving readiness with the [deployment operator](/operate/deployment-operator/) before you route traffic. An existing filesystem-backed singleton stays a singleton on upgrade. Plan a separate move to shared storage and a verified Service handoff before you route traffic to a replicated generation. Replicated qualification excludes PVC-backed models and arbitrary sidecar or service-account token injection. EKS Pod Identity and IRSA credentials work through the AWS storage profile.

## Clean up abandoned S3 inputs

On a replicated generation that uses the installation's registered, versioned AWS S3 namespace, Pro can delete extraction inputs that were uploaded but never attached to a job. The cleanup is off. To enable it:

1. Upgrade the schema and every application and maintenance binary that can start against the installation, rollback candidates included. Older binaries reject the expanded maintenance privileges.
2. With the cleanup still disabled, set `migrations.inputS3CleanupGrants: grant` for one maintenance release. For a database you manage yourself, run the maintenance grant phase with `PRO_INPUT_S3_CLEANUP_GRANTS=grant`. Then return the chart value to `verify`.
3. Give the runtime identity `s3:DeleteObjectVersion` on the installation's `documents/` prefix under the storage root.
4. Set `configMap.PRO_INPUT_S3_CLEANUP_ENABLED: "true"` on the admitted generation. Pro refuses to start with the cleanup enabled when the maintenance login lacks the grants.

Before you roll back to an older binary, disable the cleanup, let it drain, run the maintenance grant phase with `migrations.inputS3CleanupGrants: revoke` (or `PRO_INPUT_S3_CLEANUP_GRANTS=revoke`) and confirm that the grants are gone.

A failed or interrupted delete keeps the staging credit held for a later retry. Track progress on the metrics endpoint. Each replica reports its own events:

| Metric                                                                  | Meaning                                                                                            |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `pro_abandoned_s3_input_cleanup_candidate_events_total`                 | Candidate events by outcome: `started`, `acknowledged`, `not_authorized`, `unconfirmed`, `failed`. |
| `pro_abandoned_s3_input_cleanup_sweep_events_total`                     | Discovery sweeps: `completed`, `not_authorized`, `failed`.                                         |
| `pro_abandoned_s3_input_cleanup_last_completed_sweep_timestamp_seconds` | When an authorized replica last finished a scan. Absent until the first sweep completes.           |

A completed sweep does not mean every delete finished, so read the sweep timestamp next to the candidate outcomes. A preview or fenced replica can report `not_authorized` while another replica keeps processing. For the database-side census and reconciliation procedures, contact [support](/more/support/).

## Private MCP listener

The chart can start a private MCP listener on loopback for local clients. It is off by default. See [Private MCP listener](/guides/mcp/).

## Migration modes

`migrations.mode` defaults to `maintenance`, which quiesces the workload and runs the role-contract and restoration hooks around each schema change. `online` renders one restricted schema runner instead. It does not stop workloads, change login privileges or disable vector-index claims, and it cannot bootstrap databases, transfer ownership, repair data or cross a rollback boundary. Online mode currently accepts only a converged no-op. A nonempty plan needs a release-shipped certificate, and no Helm value bypasses certification, so an uncertified upgrade fails before it changes the database. Use the maintenance procedure for those upgrades. Online planner URLs must be plain `postgres://user:password@host:port/database` URIs with an optional `sslmode` parameter.

When an installation already has a fleet control record, maintenance requires an explicit `migrations.maintenanceOperationId` (a UUID) and a `migrations.maintenanceExpectedEpoch` that matches the observed control epoch. The first maintenance hook fences the fleet before it quiesces anything, and successful completion clears only that operation. A failed operation keeps its fence until you recover it, and a different operation cannot take over implicitly. A database without a control record can use maintenance for initial bootstrap, and online mode refuses it. Migration hooks require the `READ COMMITTED` transaction default and reject any other before they wait for the schema lock.

Some installs need a one-time SQL supplement from `$PRO_CHART_DIR/charts/_distribution/files`, run before the chart upgrade by the administrator that ran the restricted bootstrap (on RDS, the instance master user):

- **Deployment controller roles.** Every install bootstrapped before chart 0.5.0, including an upgrade from 0.4.x, needs `deployment-controller-roles-bootstrap.sql`. Without it, the migration stops with `role "xberg_deployment_owner" does not exist`. PostgreSQL 15 receives only placeholder roles, and the deployment controller needs PostgreSQL 16 or newer.

  ```bash
  cd "$PRO_CHART_DIR/charts/_distribution/files"
  psql -X -v ON_ERROR_STOP=1 -h "$PGHOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    --file=deployment-controller-roles-bootstrap.sql
  ```

  A rerun changes nothing, and any other login is refused. Do not grant the root role `CREATEROLE` or a `SET` edge by hand.

- **Maintenance recovery role.** A restricted install bootstrapped before the recovery role existed needs `maintenance-recovery-role-bootstrap.sql`, run with `--set=role_admin_login=xberg_role_admin`. It creates `xberg_maintenance_recovery` and the two functions that grant and revoke it. Until it runs, the chart's role hook and the bootstrap script refuse and name the supplement.

An existing installation from before chart 0.7 has no initialized schema bridge, so its first upgrade needs this bootstrap before the maintenance fence. Rehearse the target release's database preparation on a restored backup first, and apply any compatibility supplement from the list above before the upgrade.

For a database whose roles already exist, set `migrations.schemaBridge.bootstrapEnabled` and point `migrations.schemaBridge.databaseUrlSecret.name` and `.key` at a dedicated one-shot provider credential. That login must be allowed to `SET ROLE xberg_role_root`, and the root must hold `CREATE` on the target database. The hook grants neither. The Job's `migrations.schemaBridge.activeDeadlineSeconds` defaults to 300 and accepts 120 to 3600, so allow time for scheduling and a cold image pull. On Argo CD the Job runs as a PreSync hook before the maintenance fence. Disable the option after the first successful initialization. On a self-managed database initialized by the standard bootstrap, grant only that capability to the existing restricted root before you enable the bridge. Do not create a replacement root, change its attributes or grant `CREATEROLE`:

```shell
psql "${PROVIDER_DATABASE_URL:?set the target database provider URL}" -X --set=ON_ERROR_STOP=1 <<'SQL'
BEGIN READ ONLY;
SET LOCAL ROLE xberg_role_root;
SELECT current_user = 'xberg_role_root' AND NOT (rolcanlogin OR rolsuper OR rolbypassrls
    OR rolcreatedb OR rolinherit OR rolreplication OR rolcreaterole) AS bridge_root_ready
FROM pg_roles WHERE rolname = current_user \gset
\if :bridge_root_ready
\else
  \quit 1
\endif
ROLLBACK;
SELECT format('GRANT CREATE ON DATABASE %I TO xberg_role_root', current_database())
\gexec
SELECT has_database_privilege('xberg_role_root', current_database(), 'CREATE') AS root_database_create;
SQL
```

The first part checks that the provider session can assume the root, and creates no memberships.

Bootstrap-only Cloud SQL installs also need `migrations.maintenanceManifest.enabled: true`, an explicit `maintenanceOperationId` and `maintenanceManifest.installationId: unbound`. Keep them unchanged through the normal migration phase. An installed registry needs its actual UUID instead of `unbound`, and a mismatched identity fails before any maintenance effect. The manifest holds hashes, never secret values.

The schema bridge records the maintenance operation and schema digest before managed role bootstrap, and a completed receipt binds permanently to the first installation UUID. A failed migration leaves the active receipt in place. Values changes, expired leases and retries cannot clear it. See [Recover a failed bootstrap migration](#recover-a-failed-bootstrap-migration).

## Recover a failed bootstrap migration

A bootstrap migration that fails leaves the bridge receipt active on its operation. A retry with the same chart and values resumes that operation. Any change to the chart or the values changes the request digest, and the maintenance hook then refuses to begin, so a corrected chart cannot resume the failed operation. The recover action replaces the failed operation with a new one and records the replacement. It never marks the failed operation completed, and the new operation completes through the ordinary migration hooks.

### What recovery accepts

Recovery applies only to a bootstrap: no installed registry, an unbound bridge, installation `unbound` and epoch 0. The target schema must not change, and the request must change (for an unchanged request, retry instead). Recovery recomputes both request digests from the manifest files and refuses a file whose digest does not match. It also refuses while another session of a migration or maintenance login is connected. A session that waits for the schema migration lock does not count.

### Stop the release first

The database checks cannot see Kubernetes, so do these steps before recovery:

1. Stop every reconciler of the release. Suspend Argo CD automated sync, and do not run `helm upgrade`.
2. Wait until every migration hook Job of the failed release has stopped.
3. Delete the Jobs and Pods of the failed operation, and make sure none remain.

### Grant the recovery role

A login that recovers needs both `xberg_maintenance` and `xberg_maintenance_recovery`. On a self-managed database, grant the second to the maintenance login as a superuser:

```sql
GRANT xberg_maintenance_recovery TO maintenance_login WITH ADMIN FALSE, INHERIT FALSE, SET FALSE;
```

On Cloud SQL and other managed services, only the role broker holds `ADMIN` on `xberg_maintenance_recovery`. Connect as the restricted `xberg_role_admin` login and call the broker function:

```sql
SELECT xberg_provision.grant_maintenance_recovery_to_login('maintenance_login');
```

The function refuses a login that is not a maintenance login or that does not hold `xberg_maintenance`. A second call for a login that already holds the role changes nothing.

### Render the two manifests

Render the manifest of the failed operation from the chart and values of the failed release. Render the manifest of the new operation from the corrected chart and values, with a new `migrations.maintenanceOperationId`. Use the release name and namespace of the installation for both renders:

```shell
manifest() {
  printf '%s' "$(helm template xberg-pro "$1" --namespace xberg-pro -f "$2" \
    --show-only templates/migrations/maintenance-manifest.yaml | yq '.data."manifest.json"')"
}
manifest "$FAILED_CHART_DIR" failed-values.yaml > predecessor-manifest.json
manifest "$PRO_CHART_DIR" corrected-values.yaml > successor-manifest.json
sha256sum predecessor-manifest.json successor-manifest.json
```

The first digest must equal the request digest of the active bridge receipt. Read the receipt, with its operation, target schema digest and revision, as the maintenance login:

```sql
SELECT state, operation_id, request_digest, target_schema_digest, revision
FROM xberg_deployment_bridge.deployment_schema_bridge;
```

### Run the recover action

Run the maintenance fence script of the corrected chart from the operator machine. The script takes the schema migration lock and checks every condition before it changes the bridge:

```shell
export DATABASE_URL="$MAINTENANCE_DATABASE_URL"
export ONLINE_SCHEMA_DIRECTORY="$PRO_CHART_DIR/charts/_distribution/files"
export MAINTENANCE_ACTION=recover
export MAINTENANCE_OPERATION_ID=REPLACE_WITH_NEW_OPERATION_UUID
export MAINTENANCE_REQUEST_DIGEST="sha256:$(sha256sum < successor-manifest.json | cut -d' ' -f1)"
export MAINTENANCE_TARGET_SCHEMA_DIGEST=REPLACE_WITH_TARGET_SCHEMA_DIGEST
export MAINTENANCE_EXPLICIT_OPERATION=true
export MAINTENANCE_EXPECTED_INSTALLATION_ID=unbound
export MAINTENANCE_EXPECTED_EPOCH=0
export MAINTENANCE_RECOVERY_PREDECESSOR_OPERATION_ID=REPLACE_WITH_FAILED_OPERATION_UUID
export MAINTENANCE_RECOVERY_PREDECESSOR_REQUEST_DIGEST=REPLACE_WITH_FAILED_REQUEST_DIGEST
export MAINTENANCE_RECOVERY_PREDECESSOR_TARGET_SCHEMA_DIGEST=REPLACE_WITH_TARGET_SCHEMA_DIGEST
export MAINTENANCE_RECOVERY_PREDECESSOR_REVISION=REPLACE_WITH_RECEIPT_REVISION
export MAINTENANCE_RECOVERY_PREDECESSOR_MANIFEST="$PWD/predecessor-manifest.json"
export MAINTENANCE_RECOVERY_SUCCESSOR_MANIFEST="$PWD/successor-manifest.json"
export MAINTENANCE_RECOVERY_REASON="corrected the migration script after the failed bootstrap"
sh "$PRO_CHART_DIR/charts/_distribution/files/deployment-maintenance-fence.sh"
```

The bridge is then active on the new operation at the next revision. The table `xberg_deployment_bridge.deployment_schema_bridge_recovery` holds one row with both operations, the reason and the login. If the acknowledgement is lost, run the same command again. It succeeds and changes nothing.

### Revoke the recovery role

Revoke the grant before you run `helm upgrade`. The chart's role hook refuses a maintenance login that holds `xberg_maintenance_recovery`, so the upgrade fails while the grant remains. On a self-managed database, as a superuser:

```sql
REVOKE xberg_maintenance_recovery FROM maintenance_login;
```

On Cloud SQL and other managed services, connect as `xberg_role_admin` and call the broker function:

```sql
SELECT xberg_provision.revoke_maintenance_recovery_from_login('maintenance_login');
```

The function raises an error if the login still holds the role through a grant that the role broker did not make.

### Finish the migration

Run `helm upgrade` with the corrected chart and values. The ordinary hooks begin the new operation and finalize it, and they do not need the recovery role. The failed operation can no longer begin or finalize.

### The administrative boundary

The recovery history refuses `UPDATE`, `DELETE` and `TRUNCATE` for every role while its trigger is enabled. The owner of the history table, `xberg_role_root`, and a superuser can disable that trigger. On Cloud SQL and other managed services, the provider administrator holds `ADMIN` on `xberg_role_root` and can therefore reach the owner role. Treat these credentials as administrative credentials.

The maintenance role keeps write access to the bridge table, because the begin and finalize hooks use it. A login with that role can change the bridge without a history row. Treat the maintenance credential as an administrative credential too. The history records only the changes that the recover action makes.

## Upgrade and rollback

Back up PostgreSQL and the object store before every upgrade. See [Backup and restore](/operate/backup-and-restore/).

An existing installation that runs vectorscale 0.9.0 or 0.9.1 needs the permanent hybrid namespace migration before its next Helm schema migration. Set `PGHOST`, `PGPORT`, `PGDATABASE` and `PGSSLMODE`, then provide three separate nonsuperuser credentials: the extension-owning login with database `CREATE`, the migration login that can `SET ROLE xberg_schema_owner`, and the activation login that can `SET ROLE xberg_vector_index_activation_admin`. The planning database must be prepared and reachable by the migration login.

```shell
export MIGRATION_PLAN_DATABASE=xberg_schema_plan
export EXTENSION_ADMIN_PGUSER="$EXTENSION_ADMIN_LOGIN"
export EXTENSION_ADMIN_PGPASSWORD="$EXTENSION_ADMIN_PASSWORD"
export SCHEMA_MIGRATION_PGUSER="$SCHEMA_MIGRATION_LOGIN"
export SCHEMA_MIGRATION_PGPASSWORD="$SCHEMA_MIGRATION_PASSWORD"
export ACTIVATION_PGUSER="$ACTIVATION_LOGIN"
export ACTIVATION_PGPASSWORD="$ACTIVATION_PASSWORD"
export XBERG_EXTENSION_NAMESPACE_MIGRATION_ACK=permanent-hybrid-v1
export EXTENSION_NAMESPACE_QUIESCENCE_TIMEOUT_SECS=600
export SCHEMA_DIRECTORY="$PRO_CHART_DIR/charts/_distribution/files"
sh "$PRO_CHART_DIR/charts/_distribution/files/migrate-extension-namespace.sh"
```

The command waits up to `EXTENSION_NAMESPACE_QUIESCENCE_TIMEOUT_SECS` for active vector-index DDL, moves the four relocatable extensions, leaves vectorscale in `public`, validates identities and data, applies `schema.sql` and re-enables vector-index claims once a follow-up plan reports zero steps. Disable the one-time extension login, or revoke its database `CREATE` capability, afterward.

New installs default to `migrations.planningDatabaseBootstrap=false`, so Helm validates the existing database. An upgrade that uses `--reuse-values` and stored the former `true` default needs `--set migrations.planningDatabaseBootstrap=false` once. Explicit bootstrap needs the one-shot `migrations.planningDatabaseBootstrapDatabaseUrlSecret`. Never reuse a runtime, migration or role-admin Secret for that administrator URL, and revoke it after a successful deployment.

An earlier upgrade that used a superuser can leave grants behind. Contact [support](/more/support/) for the repair script before the next upgrade. Databases bootstrapped by this guide already carry the broker contract. To upgrade an older database without it, set `migrations.brokerTransitionDatabaseUrlSecret` to a distinct one-time PostgreSQL administrator credential for the cutover. Never reuse it as the role-admin Secret. After a successful cutover, clear both `migrations.brokerTransitionDatabaseUrlSecret.name` and `.key`, check that the next render falls back to the role-admin Secret, and only then delete or rotate the one-time Secret. Legacy managed databases without the broker contract are unsupported, because the cutover needs a true PostgreSQL superuser.

Rollback needs stable external credential Secrets in both the current and the target revision. Keep the application, maintenance, migration, role-admin and vector-worker Secret references stable and their values available throughout the operation. Embedded chart credentials block rollback. A values-only rollback validates the existing broker contract and the desired schema before it runs the normal planner. It does not reverse broker ownership or widen migration privileges.

For a configuration-only change, keep the installed chart version and use the extracted chart that matches it. The command refuses a different chart version:

```shell
export VERSION=$(helm get metadata xberg-pro -n xberg-pro -o json | jq -er .version)
helm show chart "$PRO_CHART_DIR" | grep -Fxq "version: $VERSION" || {
  printf 'Use the chart that matches the installed version for configuration-only upgrades.\n' >&2
  exit 1
}
helm upgrade xberg-pro "$PRO_CHART_DIR" \
  -n xberg-pro -f "$PRO_VALUES_FILE" \
  --set migrations.enabled=true \
  --rollback-on-failure --wait --timeout 110m
helm history xberg-pro -n xberg-pro
export REVISION=1
helm rollback xberg-pro "$REVISION" -n xberg-pro \
  --wait --wait-for-jobs --timeout 110m
```

With the migration pipeline enabled, the chart stops the Pro StatefulSet before the database hooks run. The ordered post-upgrade hooks restore the recorded replica count, including zero, and enable vector-index claims when configured. These hooks do not wait for the workload to become ready. A failed pre-upgrade hook restores the replica count unless the vector bridge is absent during its physical transition. That gap keeps Pro stopped for a corrected retry.

If the main resource apply or the readiness wait fails after the pre-upgrade hooks succeed, post-upgrade hooks are skipped. Pro stays stopped and claims stay disabled. Inspect `helm history xberg-pro -n xberg-pro`, `helm get hooks xberg-pro -n xberg-pro` and the failed resources. Preserve your reviewed configuration, because saved Helm values may omit direct changes to ConfigMaps or workloads. Verify that the target chart, image and database ownership contract are compatible, then retry the same upgrade with `migrations.enabled=true` and let its hooks restore the replica count and enable claims. When the intended replica count is one, wait for the pod to become ready and run `helm test xberg-pro -n xberg-pro` before you resume traffic. Preserve an intended zero replica count: do not start Pro only to run the health test, and never replace recorded zero with an unconditional scale to one.

If that upgrade cannot complete, contact [support](/more/support/) to validate the partially applied resources and the actual database phase before you run the target revision's restore and claims-enable procedures. Scaling alone does not complete recovery. Do not use automatic rollback as a universal recovery procedure across a database ownership boundary. Do not use native `helm rollback` across such a boundary at all. Stop and contact [support](/more/support/) for a version-specific rollback plan, including the privileged administrator grants and the ordered rollback hooks. This guide does not provide that procedure. The 110-minute timeout covers the default rollback pipeline, so raise it if you increase any migration, vector-index or readiness deadline.

For a chart-version upgrade, render and review the target chart and its release notes first, and keep the migration pipeline enabled so its contract checks protect both upgrades and rollbacks. The migration and rollback hooks call the Kubernetes API. With `networkPolicy.enabled=true`, the chart policy leaves their pods out so they can reach it. A policy of your own that selects every pod in the namespace selects these hooks again, so it must admit the exact Kubernetes API destination CIDRs and TCP ports your cluster enforces after Service address translation. Do not open all private ranges. Apply and verify that rule before an install or a support-coordinated ownership rollback, because the quiesce and restore hooks fail on a deadline when they cannot reach the API. See also [Upgrades](/operate/upgrades/).
