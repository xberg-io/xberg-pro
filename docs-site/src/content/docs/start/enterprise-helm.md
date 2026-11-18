---
title: Install Xberg Enterprise with Helm
description: Deploy the Xberg Enterprise microservices on your Kubernetes cluster with the delivered chart, from prerequisites and database bootstrap to verification and upgrade.
sidebar:
  order: 3
---

Xberg Enterprise is commercially licensed and delivered by arrangement. You receive the Helm chart, registry credentials for the product images and a license agreement. A chart archive does not grant rights to use the software, so read the bundled `LICENSE` and your commercial agreement. To arrange access, contact [contact@xberg.io](mailto:contact@xberg.io).

Enterprise runs as separate services on your cluster: an API, a backend for projects and members, RAG, workers that scale to zero with KEDA, and webhook delivery. They share PostgreSQL, NATS JetStream and object storage. For a single container instead, use [Xberg Pro](/start/pro-docker/). See [Architecture](/concepts/architecture/) for how the services fit together.

The install has seven steps, and each ends with a check. Do not continue until the check passes.

1. [Prepare the cluster](#prerequisites)
2. [Get the chart](#chart-and-images)
3. [Prepare the database](#database-bootstrap)
4. [Create the Secrets](#secrets-and-configuration)
5. [Configure the values](#customization-checkpoints)
6. [Install and verify](#install-and-verify)
7. [Create a project and an API key](#create-a-project-and-an-api-key)

## Prerequisites

- Helm 4, `kubectl`, `yq` and `curl` on the machine that runs the install, and a Kubernetes version within [Helm's support matrix](https://helm.sh/docs/topics/version_skew/). Any distribution works: EKS, GKE, AKS or on-premises.
- Nodes on `linux/amd64` or `linux/arm64`. The api, backend, worker, webhook, rag and pro images are published for both under one tag, so mixed pools need no per-node tag. The GPU worker, `worker-gpu`, is `linux/amd64` only. Schedule it on amd64 nodes, for example with `workerGpu.nodeSelector."kubernetes.io/arch": amd64`.
- PostgreSQL 15 to 18 (managed or self-hosted) with pgvector 0.8.0 or newer. `pgvectorscale` is optional; see [PostgreSQL extensions](#postgresql-extensions).
- `psql` and the GNU `timeout` command on the install machine, which must reach the database, for the bootstrap.
- Authenticated NATS JetStream 2.10 or newer. Enable the bundled NATS dependency, or provide your own.
- Persistent object storage: GCS, S3, Azure Blob Storage or an S3-compatible store such as RustFS.
- Registry credentials for the product images, supplied through `imagePullSecrets` or node identity.
- KEDA, either preinstalled or bundled, and Argo Rollouts or the native Deployment adapter; see [Deployment adapter](#deployment-adapter).
- Prometheus Operator, if you want `ServiceMonitor` resources. Istio is optional.

The chart does not provision cloud accounts, DNS, buckets or IAM. For external KEDA, install its CRDs and operator first, then set `keda.enabled=false` and `keda.crdsPreinstalled=true`. For bundled KEDA, install first with `keda.enabled=true` and `keda.crdsPreinstalled=false`, and upgrade with `keda.crdsPreinstalled=true` once its CRDs and operator are ready. Without `keda.crdsPreinstalled=true`, the chart renders no ScaledObject.

**Check.** KEDA and the Rollouts controller (if you use it) are ready:

```shell
kubectl get crd scaledobjects.keda.sh
kubectl get crd rollouts.argoproj.io
kubectl get nodes -o wide
```

The first command lists the ScaledObject CRD unless you let the chart bundle KEDA. The second lists the Rollout CRD when you use Argo Rollouts. The nodes report `Ready`.

## Deployment adapter

The default `deployment.adapter=argo-rollouts` renders every service as an Argo Rollout. You must install the Rollouts CRDs and controller before the chart, even when both worker tiers are disabled. For a fresh installation without Argo, set the native adapter:

```yaml
deployment:
  adapter: native
  native:
    strategy: RollingUpdate
```

Native rolling updates keep `maxUnavailable: 0` and `maxSurge: 1`, so provide spare capacity for the replacement pod. HPA and KEDA are optional: disable a component's autoscaler to use its fixed `replicaCount`. When KEDA CRDs are unavailable, native workloads keep their configured replica counts.

Existing installations keep the `argo-rollouts` default and their canary strategies. `deployment.argoRollouts.crdsPreinstalled=true` asserts that you installed both the Rollouts CRDs and the controller. The chart does not install them. Switching an installed release between adapters needs a separate staged migration, so do not change only the value on a serving release. The adapter setting does not provide blue/green lifecycle support and rejects it.

Migration hooks quiesce workloads before schema changes under both adapters. Native rolling updates alone do not provide online database migrations or uninterrupted upgrades.

## Chart and images

Set `ENTERPRISE_CHART` to the chart reference or archive path you received, and `VERSION` to the delivered version. Download the chart and render the default values:

```shell
export ENTERPRISE_CHART=REPLACE_WITH_DELIVERED_CHART_REFERENCE
export VERSION=REPLACE_WITH_DELIVERED_VERSION
helm pull "$ENTERPRISE_CHART" --version "$VERSION" --untar
export ENTERPRISE_CHART_DIR="$PWD/xberg-enterprise"
helm show values "$ENTERPRISE_CHART_DIR" > values.yaml
```

If you received an archive file, extract it with `tar -xzf` in the working directory instead of `helm pull`. Keep the extracted chart for the bootstrap files, installation and upgrades.

Each released archive pins the enabled first-party workloads to exact image digests. When you mirror the images, override each repository together with the digest of the copied artifact, and apply the same rule to the migration and utility images. The migration images default to the public `ghcr.io/xberg-io/xberg-enterprise-migration-pgschema` and `ghcr.io/xberg-io/xberg-enterprise-migration-psql` repositories and pull anonymously. A private mirror needs its own credentials and repository overrides.

The service image repositories carry no registry host. Set `api.image.repository` and its siblings to the registry you pull from, and configure `imagePullSecrets` or node identity for it. Chart download access does not authorize product-image pulls. For a registry Secret:

```shell
kubectl create namespace xberg-enterprise
kubectl -n xberg-enterprise create secret docker-registry xberg-registry \
  --docker-server=REPLACE_WITH_REGISTRY_HOST \
  --docker-username=REPLACE_WITH_USERNAME \
  --docker-password=REPLACE_WITH_PASSWORD
```

Then list it in `values.yaml` as `imagePullSecrets: [{name: xberg-registry}]`. Set `tests.images.{curl,postgres,nats,kubectl}.repository` and `tag` or `digest` for the test images. Test pods use the release `imagePullSecrets`. Enabled third-party dependencies have their own image settings under their nested values. For the optional Chrome dependency, set `chrome.imagePullSecrets` when its image mirror needs a registry Secret.

**Check.** The chart is extracted and its version matches the delivery:

```shell
helm show chart "$ENTERPRISE_CHART_DIR" | grep -E '^(name|version):'
test -f "$ENTERPRISE_CHART_DIR/charts/_distribution/files/pro-db-bootstrap.sh" && echo OK
```

The chart reports `name: xberg-enterprise` and your version, and the second command prints `OK`.

## PostgreSQL extensions

Enterprise uses four extensions on every deployment, plus one optional extension for the recommended vector index method. The migration Job installs all of them. The optional one sits in a tolerant block, so its absence does not abort the migration.

| Extension                  | Purpose                                               |
| -------------------------- | ----------------------------------------------------- |
| `uuid-ossp`                | UUID generation primitives                            |
| `pgcrypto`                 | Cryptographic hashing primitives                      |
| `btree_gin`                | Composite indexes used by audit queries               |
| `pgvector`                 | Vector types and similarity-search operators          |
| `pgvectorscale` (optional) | StreamingDiskANN index for billion-vector collections |

Without `pgvectorscale`, set `vectorstore.defaultIndexMethod: "hnsw"` (environment variable `XBERG_VECTORSTORE_DEFAULT_INDEX_METHOD=hnsw`) so new collections default to HNSW. The `pgvector` extension itself supports HNSW, and it is comfortable up to roughly 10 million vectors per index. When `pgvectorscale` is missing, the migration Job emits a notice and continues. `pgvectorscale` supports PostgreSQL 13 to 17.

On managed databases:

- **Google Cloud SQL** has `pgvector` preinstalled. `pgvectorscale` is not available, so pin `hnsw`, or move to AlloyDB or self-hosted TimescaleDB for billion-scale workloads.
- **AWS RDS and Aurora** manage extensions through parameter groups. Ask AWS to confirm `pgvectorscale` for your engine version.
- **Azure Database for PostgreSQL** enables extensions in the portal or through Terraform. `pgvector` is on the allow-list.

On self-hosted PostgreSQL, the `timescale/timescaledb-ha:pg17-all` image bundles both extensions, or you can install `pgvectorscale` from the TimescaleDB package repository.

## Database bootstrap

Use a dedicated PostgreSQL server or cluster for each independently administered Xberg deployment. Separate databases or custom login names do not isolate the fixed Xberg capability roles. Do not install independent Pro and Enterprise releases on the same PostgreSQL server, because migrations and rollbacks change shared role memberships. A separate PostgreSQL instance is enough; a separate Kubernetes cluster is not required.

For a fresh installation, create an empty dedicated database and run the bundled bootstrap once as its PostgreSQL administrator. It completes the schema, the broker role graph and the physical namespace transition before the restricted Helm hooks run. The bootstrap supports both products. It reads the complete asset directory `charts/_distribution/files` of the extracted chart. Keep the assets there, because copying them into the chart's runtime `files/` directory would exceed Helm's release storage limit.

Supply `PGHOST`, `PGPORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` and eight role password variables through your secret manager. All nine passwords must be distinct: `POSTGRES_APPLICATION_PASSWORD`, `POSTGRES_MAINTENANCE_PASSWORD`, `POSTGRES_SCHEMA_OWNER_PASSWORD`, `POSTGRES_MIGRATION_PASSWORD`, `POSTGRES_ROLE_ADMIN_PASSWORD`, `POSTGRES_INDEX_WORKER_PASSWORD`, `POSTGRES_VECTOR_BROKER_PASSWORD` and `POSTGRES_PHYSICAL_MIGRATION_PASSWORD`.

```shell
export PGPASSWORD="$POSTGRES_PASSWORD"
export PRO_DB_BOOTSTRAP_MODE=standard
export PRO_DB_BOOTSTRAP_PHASE=all
export PRO_DB_INITIALIZE_SCHEMA=true
export PRO_DB_DEFER_CLAIMS_ENABLE=true
export SCHEMA_DIRECTORY="$ENTERPRISE_CHART_DIR/charts/_distribution/files"
sh "$SCHEMA_DIRECTORY/pro-db-bootstrap.sh"
export MIGRATION_PLAN_DATABASE=xberg_schema_plan
export PLANNING_DATABASE_BOOTSTRAP=true
export PLANNING_EXTENSIONS_FILE="$SCHEMA_DIRECTORY/extensions-prepare.sql"
export DATABASE_URL="postgresql://${POSTGRES_USER}@${PGHOST}:${PGPORT}/${POSTGRES_DB}"
export MIGRATION_DATABASE_URL="postgresql://xberg_schema_migrator@${PGHOST}:${PGPORT}/${POSTGRES_DB}"
sh "$SCHEMA_DIRECTORY/prepare-schema-planning-database.sh"
```

The script detects a true superuser or a restricted administrator on PostgreSQL 16 or newer, and creates eight logins: `xberg_app`, `xberg_maintenance_login`, `xberg_index_worker_login`, `xberg_vector_index_broker_login`, `xberg_physical_migration_login`, `xberg_schema_login`, `xberg_role_admin` and `xberg_schema_migrator`. An install that creates Secrets and skips this step fails in the `maintenance-role` hook.

Use this procedure only on an empty database. For an existing installation, keep its data and follow [Upgrade and rollback](#upgrade-and-rollback). Do not replay `PRO_DB_INITIALIZE_SCHEMA=true`. The requirements for a restricted administrator, the vectorscale namespace migration and the broker transition credentials are the same as in the [Pro Helm guide](/start/pro-helm/#database-bootstrap). Managed-database specifics are in [Cloud SQL](/operate/cloud-sql/) and [AWS storage](/operate/aws-storage/).

Keep administrator, schema-owner and physical-migration credentials out of runtime workloads. The role-admin Secret holds the restricted `xberg_role_admin` login. New installs default to `migrations.planningDatabaseBootstrap=false`. An upgrade that uses `--reuse-values` and stored the former `true` default needs `--set migrations.planningDatabaseBootstrap=false` once. Explicit bootstrap needs the one-shot `migrations.planningDatabaseBootstrapDatabaseUrlSecret`. Never reuse a runtime, migration or role-admin Secret for it.

**Check.** The scripts finish without an error message, and the application login connects:

```shell
PGPASSWORD="$POSTGRES_APPLICATION_PASSWORD" \
  psql -h "$PGHOST" -p "$PGPORT" -U xberg_app -d "$POSTGRES_DB" -c 'SELECT current_user'
```

`psql` prints `xberg_app`.

## Secrets and configuration

Set `secrets.create=false` and create the Secrets before installation. The render stops at the first selector it cannot resolve, so create all of them first. Use this example as a starting point:

```yaml
secrets:
  create: false
  databaseUrlSecret:
    name: xberg-enterprise-secrets
    key: database-url
global:
  maintenance:
    databaseUrlSecret:
      name: xberg-enterprise-secrets
      key: maintenance-database-url
  natsCredentials:
    create: false
    existingSecret: xberg-nats
migrations:
  planningDatabaseBootstrap: false
  databaseUrlSecret:
    name: xberg-schema-migrator
    key: database-url
  roleAdminDatabaseUrlSecret:
    name: xberg-role-admin
    key: database-url
  brokerTransitionDatabaseUrlSecret:
    name: ""
    key: ""
vectorIndexWorker:
  logins:
    worker: xberg_index_worker_login
    migration: xberg_schema_migrator
    broker: xberg_vector_index_broker_login
    physicalMigration: xberg_physical_migration_login
  databaseUrlSecret:
    name: xberg-index-worker
    key: database-url
tests:
  enabled: true
```

| Secret              | Selected by                                                                                                                    | Keys                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Platform            | the fixed name `<release>-xberg-enterprise-secrets`, or `secrets.databaseUrlSecret` and `global.maintenance.databaseUrlSecret` | `database-url`, `maintenance-database-url`, `jwt-secret` (32 characters or more)                                                              |
| NATS                | `global.natsCredentials.existingSecret`, with `create: false`                                                                  | `nats-api-password`, `nats-worker-password`, `nats-backend-password`, `nats-rag-password`, `nats-webhook-password`, `nats-bootstrap-password` |
| Schema migrator     | `migrations.databaseUrlSecret`                                                                                                 | the key you name                                                                                                                              |
| Role admin          | `migrations.roleAdminDatabaseUrlSecret`                                                                                        | the key you name                                                                                                                              |
| Vector-index worker | `vectorIndexWorker.databaseUrlSecret`                                                                                          | the key you name                                                                                                                              |
| Vector-index broker | `vectorIndexWorker.brokerDatabaseUrlSecret`                                                                                    | the key you name                                                                                                                              |
| Physical migration  | `vectorIndexWorker.physicalMigrationDatabaseUrlSecret`                                                                         | the key you name                                                                                                                              |

Create each Secret with `kubectl create secret generic`, for example:

```shell
kubectl -n xberg-enterprise create secret generic xberg-enterprise-secrets \
  --from-literal=database-url='postgresql://xberg_app:REPLACE_APPLICATION_PASSWORD@postgres.example.com:5432/xberg' \
  --from-literal=maintenance-database-url='postgresql://xberg_maintenance_login:REPLACE_MAINTENANCE_PASSWORD@postgres.example.com:5432/xberg' \
  --from-literal=jwt-secret="$(openssl rand -hex 32)"
```

Percent-encode passwords in URLs and use TLS as your database provider requires. Never use administrator URLs for runtime services. Each URL must resolve to its own login. On the `secrets.create: false` path the chart cannot see the URLs, so it compares Secret names instead, which does not prove the logins are distinct. With `secrets.create: true`, the chart refuses a vector-index URL that repeats the application, schema-owner, role-admin or maintenance URL.

Separate Secrets keep the application and schema-owner credential, the maintenance credential and the role-admin credential apart, so Secret-level RBAC and rotation scope independently. The role-admin credential runs only the capability-role init step. The schema-owner URL applies extensions and schema, and that schema owner rebuilds exact grants afterward. The application and maintenance URLs must resolve to distinct logins with only their matching capability membership. To rotate the maintenance credential, publish the new URL, bump `global.maintenance.credentialRevision` and roll every consumer. Revoke the old login only after all old pods are gone and it has no active sessions.

**Check.** The Secrets exist:

```shell
kubectl -n xberg-enterprise get secrets
```

The list shows every Secret named in the table, plus `xberg-registry` if you use a registry Secret.

### NATS

Use distinct, nonempty UTF-8 NATS passwords without NUL. The server and provisioning Job receive the bootstrap credential, and runtime workloads receive only their own. Existing Secrets, including those managed by External Secrets Operator, must contain the bootstrap key. NATS reserves passwords that begin with `$2a$`, `$2b$`, `$2x$` or `$2y$` followed by two digits and `$` for bcrypt hashes, and the chart rejects that syntax at startup. A Secret change needs a restart of the server and clients, because their credentials are injected as environment variables.

For external NATS, set `nats.enabled=false` and `global.natsUrl` to its full client URL, for example `tls://broker.example.com:4443`. For KEDA, also set `global.natsMonitoringUrl`. Apply the permission ConfigMap rendered with your deployment values to that server, and keep the per-service identities.

The API image runs `api --bootstrap-nats <manifest-path>` in a bounded provisioning Job before runtime workloads become ready. It creates the shared streams, buckets and durable consumers. Runtime services verify existing resources and cannot administer JetStream. The bundled dependency enables the optional `natsBox` diagnostic client. Give it a separate diagnostic identity, or set `nats.natsBox.enabled=false` to omit it. When you upgrade an existing installation, add the bootstrap credential to the server and Secret first, run the provisioning command against the existing resources, and resolve any incompatible resource configuration before you apply the restrictive broker permissions and new runtime images together. Keep existing messages and consumers. Do not delete streams to bypass a configuration mismatch.

### Object storage

Set `STORAGE_PROVIDER` and `STORAGE_BUCKET` under `api.env`, under `worker.env` and, when it is enabled, under `workerGpu.env`. The RAG service reads `api.env` and takes `rag.env` as an override. The api, worker and worker-gpu services default to `STORAGE_PROVIDER: gcs` with an empty bucket, and the render stops and names the component and the value it wants. `STORAGE_PROVIDER` accepts `gcs`, `s3`, `azure`, `fs` or `memory`. Use `s3` with an S3-compatible endpoint for RustFS. See [Storage](/operate/storage/) and [AWS storage](/operate/aws-storage/).

### Network policies

With `<component>.networkPolicy.enabled: true`, the chart's egress rules cover same-namespace dependencies, cluster DNS and public HTTPS. The `worker`, `workerGpu` and `webhooks` policies also admit public TCP 80, because crawl seeds and webhook receivers answer on plain HTTP. The `backend` policy admits it too, for test webhook deliveries and for every other public client in the backend: OIDC discovery and JWKS, the OAuth token and revocation client, the Google Drive connector and the analytics and event notifiers. `<component>.networkPolicy.publicEgressPorts` sets the ports. An unset or null key keeps TCP 443 and 80, so `helm upgrade --reuse-values` from an older chart keeps public egress. Only an empty list renders no public rule.

A PostgreSQL, NATS, identity provider or object store outside the release namespace needs a supplemental NetworkPolicy of your own that names its exact destination CIDRs and ports. Without one, every service that needs the database exits with `Failed to acquire database role validation connection: Timed out in bb8`. Keep those policies in your deployment repository and verify connectivity before rollout. For SFTP source connectors, also add the destination under `backend.networkPolicy.extraEgress`, `worker.networkPolicy.extraEgress` and `workerGpu.networkPolicy.extraEgress`.

### Observability export

OTLP export is off by default, while local logs and Prometheus metrics stay available. To enable export, set `global.observability.otlpEndpoint` to your collector's OTLP/gRPC URL. For an in-cluster collector with network policies enabled, also set `global.observability.namespace` to its namespace (TCP 4317). The chart does not install a collector. See [Observability](/observability/).

### Customization checkpoints

Set these values before you deploy:

| Value                                                          | Purpose                                                                                            |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `global.domain`, `global.backendDomain`                        | Primary API domain and dashboard and backend domain                                                |
| `global.environment`                                           | Environment name, `production` or `development`                                                    |
| `api.hosts`, `backend.hosts`                                   | Optional host aliases routed by Istio; they default to the global domains                          |
| `istio.gateway.hosts`                                          | Every hostname the Istio Gateway accepts; must include all `api.hosts` and `backend.hosts` entries |
| `{api,backend,worker,webhooks}.image.repository` and `.tag`    | Image registry, name and tag for each service                                                      |
| `api.ingress.className`, `.annotations`, `.tls`                | Ingress class, per-ingress annotations and TLS                                                     |
| `worker.keda.maxReplicas`                                      | Maximum worker replicas (default 50)                                                               |
| `webhooks.keda.maxReplicas`                                    | Maximum webhook replicas (default 10)                                                              |
| `frontend.enabled`                                             | Deploy the dashboard (default `false`)                                                             |
| `global.authAllowedEmailDomains`                               | Email domains that may sign in. Room invitations go only to these domains                          |
| `api.env.OPENAPI_CONTACT_URL`, `api.env.OPENAPI_CONTACT_EMAIL` | Contact details in the generated OpenAPI document. The same keys work under `backend.env`          |

When the dashboard is on, it shares a host with the control plane and the data plane. The dashboard Ingress owns `/`. `backend.ingress` owns the control-plane paths (`/auth/config`, `/auth/login`, `/auth/account`, `/auth/profile`, `/healthz`, `/readyz`, `/api-doc`), and `backend.gatewayApiPaths: true` forwards the data-plane prefixes in `backend.apiGatewayPathPrefixes` to the api Service. Serve the dashboard host over HTTPS, because the OIDC client uses `crypto.subtle`, which browsers withhold outside a secure context.

The chart authenticates REST calls with JWTs signed by a key from a Secret with no default. Grafana is not part of the chart, and its authentication belongs to the Grafana instance you run.

### Security headers, CORS and rate limits

The `api` and `backend` services send the same security headers as Pro and default to no CORS headers. Set `CORS_ALLOWED_ORIGINS`, `RATE_LIMIT_BURST` and `RATE_LIMIT_PER_SECS` under `api.env` and `backend.env` to change the defaults. Set `LOGIN_RATE_LIMIT_BURST` and `LOGIN_RATE_LIMIT_PER_SECS` under `backend.env`. The `api` service mounts no login route and ignores them. The values mean the same as in [Pro configuration](/reference/pro-configuration/#tuning).

### Worker engine threads

Set `worker.env.WORKER_ENGINE_MAX_THREADS`, or `workerGpu.env.WORKER_ENGINE_MAX_THREADS` for the GPU tier, to a positive whole number to limit the threads used to extract one document. This setting is separate from `WORKER_CONCURRENCY`, which controls how many documents a worker processes at once. `0` or an invalid value prevents the worker from starting. When unset, the engine derives its budget from the worker pod's CPU limit, or the smaller of the available CPU count and eight without a limit. Peak memory grows with the thread budget on multi-page scans, so raise the pod's memory limit when you raise it.

For model caches, offline clusters and disconnected installs, see [Air-gapped installation](/operate/air-gapped/) and [RAG configuration](/operate/rag-config/).

**Check.** The values render without errors:

```shell
helm lint --strict "$ENTERPRISE_CHART_DIR" -f values.yaml
helm template xberg-enterprise "$ENTERPRISE_CHART_DIR" \
  -n xberg-enterprise -f values.yaml > rendered.yaml && echo OK
```

`helm lint` reports `0 chart(s) failed`, and the second command prints `OK`. Store `rendered.yaml` securely, because chart-created Secrets appear in it.

## Install and verify

Install the chart and check the workloads for your adapter. Run these commands with shell error checking enabled:

```shell
set -e
helm upgrade --install xberg-enterprise "$ENTERPRISE_CHART_DIR" \
  -n xberg-enterprise -f values.yaml --server-side=false --wait=legacy --wait-for-jobs --timeout 110m
adapter="$(yq -r '.deployment.adapter // "argo-rollouts"' values.yaml)"
case "$adapter" in
  native)
    deployments="$(kubectl get deployments.apps -n xberg-enterprise \
      -l app.kubernetes.io/instance=xberg-enterprise -o name)"
    [ -n "$deployments" ] || { echo 'No Deployments found for this release' >&2; exit 1; }
    for deployment in $deployments; do
      kubectl rollout status "$deployment" -n xberg-enterprise --timeout=15m
    done
    ;;
  argo-rollouts)
    rollouts="$(kubectl get rollouts.argoproj.io -n xberg-enterprise \
      -l app.kubernetes.io/instance=xberg-enterprise -o name)"
    [ -n "$rollouts" ] || { echo 'No Rollouts found for this release' >&2; exit 1; }
    for rollout in $rollouts; do
      generation="$(kubectl get "$rollout" -n xberg-enterprise -o jsonpath='{.metadata.generation}')"
      kubectl wait "$rollout" -n xberg-enterprise \
        --for="jsonpath={.status.observedGeneration}=$generation" --timeout=15m
      kubectl wait "$rollout" -n xberg-enterprise --for=jsonpath='{.status.phase}'=Healthy --timeout=15m
    done
    ;;
  *) echo 'Unsupported deployment adapter' >&2; exit 1 ;;
esac
helm test xberg-enterprise -n xberg-enterprise --logs --timeout 5m
```

Helm 4's default watcher cannot interpret the string `observedGeneration` field of Argo Rollouts. Legacy waiting therefore covers built-in resources and Jobs, and the adapter-specific checks verify Deployment rollout completion or current-generation Rollout health. Client-side apply avoids ownership conflicts when the Rollouts controller normalizes resource quantities (for example, `2000m` to `2`). Keep `--server-side=false` for later upgrades.

Helm tests check API health and readiness and PostgreSQL and NATS connectivity. To also check authenticated API access, set `tests.apiKeySecret.name` and `tests.apiKeySecret.key` to a Secret that holds a valid project API key. The read-only test lists jobs and submits no documents. `tests.keda.enabled` adds an optional KEDA readiness check. Failed test pods remain for diagnosis, and later tests replace them.

**Check.** The script ends without an error, and `helm test` reports every test as `Succeeded`:

```shell
helm status xberg-enterprise -n xberg-enterprise | grep -E '^STATUS'
```

The output is `STATUS: deployed`.

## Create a project and an API key

Enterprise projects, members and API keys live in the backend control plane. Create the first project and its API key in the dashboard (set `frontend.enabled=true` and sign in with your identity provider), or call the control-plane API with a session token. See [Projects and API keys](/guides/projects-and-api-keys/).

**Check.** The key authenticates against the data plane:

```shell
export XBERG_URL=https://REPLACE_WITH_API_DOMAIN
export XBERG_API_KEY=REPLACE_WITH_PROJECT_API_KEY
curl --fail -H "Authorization: Bearer $XBERG_API_KEY" "$XBERG_URL/v1/jobs"
```

The response is a JSON job list. Continue with the [quickstart](/start/quickstart/).

## Migration modes

`migrations.mode` defaults to `maintenance`, which quiesces workloads and runs the role-contract and restoration hooks. `online` renders one restricted schema runner instead. It does not stop workloads, change login privileges or disable vector-index claims, and it cannot bootstrap databases, transfer ownership, repair data or cross a rollback boundary. Online mode currently accepts only a converged no-op. A nonempty plan needs a release-shipped certificate, and no Helm value bypasses certification. Uncertified upgrades fail before they change the database, so use the maintenance procedure.

When an installation already has a fleet control record, maintenance needs an explicit `migrations.maintenanceOperationId` (a UUID) and a `migrations.maintenanceExpectedEpoch` that matches the observed control epoch. The first maintenance hook fences the fleet before it quiesces anything, and successful completion clears only that operation. A failed operation keeps its fence until you recover it, and a different operation cannot take over implicitly. The SQL supplements, the schema bridge and the recovery procedure for a failed bootstrap migration are identical to the Pro chart's. See [Migration modes](/start/pro-helm/#migration-modes) and [Recover a failed bootstrap migration](/start/pro-helm/#recover-a-failed-bootstrap-migration), and use the Enterprise chart directory and release name in those commands. Migration hooks require `READ COMMITTED` and reject a different transaction default before they wait for the schema lock. The schema migration credential needs a direct PostgreSQL connection, or a pooler in session-pooling mode, because the migration lock is held on the connection that runs the SQL. Finalizing a bootstrap migration checks that the live schema matches the target. A difference leaves the bridge receipt active and the finalize step reports the mismatch.

## Upgrade an existing bridge's write permissions

Before you deploy a chart that restricts the bridge functions, finish the previous maintenance operation and pause its reconcilers. Run these commands from the new release's SQL assets in `charts/_distribution/files`. Use the existing migration login for the control permissions and the existing provider login that can assume `xberg_role_root` for the bridge permissions. Both scripts can be rerun, check the installation identity and preserve the completed receipt:

```shell
psql "$SCHEMA_MIGRATION_DATABASE_URL" -X --set=bridge_installation="$INSTALLATION_ID" \
  --file=deployment-schema-bridge-control-upgrade.sql
psql "$BRIDGE_PROVIDER_DATABASE_URL" -X --set=bridge_installation="$INSTALLATION_ID" \
  --file=deployment-schema-bridge-upgrade.sql
```

For a completed bridge that was never bound to an installation, run only the second command with `bridge_installation=unbound`. A fresh database receives these permissions from its normal provider bootstrap. `finalize` needs the migration credential as well as the maintenance connection.

To roll the maintenance chart back across this change, finish the current operation, pause its reconcilers and restore the earlier grants before you install the older hooks. Run the bridge command first, then the control command:

```shell
psql "$BRIDGE_PROVIDER_DATABASE_URL" -X --set=bridge_installation="$INSTALLATION_ID" \
  --set=bridge_restore_legacy=true --file=deployment-schema-bridge-upgrade.sql
psql "$SCHEMA_MIGRATION_DATABASE_URL" -X --set=bridge_installation="$INSTALLATION_ID" \
  --set=bridge_restore_legacy=true --file=deployment-schema-bridge-control-upgrade.sql
```

For a never-bound bridge, run only the bridge command with `bridge_installation=unbound`. Install the older chart before you resume its reconcilers, and repeat the forward upgrade before you reinstall the restricted hooks. A rollback of only a workload keeps the restricted maintenance hooks.

## Private MCP listener

The chart can run a private MCP listener on loopback for local clients. It is off by default and adds no route. See [Private MCP listener](/guides/mcp/).

## Upgrade and rollback

Rollback needs stable external credential Secrets in both the current and the target revision. Use `secrets.create=false` and stable application, maintenance, migration, role-admin and vector-worker Secret references, and keep their values available throughout the operation. Embedded chart credentials block rollback. A values-only rollback validates the existing broker contract and the desired schema before it runs the normal planner. It does not reverse broker ownership or widen migration privileges.

Back up the database and object store. See [Backup and restore](/operate/backup-and-restore/). Review the target release's image versions and migration notes, render the target chart with your values, then run `helm upgrade` with the same wait options and repeat the adapter-specific checks above. Confirm that hooks and workloads succeed, run `helm test`, and verify an authenticated extraction with a non-sensitive document. See [Upgrades](/operate/upgrades/) for the version policy.

Helm rollback cannot undo database data changes. Before you cross a schema-ownership boundary, stop and contact [support](/more/support/) for a version-specific privileged rollback plan. This guide does not document the required administrator grants or authorize a one-step rollback across that boundary. Keep old image and chart versions and database backups until you accept the upgrade. For a support-coordinated ownership rollback, make sure any NetworkPolicy of your own that selects migration hooks permits your cluster's exact Kubernetes API destination CIDRs and TCP ports, including the destinations and ports enforced after Service address translation. Apply and verify that access first, do not open all private ranges, and remove temporary allowances after acceptance.

## Next steps

Plan recovery with [Backup and restore](/operate/backup-and-restore/) before you go to production, connect your observability backends as described in [Observability](/observability/), and register [webhooks](/guides/webhooks/) for result delivery. Then run the [quickstart](/start/quickstart/) against your new deployment.
