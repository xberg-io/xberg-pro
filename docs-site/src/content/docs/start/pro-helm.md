---
title: Install Xberg Pro with Helm
description: Deploy the singleton Xberg Pro StatefulSet on Kubernetes with your own pgvector-enabled PostgreSQL, from chart download to upgrade and rollback.
sidebar:
  order: 2
---

This guide covers the default singleton installation with your own pgvector-enabled PostgreSQL database. Keep its StatefulSet at one replica. For fixed replicas and red/green deployments, use the registered extraction-only profile and the [deployment operator](/operate/deployment-operator/).

## Prerequisites

- Helm 4 and `amd64` or `arm64` nodes. Choose Kubernetes using [Helm's support matrix](https://helm.sh/docs/topics/version_skew/).
- Kubernetes 1.29 or newer. The migration hooks run a sidecar container per hook.
- PostgreSQL 15-18 with the pgvector (`vector`) extension, version 0.8.0 or newer, available.
- `psql` and the GNU `timeout` command for database bootstrap.
- A commercial license to run the public Pro image. Chart downloads and the Pro image are public; see [Licensing](/reference/licensing/).
- Cluster-node access to pull `ghcr.io/xberg-io/xberg-pro`, or an authorized mirror.
- An ingress controller if you expose Pro externally. Use at most one of `ingress`, `gke.ingress` or `istio`.

## Download the chart

Set the chart version, then choose one of the download or supplied-archive options below:

```shell
export VERSION=0.5.5
```

Use an empty working directory. The public chart requires no registry login. Public availability does not grant an open-source license; the archive's `LICENSE` and your commercial agreement apply:

```shell
export PRO_CHART="oci://us-central1-docker.pkg.dev/xberg-public-assets/helm-charts/pro"
helm pull "$PRO_CHART" --version "$VERSION" --untar
export PRO_CHART_DIR="$PWD/pro"
export PRO_CHART_SOURCE="$PRO_CHART_DIR"
test -f "$PRO_CHART_DIR/Chart.yaml" || exit 1
cp "$PRO_CHART_DIR/charts/_distribution/examples/values.yaml" pro-values.yaml
export PRO_VALUES_FILE="$PWD/pro-values.yaml"
```

If you received a chart archive directly, use it instead of the download commands above. Set `PRO_CHART_ARCHIVE` to its absolute path, then extract its bundled files and example values:

```shell
export PRO_CHART_ARCHIVE="/absolute/path/to/pro-${VERSION}.tgz"
test -f "$PRO_CHART_ARCHIVE" || exit 1
tar -xzf "$PRO_CHART_ARCHIVE" -C "$PWD"
export PRO_CHART_DIR="$PWD/pro"
export PRO_CHART_SOURCE="$PRO_CHART_ARCHIVE"
test -f "$PRO_CHART_DIR/Chart.yaml" || exit 1
cp "$PRO_CHART_DIR/charts/_distribution/examples/values.yaml" pro-values.yaml
export PRO_VALUES_FILE="$PWD/pro-values.yaml"
```

Retain the original archive. `PRO_CHART_SOURCE` selects the extracted chart for an OCI download, or the supplied archive itself, for Helm commands. `PRO_CHART_DIR` always selects the extracted bootstrap files and examples. Do not substitute a source checkout or download another version during installation.

Keep this extracted chart and your selected source for bootstrap, configuration, installation and upgrades. For a different chart version, obtain that version and follow its bundled README and bootstrap files.

The public GHCR Pro image needs no registry credentials. Every chart-managed container, including database and rollback Jobs and `helm test`, uses the chart's pinned Pro image. If you use a private mirror, copy that single digest-pinned image and configure node identity, a kubelet credential provider or a registry Secret for the mirror. The chart-wide `imagePullSecrets` list applies to the Pro StatefulSet, every hook and the test Pod.

The released chart pins the Pro workload to an exact image digest, and the tested example inherits that reference. When you mirror Pro, set both `image.repository` and `image.digest` from the copied artifact instead of inventing a version tag.

The old `migrations.image`, `migrations.psqlImage`, `migrations.kubectlImage` and `tests.images.curl` overrides are no longer supported. Remove them when you upgrade from 0.2.x; the chart rejects them instead of silently using another image.

## Example values

This is the tested example values file. Copy it from the chart archive as shown above, or start from this listing and replace the hostnames, OIDC settings, administrator addresses, TLS Secret and PostgreSQL CIDR:

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

Public GHCR defaults pull anonymously, so `imagePullSecrets` stays empty unless you use a private mirror. `persistence.claimTemplateMode: fresh` suits a walkthrough that creates a fresh release. GitOps reconciliation must use `existing` and its request; see [Configuration](#configuration).

## Database bootstrap

Use a dedicated PostgreSQL server or cluster (a separate managed PostgreSQL instance) for each independently administered Xberg deployment. Separate databases or custom login names do not isolate the fixed Xberg capability roles. Do not install independent Pro and Enterprise releases on the same PostgreSQL server: migrations and rollbacks change shared role memberships. This requires a separate PostgreSQL instance, not a separate Kubernetes cluster.

For every fresh PostgreSQL installation, create an empty target database and run the full bootstrap once as its PostgreSQL administrator. `PRO_DB_BOOTSTRAP_MODE=standard` is provider-neutral and requires no superuser authority: it automatically selects the restricted managed-PostgreSQL path for a restricted administrator. AWS RDS and Google Cloud SQL use this same command; the `rds_superuser` and `cloudsqlsuperuser` role names are not admission conditions. The older `cloudsql` mode remains a compatibility alias, not the default.

The restricted path requires PostgreSQL 16 or newer. Its administrator must be a login with direct `CREATEROLE`, `CREATEDB` and target-database `CREATE`. It requires no superuser authority and rejects administrators with `BYPASSRLS` or `REPLICATION`. The administrator must be able to create `uuid-ossp`, `pgcrypto`, `btree_gin` and `vector`, or the provider must preinstall those extensions with routines the administrator can transfer. AWS RDS master users and Google Cloud SQL administrator users normally provide the role and database capabilities, but verify extension availability for the selected engine version. The bootstrap fails before creating Xberg roles when extensions cannot be prepared.

For AWS RDS, set `PGHOST` to the RDS endpoint and `POSTGRES_USER` to the instance master user. For Cloud SQL, set them to the Auth Proxy endpoint and the database administrator; the [Cloud SQL guide](/operate/cloud-sql/) covers that connection setup. Leave `PRO_DB_BOOTSTRAP_MODE=standard` in both cases.

For RDS runtime connections, combine AWS's RDS CA bundle with the Pro image's public roots and mount it with `SSL_CERT_FILE`. Successful bootstrap or migration hooks do not verify the runtime's certificate trust.

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
export PLANNING_EXTENSIONS_FILE="$PWD/pro/charts/_distribution/files/extensions-prepare.sql"
export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${PGHOST}:${PGPORT}/${POSTGRES_DB}"
export MIGRATION_DATABASE_URL="postgresql://xberg_schema_migrator:${POSTGRES_MIGRATION_PASSWORD}@${PGHOST}:${PGPORT}/${POSTGRES_DB}"
export SCHEMA_DIRECTORY=pro/charts/_distribution/files
sh pro/charts/_distribution/files/pro-db-bootstrap.sh
sh pro/charts/_distribution/files/prepare-schema-planning-database.sh
```

The bootstrap creates the planning database while its cleanup-guarded authority can assume `xberg_schema_owner`, then removes that temporary authority before completing the broker handoff. The final helper call validates that managed result and creates the database on self-managed PostgreSQL, whose bootstrap needs no borrowed authority.

Start this initialization procedure on an empty database. If the managed bootstrap was interrupted, rerun the same command with the same administrator and role credentials. It validates the recorded role graph and supported schema layout, then resumes committed transition stages without recreating existing tables or data. Initial schema creation is transactional. Unknown or incomplete schemas and unexpected ownership or grants are rejected before repair. For established installations, use the reviewed upgrade procedure instead of initialization.

An existing vectorscale 0.9.0 or 0.9.1 installation needs the permanent hybrid namespace migration before its next Helm schema migration. Set `PGHOST`, `PGPORT`, `PGDATABASE` and `PGSSLMODE`, then provide three separate nonsuperuser credentials: the extension-owning login with database `CREATE`, the migration login that can `SET ROLE xberg_schema_owner`, and the activation login that can `SET ROLE xberg_vector_index_activation_admin`. The dedicated planning database must be prepared and accessible to the migration login.

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

The command waits up to `EXTENSION_NAMESPACE_QUIESCENCE_TIMEOUT_SECS` for active vector-index DDL, then moves the four relocatable extensions, leaves vectorscale in `public`, validates identities and data, applies `schema.sql`, and reactivates vector-index claims only after a follow-up pgschema plan reports zero steps. Disable the one-time extension login or revoke its database `CREATE` capability after the migration.

New installs already default `migrations.planningDatabaseBootstrap=false`, so Helm validates the existing database. For an upgrade that uses `--reuse-values` and stored the former `true` default, pass `--set migrations.planningDatabaseBootstrap=false` once so the release adopts the new default. Explicit bootstrap requires the one-shot `migrations.planningDatabaseBootstrapDatabaseUrlSecret`; never reuse a runtime, migration or role-admin Secret for that administrator URL. Keep it until a successful deployment sets `migrations.planningDatabaseBootstrap=false`, then revoke it.

The Helm migration hooks reconcile the schema and runtime grants. Store the eight distinct role passwords in your secret manager. Never provide administrator, schema-owner or physical-migration credentials to runtime pods. The role-admin Secret holds the restricted `xberg_role_admin` login; the ownership SQL refuses a superuser. Broker provisioning reaches the capability roles through the `xberg_provision` functions, so the restricted role-admin credential requires no superuser authority.

An earlier upgrade that used a superuser can leave grants behind. Contact [support](/more/support/) for the repair script before the next upgrade. Databases bootstrapped by this guide already contain the broker contract. When you upgrade an older database without that contract, set `migrations.brokerTransitionDatabaseUrlSecret` to a distinct one-time PostgreSQL administrator credential for the legacy role-graph and database-owner cutover. Never reuse that credential as the role-admin Secret. After a successful cutover, clear both `migrations.brokerTransitionDatabaseUrlSecret.name` and `migrations.brokerTransitionDatabaseUrlSecret.key`, verify the next render falls back to the restricted role-admin Secret, and only then delete or rotate the one-time Secret. Rotate or revoke the physical-migration credential after each attempt. Legacy managed databases without the broker contract remain unsupported, because the current cutover requires a true PostgreSQL superuser.

## Secrets

Create the namespace and these seven Secrets for the supplied Ingress example before installing. Percent-encode database URL passwords, and replace the remaining placeholders with the licensed or randomly generated value they name.

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

Run this snippet in Bash or Zsh. The license-file substitution removes CR and LF bytes that text files may end with; Pro requires the exact token, without a trailing newline. The token is not passed in a command argument.

The TLS Secret is unnecessary when `ingress.enabled=false` or your ingress controller issues the certificate.

The default public GHCR Pro image needs no image-pull Secret. Keep `imagePullSecrets: []` unless you select a private mirror; then configure credentials for that registry and list its Secret there.

For OAuth integrations, add both `INTEGRATION_KEK` and `INTEGRATION_STATE_SECRET` to `xberg-pro-secrets`. Each must be the base64 encoding of 32 random bytes. Pro refuses a configuration containing only one of them.

## Configuration

Edit the example copied to `$PRO_VALUES_FILE`, then replace the TLS Secret, public hostname, OIDC settings, administrator addresses and PostgreSQL CIDR. The example names every Secret the chart reads, including the vector-index broker and physical-migration Secrets, so it is the list to work from rather than a subset of it. Keep the release chart's pinned Pro image digest unless you mirrored that exact artifact; a mirror override must set its repository and digest together.

OIDC needs two sets of keys. Pro verifies tokens with `OIDC_ISSUER_URL`, `OIDC_AUDIENCE` and `OIDC_JWKS_URI`, and the dashboard starts the sign-in in the browser with `NEXT_PUBLIC_OIDC_ISSUER_URL`, `NEXT_PUBLIC_OIDC_CLIENT_ID` and `NEXT_PUBLIC_OIDC_REDIRECT_URI`. Setting only the first set gives a Pro that accepts tokens and a dashboard whose sign-in page refuses to start. Set `imagePullSecrets` only when your selected registry requires credentials and node identity cannot provide them.

For PostgreSQL in the same cluster, set `networkPolicy.postgresNamespace` to its namespace and remove `networkPolicy.postgresCidrs`. For PostgreSQL outside the cluster, set `networkPolicy.postgresCidrs` to its reachable CIDRs instead. Add customer-specific destinations under `networkPolicy.extraEgress`. Crawling and webhook delivery reach the public web on the ports in `networkPolicy.publicEgressPorts`, which holds 80 and 443. A crawl seed or a webhook receiver on any other port needs its own `networkPolicy.extraEgress` rule, or the request times out with no message that names the policy. Set `configMap.OTEL_EXPORTER_OTLP_ENDPOINT` only for an in-cluster collector, then set `networkPolicy.otlpNamespace` and `networkPolicy.otlpPort` to match it. Admit an external collector through `networkPolicy.extraEgress` instead.

To explicitly disable authentication, set `configMap.PRO_AUTH_MODE: "disabled"` in your values file. The UI and API then use a persisted Local workspace without OAuth, login or an API key. Omit `JWT_SECRET` and `XBERG_ADMIN_KEY` from the runtime Secret and clear the OIDC values; the database Secrets remain required. Anyone who can reach the service can access this workspace, so restrict network access. The default is `required`; restore that value and the authentication configuration to require login again.

### Storage

The default filesystem storage uses the `/data` PVC. For object storage, set `configMap.STORAGE_PROVIDER` and `configMap.STORAGE_BUCKET`. GCS supports workload identity. S3 uses the default AWS credential chain, including EKS Pod Identity and IRSA; see [AWS storage](/operate/aws-storage/). For explicit S3 credentials, set `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` together in `xberg-pro-secrets`, plus `S3_SESSION_TOKEN` for temporary credentials. For Azure, add `AZURE_STORAGE_ACCOUNT` and `AZURE_STORAGE_ACCESS_KEY` to that Secret.

Keep `configMap.PRO_PUBLIC_API_URL` set to the externally reachable HTTP(S) origin for all storage providers. New upload capabilities use one-use PUT URLs on Pro, which streams the bytes to the configured store; an unset origin makes presign return 503. Route `/v1/uploads/local` directly to Pro and allow request bodies up to `PRO_MAX_UPLOAD_BYTES` at your ingress. The included standard, GKE and Istio routes do this; customer-managed proxies need the same rule.

Pro removes cleanup rows for guarded writers after settlement. It intentionally keeps minimal tombstones for legacy direct-cloud or disconnected writers whose completion cannot be proven, and later sweeps re-delete their exact staging keys. Do not delete these rows or use URL expiry, object absence or lifecycle rules as proof that an old writer settled. Monitor `pro_upload_retained_unknown_writers` and `pro_upload_oldest_unknown_writer_age_seconds` on the health port's `/metrics`; both are global gauges without project labels. The count can remain nonzero after an upgrade, while sustained growth or age beyond the expected legacy population warrants investigation of writer disconnects and cleanup failures.

Keep `migrations.allowDestructive`, `migrations.allowLocking` and `migrations.allowDataRepair` false unless a reviewed, coordinated schema change or data repair requires them. The extracted `pro/values.yaml` lists the complete value surface, and [Pro configuration](/reference/pro-configuration/) lists every environment variable.

### Persistent volume

The default 100 GiB claim reserves about 20 GiB for model and result caches, including the 10 GiB `configMap.CACHE_MAX_BYTES` ceiling. Accepted documents and results are retained with the corpus; upload cleanup only removes expired staging data. Size `persistence.size` above 100 GiB when the retained corpus needs more than the remaining roughly 80 GiB.

`persistence.size` applies to fresh claims. Kubernetes does not resize an existing PVC when this value changes, and the StatefulSet claim template is immutable. Set `persistence.claimTemplateMode: fresh` only while creating a release. A live `helm upgrade` preserves the installed claim template's metadata and spec automatically, including when stored install values still contain `fresh`. Fresh templates use stable labels; existing templates retain their original labels, annotations, access modes, storage class and request across chart and application upgrades.

Argo CD, GitOps and other cluster-blind renderers cannot read the installed template. Use `persistence.claimTemplateMode: fresh` for the initial sync. Before the next sync, capture the installed data template as a values file, then include that file in every subsequent render or sync:

```shell
export RELEASE=pro
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

Keep this captured template unchanged even after expanding the PVC directly. The optional `persistence.existingClaimTemplateSize` must match its captured request; size alone cannot preserve legacy labels and is rejected. Do not delete the StatefulSet or PVC to bypass an immutable-template error. To grow the volume, expand the claim directly:

```shell
export RELEASE=pro
export NAMESPACE=xberg-pro
STATEFULSET="$(kubectl -n "$NAMESPACE" get statefulset \
  -l "app.kubernetes.io/name=pro,app.kubernetes.io/instance=$RELEASE" \
  -o jsonpath='{.items[0].metadata.name}')"
test -n "$STATEFULSET"
DATA_PVC="data-${STATEFULSET}-0"
STORAGE_CLASS="$(kubectl -n "$NAMESPACE" get pvc "$DATA_PVC" -o jsonpath='{.spec.storageClassName}')"
test "$(kubectl get storageclass "$STORAGE_CLASS" -o jsonpath='{.allowVolumeExpansion}')" = true
kubectl -n "$NAMESPACE" patch pvc "$DATA_PVC" --type merge \
  -p '{"spec":{"resources":{"requests":{"storage":"100Gi"}}}}'
kubectl -n "$NAMESPACE" wait pvc "$DATA_PVC" \
  --for=jsonpath='{.status.capacity.storage}'=100Gi --timeout=10m
```

Replace `100Gi` with the new size. When `allowVolumeExpansion` is not true, follow the storage provider's data migration procedure to a larger claim. Do not delete the existing claim.

## Memory

Pro defaults to two retained engines in each Xberg embedding backend and two retained reranker engines. Configure the positive `configMap.XBERG_EMBEDDING_ENGINE_CACHE_MAX_RESIDENT` and `configMap.XBERG_RERANKER_ENGINE_CACHE_MAX_RESIDENT` bounds to retain more. Eviction is least recently used. An active request can keep an evicted engine alive until it finishes, so the count does not form a hard RSS ceiling or guarantee that lowering the count lowers RSS.

Set each bound at least as high as the number of collection presets used concurrently by the instance. A lower bound makes alternating requests rebuild engines after eviction. Recurring RAG warmup defaults off because warming more presets than the bound would rebuild and evict them every 15 minutes. Size `resources.limits.memory` from the models you use and the maximum concurrent jobs. On multi-page scans, peak memory grew by about 140 MB per additional extraction thread in testing; see `PRO_ENGINE_MAX_THREADS` in [Pro configuration](/reference/pro-configuration/#tuning).

## Install

Validate the exact values and install the chart selected above:

```shell
helm lint --strict "$PRO_CHART_SOURCE" -f "$PRO_VALUES_FILE"
helm template xberg-pro \
  "$PRO_CHART_SOURCE" \
  -n xberg-pro -f "$PRO_VALUES_FILE" >/dev/null
helm install xberg-pro \
  "$PRO_CHART_SOURCE" \
  -n xberg-pro -f "$PRO_VALUES_FILE" \
  --wait --timeout 20m
```

## Verification

Wait for the rollout, run the chart tests and forward the service ports:

```shell
kubectl -n xberg-pro rollout status statefulset/xberg-pro --timeout=10m
kubectl -n xberg-pro get pods,services,ingresses
helm test xberg-pro -n xberg-pro --logs
kubectl -n xberg-pro port-forward service/xberg-pro 8080:8080 3000:3000
```

In a second terminal, while the port-forward remains running:

```shell
curl --fail http://127.0.0.1:8080/healthz
curl --fail http://127.0.0.1:8080/readyz
```

`/healthz` proves the process is live. `/readyz` additionally verifies the database identities and object store. Open `http://127.0.0.1:3000` to verify the dashboard sign-in page loads. OIDC sign-in requires the configured public origin and registered redirect URI; use that public URL for the authenticated UI test.

## Troubleshooting

When `helm install` or `helm upgrade` stops with `Job Failed` for a migration hook, read the hook's pod first:

```shell
kubectl -n xberg-pro describe pod -l job-name=xberg-pro-topology-guard
kubectl -n xberg-pro get events --sort-by=.lastTimestamp | grep -i -E 'pull|deadline'
```

An image pull failure is the first cause to check. The pod shows `ImagePullBackOff` with the image name, and the events carry the registry response, for example `401 Unauthorized`. Confirm the image reference and anonymous pull access for the public defaults; for a private mirror, configure its credentials in `imagePullSecrets` and run the same command again. The topology guard pulls the same Pro image as the StatefulSet, so a pull failure stops that first hook within two minutes, and the failed pod stays for inspection. For another hook, replace the `job-name` label value with the Job name from the Helm message.

## Verified migration assets

The chart retains canonical SQL sources for package integrity checks. Migration hooks load those bytes from the Pro image's `/app/db/schema` instead of repeating SQL bodies in Kubernetes ConfigMaps and Helm release storage. The chart records each required file's SHA-256 alongside the hashes of chart-only SQL and shell overlays. A credential-free preflight verifies the whole inventory before topology checks, maintenance fencing, traffic quiescence or role changes. Every consuming pod repeats verification into its own isolated volume; missing or changed bytes fail before execution. The `schema-sql` ConfigMap records a checksum rather than a copy of `schema.sql`.

Published archives pin `migrations.artifactImage.repository` and `.digest` to the tested Pro artifact independently of `image`. A later application image override therefore retains the chart's matching migration toolchain and SQL. Set a separate artifact reference when you test an older application image. A mismatched image fails verification even if its schema version label looks correct.

## Migration modes

`migrations.mode` defaults to `maintenance`, preserving the existing quiescence, role-contract and restoration hooks. `online` renders one restricted schema runner instead. It does not stop workloads, change login privileges or disable vector-index claims. The separate planning database and final broker bridge must already be prepared; online mode cannot bootstrap databases, transfer ownership, repair data or cross a contract rollback boundary.

Online admission requires the shared fleet registry to identify this product. An empty plan needs no admitted worker generation. A nonempty plan additionally requires a release-shipped certificate for the exact source schema fingerprint and ordered SQL hashes, plus a nonempty compatible admitted-generation census. The initial shipped certificate list is empty: online mode currently accepts only a converged no-op. Uncertified upgrades fail before production DDL; select an explicit maintenance procedure instead. No Helm value bypasses certification.

The additive classifier is deliberately limited to nullable, unconstrained columns of simple built-in types. Defaults, backfills, indexes (including `CONCURRENTLY`), role and policy changes, and unknown planner steps are rejected. Classification, source and security revalidation, generation admission and execution share one PostgreSQL transaction. A 5-second lock timeout, 120-second statement timeout, 180-second idle transaction timeout and 300-second Job deadline bound the operation. The planner uses a separate database; temporary production helper functions vanish when the transaction ends. Online mode does not grant privileges or alter the fleet's schema protocol.

When an installation already has a fleet control record, maintenance requires an explicit `migrations.maintenanceOperationId` UUID and `migrations.maintenanceExpectedEpoch` matching the observed control epoch. The first maintenance hook durably fences the fleet before quiescence or role changes; successful completion clears only that operation and its exact resulting epoch. Online migration and deployment promotion reject the fence. A failed operation keeps its fence, including after a lease expires. Preserve the operation UUID, request digest and started epoch; inspect and recover the incomplete operation before explicitly finalizing it. A different operation cannot take over implicitly. A database without a control record can use maintenance for initial bootstrap; online mode refuses it.

Before enabling deployment lifecycle control on an existing database, install the release's `deployment-controller-roles-bootstrap.sql` supplement with the provider bootstrap authority. Restricted upgrade credentials cannot create this role topology. PostgreSQL 15 receives only compatibility placeholder roles; deployment controller APIs require PostgreSQL 16 or later. This applies to every install bootstrapped before chart 0.5.0, including an upgrade from 0.4.x, whose migration otherwise stops with `role "xberg_deployment_owner" does not exist`.

On AWS RDS, Cloud SQL and other managed PostgreSQL without a superuser, run the supplement once as the administrator that ran the restricted bootstrap (for RDS, the instance master user), from the extracted chart's `charts/_distribution/files` directory, which holds the release's complete SQL:

```bash
psql -X -v ON_ERROR_STOP=1 -h "$PGHOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --file=deployment-controller-roles-bootstrap.sql
```

It arms `xberg_role_root` only inside its own transaction, creates the three roles as that root, disarms it and validates the sealed topology before committing. Do not grant the root `CREATEROLE` or a `SET` edge by hand. A rerun changes nothing, and any other login is refused.

A restricted install bootstrapped before the maintenance recovery role needs the release's `maintenance-recovery-role-bootstrap.sql` supplement before the chart upgrade. Run it once as the administrator that ran the restricted bootstrap, with `--set=role_admin_login=xberg_role_admin`. It creates `xberg_maintenance_recovery`, installs the two broker functions that grant and revoke it, and grants the role administrator EXECUTE on them. A rerun changes nothing. Until it runs, the chart's role hook and the bootstrap script refuse and name the supplement.

The internal native executor's format-2 operation manifest can bind `service_contract_digest` before the operation begins. This versioned SHA-256 covers the complete server-returned Service `spec`; only the value of the `xberg.io/generation-id` selector is normalized. Ports, target ports, addresses, other selector constraints and all other spec fields remain bound. Hash the observed Service through `service_contract_digest`, not Helm source. Preparation and recovery reject a changed bound spec before acquiring mutation authority.

Older format-2 requests without this field remain eligible only for preparation and health qualification. They cannot qualify routing. Adding or changing the field changes the immutable operation request digest, so it cannot retrofit an existing operation during recovery. This contract does not enable chart blue/green mode or restore the disabled certification and admission permissions.

Native lifecycle qualification requires every observed Pod image digest to equal its registered generation's image digest. An [OCI image index](https://github.com/opencontainers/image-spec/blob/main/image-index.md) references separate platform manifests; matching the index digest to a different platform digest is not inferred or accepted through an operator allowlist. Supply the selected platform manifest and its exact configuration bytes; the operator binds their digests to the observed node platform. Registration and configuration receipts alone do not certify or admit a generation. Run the packaged operator's actual Kubernetes, runtime-health and cross-Pod storage qualification before promotion.

For a database whose roles are already provisioned, explicitly enable `migrations.schemaBridge.bootstrapEnabled` and set `migrations.schemaBridge.databaseUrlSecret.name` and `.key` to a dedicated, one-shot provider credential. That login must already be allowed to `SET ROLE xberg_role_root`, and the root must have target-database `CREATE`; the hook grants neither capability and does not rearm `CREATEROLE`. It records the exact active receipt before the maintenance fence and checks existing table rows, so an empty registry table is accepted and an installed registry is rejected. Disable this option after the successful initialization. The bridge-aware Cloud SQL role bootstrap handles its own initializer; the two options cannot run together.

For a self-managed database initialized by the standard superuser bootstrap, the existing restricted `xberg_role_root` placeholder does not receive database `CREATE` automatically. Before enabling this bridge, connect to the target database as the provider authority and grant only that capability to the existing restricted role. Do not create a replacement root, change its attributes or grant `CREATEROLE`. The following also checks that this provider session can assume root; it creates no role memberships.

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

Migration hooks require `READ COMMITTED` and reject a different transaction default before waiting for the schema lock.

Bootstrap-only Cloud SQL installs require `migrations.maintenanceManifest.enabled: true`, an explicit `maintenanceOperationId` and `maintenanceManifest.installationId: unbound`. Keep them unchanged through the normal migration phase. The manifest requires immutable migration image digests and binds the exact packaged assets and a conservative hash of resolved values. It excludes only the migration enable switch, the Cloud SQL bootstrap Job enable switch and the provider bridge bootstrap enable switch. A Helm revision is not content identity. An installed registry requires its actual UUID instead of `unbound`; a mismatched identity fails before maintenance effects. The manifest contains hashes rather than secret values.

The protected schema bridge records the exact maintenance operation and schema digest before managed role bootstrap. Its completed receipt binds permanently to the first installation UUID. Legacy maintenance without a receipt remains unqualified for deployment control. A failed migration leaves the active receipt in place; values changes, expired leases and retries cannot clear it. See [Recover a failed bootstrap migration](#recover-a-failed-bootstrap-migration). Controller APIs are revoked before public schema replay and installed and verified separately afterward, before application restoration. Online no-op migration does not run this controller installer or provision deployment authority.

Lifecycle configuration sealing requires `automountServiceAccountToken: false`, digest-pinned container images, and immutable ConfigMaps and Secrets. The versioned digest covers the full server-returned PodTemplate and the exact referenced object UIDs, resource versions and content hashes. Only the template's `xberg.io/config-digest` annotation and `PRO_DEPLOYMENT_CONFIG_DIGEST` self references are normalized. Runtime registration compares this certificate; it does not attest to the Kubernetes template itself.

Replicated qualification excludes PVC-backed models, CSI and arbitrary sidecar or service-account token injection. Use an approved shared object store. Explicit EKS Pod Identity and IRSA credential injection are supported through the selected AWS profile and verified against the actual admitted Pod specification. The packaged native and Argo adapters qualify complete generations before red/green promotion; rendering a workload or cloning its template does not establish runtime health, shared storage or rollout availability.

Online planner URLs currently support an ordinary `postgres://user:password@host:port/database` URI with an optional `sslmode` query parameter. Percent-encoded credentials, IPv6 literals and additional URI options are rejected before planning. Maintenance retains its existing connection behavior. A successful online no-op does not establish application availability or authorize an older binary against a newer schema.

## Recover a failed bootstrap migration

A bootstrap migration that fails leaves the bridge receipt active on its operation. This section explains when a retry is enough and how to replace the failed operation with a corrected one.

### The same-input retry limit

A retry with the same chart and the same values resumes the failed operation. Any change to the chart or the values changes the request digest, and the maintenance hook then refuses to begin. A corrected chart therefore cannot resume the failed operation.

The recover action replaces the failed operation with a new one and records the replacement. It never marks the failed operation completed. The new operation completes through the ordinary migration hooks.

### What recovery accepts

Recovery applies only to a bootstrap: no installed registry, an unbound bridge, installation `unbound` and epoch 0. The target schema must not change. The request must change; for an unchanged request, retry instead. Recovery recomputes both request digests from the manifest files and refuses a file whose digest does not match. If another session of a migration or maintenance login is connected, recovery refuses. A session that waits for the schema migration lock does not count.

### Stop the release first

The database checks cannot see Kubernetes, so do these steps before recovery:

1. Stop every reconciler of the release. Suspend Argo CD automated sync, and do not run `helm upgrade`.
2. Wait until every migration hook Job of the failed release has stopped.
3. Delete the Jobs and Pods of the failed operation, and make sure that none remain.

### Grant the recovery role

A login that recovers needs both `xberg_maintenance` and `xberg_maintenance_recovery`. Grant the second to the maintenance login as a superuser of a self-managed database:

```sql
GRANT xberg_maintenance_recovery TO maintenance_login WITH ADMIN FALSE, INHERIT FALSE, SET FALSE;
```

On Cloud SQL and other managed services, only the role broker holds ADMIN on `xberg_maintenance_recovery`. Connect as the restricted `xberg_role_admin` login and call the broker function:

```sql
SELECT xberg_provision.grant_maintenance_recovery_to_login('maintenance_login');
```

The function refuses a login that is not a maintenance login or that does not hold `xberg_maintenance`. A second call for a login that already holds the role changes nothing. If the install was bootstrapped before the recovery role existed, run the `maintenance-recovery-role-bootstrap.sql` supplement first, as described under [Migration modes](#migration-modes).

### Render the two manifests

Render the manifest of the failed operation from the chart and values of the failed release. Render the manifest of the new operation from the corrected chart and values, with a new `migrations.maintenanceOperationId`. Use the release name and namespace of the installation for both renders.

```shell
manifest() {
  printf '%s' "$(helm template xberg-pro "$1" --namespace xberg-pro -f "$2" \
    --show-only templates/migrations/maintenance-manifest.yaml | yq '.data."manifest.json"')"
}
manifest "$FAILED_CHART_DIR" failed-values.yaml > predecessor-manifest.json
manifest "$PRO_CHART_DIR" corrected-values.yaml > successor-manifest.json
sha256sum predecessor-manifest.json successor-manifest.json
```

The first digest must equal the request digest of the active bridge receipt. Read that receipt, with its operation, target schema digest and revision, as the maintenance login:

```sql
SELECT state, operation_id, request_digest, target_schema_digest, revision
FROM xberg_deployment_bridge.deployment_schema_bridge;
```

### Run the recover action

Run the maintenance fence script of the corrected chart from the operator machine. The script takes the schema migration lock and checks every condition before it changes the bridge.

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

The bridge is then active on the new operation at the next revision. The table `xberg_deployment_bridge.deployment_schema_bridge_recovery` holds one row with both operations, the reason and the login. If the acknowledgement is lost, run the same command again: it succeeds and changes nothing.

### Revoke the recovery role

Revoke the grant before you run `helm upgrade`. The chart's role hook refuses a maintenance login that holds `xberg_maintenance_recovery`, so the upgrade fails while the grant remains. As a superuser of a self-managed database:

```sql
REVOKE xberg_maintenance_recovery FROM maintenance_login;
```

On Cloud SQL and other managed services, connect as `xberg_role_admin` and call the broker function instead:

```sql
SELECT xberg_provision.revoke_maintenance_recovery_from_login('maintenance_login');
```

The function raises an error if the login still holds the role through a grant that the role broker did not make.

### Finish the migration

Run `helm upgrade` with the corrected chart and values. The ordinary hooks begin the new operation and finalize it. They do not need the recovery role. The failed operation can no longer begin or finalize.

### The administrative boundary

The recovery history refuses UPDATE, DELETE and TRUNCATE for every role while its trigger is enabled. The owner of the history table, `xberg_role_root`, and a superuser can disable that trigger. On Cloud SQL and other managed services, the provider administrator holds ADMIN on `xberg_role_root` and can therefore reach the owner role. Treat these credentials as administrative credentials.

The maintenance role keeps write access to the bridge table, because the begin and finalize hooks use it. A login with that role can therefore change the bridge without a history row. Treat the maintenance credential as an administrative credential: the history records only the changes that the recover action makes.

## Upgrade and rollback

Rollback requires stable external credential Secrets in both the current and target revisions. Keep the application, maintenance, migration, role-admin and vector-worker Secret references stable. Keep their values available throughout the operation; embedded chart credentials deliberately block rollback. A values-only rollback validates the existing broker contract and desired physical schema before running the normal schema planner. It does not reverse broker ownership or widen migration privileges.

Back up PostgreSQL and the object store before an upgrade; see [Backup and restore](/operate/backup-and-restore/). For a configuration-only change, keep the installed chart version and use the selected chart source matching that version. The command refuses a different chart version; retain the guarded migration pipeline:

```shell
export VERSION=$(helm get metadata xberg-pro -n xberg-pro -o json | jq -er .version)
helm show chart "$PRO_CHART_SOURCE" | grep -Fxq "version: $VERSION" || {
  printf 'Use the chart archive matching the installed version for configuration-only upgrades.\n' >&2
  exit 1
}
helm upgrade xberg-pro \
  "$PRO_CHART_SOURCE" \
  -n xberg-pro -f "$PRO_VALUES_FILE" \
  --set migrations.enabled=true \
  --rollback-on-failure --wait --timeout 110m
helm history xberg-pro -n xberg-pro
export REVISION=1
helm rollback xberg-pro "$REVISION" -n xberg-pro \
  --wait --wait-for-jobs --timeout 110m
```

With the migration pipeline enabled, the chart stops the Pro StatefulSet before the database hooks run. The ordered post-upgrade hooks restore the recorded replica intent, including zero, and enable vector-index claims when configured. These hooks do not wait for workload readiness. A failed pre-upgrade hook restores that intent unless the vector bridge is absent during its physical transition; that gap keeps Pro stopped for a corrected retry.

If the main resource apply or the readiness wait fails after successful pre-upgrade hooks, resources may be partially applied and post-upgrade hooks are skipped: Pro stays quiesced and claims remain disabled. Inspect `helm history xberg-pro -n xberg-pro`, `helm get hooks xberg-pro -n xberg-pro` and the failed resources. Preserve the actual, reviewed operator configuration; saved Helm values may omit direct ConfigMap or workload changes. Reconcile field ownership conflicts without blindly forcing those settings away. Verify the target chart, image and database ownership-contract compatibility, then retry the same reviewed target upgrade with `migrations.enabled=true`. Let its ordered hooks restore replica intent and enable configured claims. Separately verify the recorded replica intent, the configured claims state and Pro readiness. When the intended replica count is one, wait for the restored pod to become Ready and run `helm test xberg-pro -n xberg-pro` before resuming traffic. Preserve an intended zero replica count; do not start Pro merely to run the health test.

If that upgrade cannot complete, contact [support](/more/support/) to validate the partially applied resources and actual database phase before running the target revision's restore and claims-enable procedures. Scaling alone does not complete recovery. Do not use automatic rollback as a universal recovery procedure across database contract boundaries. A deliberate manual scale persists across upgrades; change it only after verifying the release is healthy and confirming the intended replica count. Never replace recorded zero intent with an unconditional scale to one.

For a chart-version upgrade, render and review the target chart and its migration notes first. Keep the migration pipeline enabled so its contract checks protect both upgrades and rollbacks. Do not use native `helm rollback` across a database ownership-contract boundary. Stop and contact [support](/more/support/) for a version-specific rollback plan, including the privileged administrator grants and the ordered rollback hooks. This guide does not provide that privileged procedure; do not infer it from the normal rollback command above. The 110-minute timeout covers the default rollback pipeline; raise it if you increase any migration, vector-index or readiness deadline.

The migration and rollback hooks call the Kubernetes API, and `networkPolicy.enabled=true` leaves their pods out of the chart policy so they can reach it. A policy of your own that selects every pod in the namespace selects these hooks again, so it must admit the exact Kubernetes API destination CIDRs and TCP ports your cluster enforces after Service address translation. Do not open all private ranges. Apply and verify that rule before an install or a support-coordinated ownership rollback, because the quiesce and restore hooks fail on a deadline when they cannot reach the API. See also [Upgrades](/operate/upgrades/).
