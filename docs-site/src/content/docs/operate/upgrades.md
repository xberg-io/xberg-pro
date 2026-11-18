---
title: Upgrades and migrations
description: Upgrade Xberg Pro (Docker Compose and Helm) and Xberg Enterprise, including the maintenance interval, database migrations and rollback limits.
sidebar:
  order: 7
---

**Available in:** Pro, Enterprise

Upgrades run database migrations. The packaged hooks stop the application while the role and schema migrations run, so an upgrade has a maintenance interval and is not zero-downtime. Plan the interval, back up first, and read the release notes of the target version before you start.

## Before every upgrade

1. Back up PostgreSQL and the object store. See [Backup and restore](/operate/backup-and-restore/).
2. [Verify the target chart](/operate/helm-distribution/) and read its bundled README and migration notes. Do not substitute a different chart version during an upgrade.
3. Keep Secret references stable. Rollback needs stable external credential Secrets in both the current and target revisions. On Enterprise set `secrets.create=false`. Chart-embedded credentials deliberately block rollback.
4. Use the same Pro image digest the target chart pins, or mirror both together. See [Air-gapped installation](/operate/air-gapped/) for mirroring.
5. Keep the migration pipeline enabled (`migrations.enabled=true`), so its contract checks protect both upgrades and rollbacks.

## What the migration does

On Helm, ordered hooks run in this sequence:

1. Record the current replica count and drain the workloads.
2. Apply the role contract with the role-administrator login. Then, as the schema owner, apply the extensions, the policy audience changes and the declarative schema, and rebuild the runtime grants.
3. Restore the recorded replica count, including zero, and enable vector-index claims if configured.

A failure before the schema change restores the recorded replica intent. A failed migration, grants, controller or runtime-contract hook keeps Pro stopped and preserves the recorded count for a corrected retry, as does the vector bridge gap during a physical transition. See [Recover a failed Pro migration](/operate/deployment-operator/#recover-a-failed-pro-migration). The post-upgrade hooks do not wait for workload readiness, so verify readiness yourself.

Migration hooks need `READ COMMITTED` and reject a different transaction default. They call the Kubernetes API. If `networkPolicy.enabled=true`, the chart policy leaves their pods out so they can reach it. A NetworkPolicy of your own that selects every pod in the namespace selects the hooks again, so it must admit your cluster's Kubernetes API destination CIDRs and TCP ports, as enforced after Service address translation. Do not open all private ranges.

## Pro on Docker Compose

Do not use a plain `docker compose up` to upgrade a running installation. Dependency order alone does not drain the old application before the migration. Pull or select the target Pro image first, then run the upgrade script from the Compose bundle of that release, with the same environment file, Compose overrides and project name as the installation:

```bash
./scripts/pro-upgrade.sh --env-file .env --project-name my-pro
```

The script stops Pro (respecting the configured stop grace period), verifies it stopped, runs the database bootstrap, starts the prepared image, checks health and enables worker claims. It does not build the image during maintenance. A bootstrap, startup or claims failure leaves Pro stopped. Correct the error and rerun the same command.

Keep the administrator password and the eight role passwords stable between routine restarts. Changing one is a credential rotation, and restarts must then use the matching new URL.

## Pro on Helm

For a configuration-only change, keep the installed chart version and use the chart source that matches it. Set `PRO_CHART_SOURCE` to the extracted chart directory (or the chart archive) and `PRO_VALUES_FILE` to your values file, as in the [Pro Helm install](/start/pro-helm/#download-the-chart). The check below refuses a different version:

```shell
export PRO_CHART_SOURCE=/path/to/pro
export PRO_VALUES_FILE=/path/to/pro-values.yaml
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
helm test xberg-pro -n xberg-pro
```

For a chart-version upgrade, render and review the target chart first, then run the same `helm upgrade` against the new chart source. The 110-minute timeout covers the default pipeline. Raise it if you increase any migration, vector-index or readiness deadline.

### If an upgrade stops partway

If the main resource apply or readiness wait fails after the pre-upgrade hooks succeed, resources can be partly applied and the post-upgrade hooks are skipped. Pro then stays quiesced with claims disabled. Inspect the release and its hooks:

```shell
helm history xberg-pro -n xberg-pro
helm get hooks xberg-pro -n xberg-pro
```

Verify the target chart, image and database ownership-contract compatibility, then retry the same reviewed upgrade with `migrations.enabled=true`. The ordered hooks restore replica intent and enable configured claims. Verify the recorded replica count and the claims state separately. When the intended count is one, wait for the pod to become Ready and run `helm test` before you resume traffic. Preserve an intended replica count of zero, and never replace it with an unconditional scale to one. Scaling alone does not complete recovery. If the upgrade cannot complete, contact support.

### Version-specific notes

- **0.4.0 and later.** The bundled PostgreSQL subchart and the independent `migrations.image`, `migrations.psqlImage`, `migrations.kubectlImage` and `tests.images.curl` values are removed. Provision PostgreSQL separately and remove those values from your overrides. A `--reuse-values` upgrade from 0.3.3 keeps the removed values and fails with a migration message, so use a reviewed values file with the current Secret references and the single image digest.
- **A database bootstrapped before chart 0.5.0.** This includes an upgrade from 0.4.x. Install the release's `deployment-controller-roles-bootstrap.sql` supplement first, or the migration stops with `role "xberg_deployment_owner" does not exist`. Restricted upgrade credentials cannot create these roles. Run it once as the administrator that ran the restricted bootstrap (on RDS, the instance master user), from the extracted chart's `charts/_distribution/files` directory. PostgreSQL 15 receives only placeholder roles, and the deployment controller APIs need PostgreSQL 16 or later. A rerun changes nothing, and any other login is refused.

  ```bash
  psql -X -v ON_ERROR_STOP=1 -h "$PGHOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    --file=deployment-controller-roles-bootstrap.sql
  ```

- **A restricted install bootstrapped before the maintenance recovery role.** Run the release's `maintenance-recovery-role-bootstrap.sql` once, as the same administrator and with `--set=role_admin_login=xberg_role_admin`, before the chart upgrade. Until then the chart's role hook and `scripts/pro-db-bootstrap.sh` refuse and name the supplement.
- **Restricted bridge write permissions.** Before you deploy a chart that restricts the schema bridge functions, finish the previous maintenance operation and pause its reconcilers. From the new release's SQL assets, run `deployment-schema-bridge-control-upgrade.sql` with the existing migration login, then `deployment-schema-bridge-upgrade.sql` with the provider login that can assume `xberg_role_root`, passing `--set=bridge_installation="$INSTALLATION_ID"` to both. For a bridge never bound to an installation, run only the second with `bridge_installation=unbound`. Both scripts can be rerun. To roll the maintenance chart back across this change, finish the operation, then run the same two scripts with `--set=bridge_restore_legacy=true`, provider script first, before you install the older hooks.
- **Keeping the public Service during a singleton upgrade.** To retain a Helm-installed public Service, set `service.ownershipBridge.name` and `service.ownershipBridge.uid` to its exact name and Kubernetes UID. The Service must belong to the same release and namespace with the same routing spec. The chart then adds `helm.sh/resource-policy: keep` to the stored Helm revision. Confirm with `helm get manifest`, and check that no GitOps controller prunes the Service. It does not cover switching to replicated mode, uninstalling the release or changing GitOps pruning.
- **Online migrations.** `migrations.mode=online` runs a restricted schema job without stopping workloads. It accepts only a converged no-op or a transition covered by a certificate shipped in the chart, and refuses otherwise before any change. See [Approve a certified online schema change](/operate/deployment-operator/#approve-a-certified-online-schema-change).
- **Upgrading a database initialized with the bundled bootstrap to 0.4.7 or later.** Rerun the target chart's packaged `pro-db-bootstrap.sh` with the same administrator, database and eight role passwords (see the [Pro Helm install](/start/pro-helm/#database-bootstrap)), and keep `PRO_DB_INITIALIZE_SCHEMA=true`. The script validates the existing layout, preserves data and restores the vector index owner's `USAGE` privilege on the schema that holds pgvector. The migration login cannot grant it on an administrator-owned extension schema. Afterward, request a new build for each collection whose index job failed before the repair.
- **vectorscale 0.9.0 or 0.9.1.** An installation with these versions needs the permanent hybrid namespace migration before its next Helm schema migration. Run `migrate-extension-namespace.sh` from the chart's `charts/_distribution/files` with `XBERG_EXTENSION_NAMESPACE_MIGRATION_ACK=permanent-hybrid-v1` and three separate nonsuperuser credentials. Disable the one-time extension login afterward.
- **Planning database.** New installs default `migrations.planningDatabaseBootstrap=false`. An upgrade that uses `--reuse-values` and stored the former `true` default needs `--set migrations.planningDatabaseBootstrap=false` once.
- **RAG model cache.** The chart no longer sets `XBERG_RAG_MODEL_CACHE_DIR`. After `helm upgrade --reuse-values`, Pro starts, ignores the old value and logs one warning. Once retrieval and reranking work on the upgraded pod, delete the orphaned copies with `kubectl exec -n xberg-pro xberg-pro-0 -- sh -c 'rm -rf /data/rag-models/models--*'`. The command leaves the live cache under `/data/rag-models/hf` alone.
- **Memory request.** A chart version raised the default `resources.requests.memory` from `1Gi` to `16Gi`. A node pool sized for the old default can leave the pod `Pending` with `Insufficient memory`. Override the request or size a node pool to fit before you upgrade.

## Enterprise on Helm

Review the target release's image versions and migration notes, render the target chart with your values, then run `helm upgrade` with the same wait options you used for the install. Repeat the adapter-specific rollout checks from your install guide, confirm hooks and workloads succeed, run `helm test`, and verify an authenticated extraction with a non-sensitive document.

Every upgrade drains the application workloads before the migration hooks run, so the release serves no traffic for the length of that drain. `migrations.schemaOwnershipQuiescenceSeconds` bounds it. A failed hook leaves the workloads drained and their autoscalers detached. Fix the cause and run the upgrade again, or roll back. Native rolling updates alone do not provide online database migrations or uninterrupted upgrades.

Keep `--server-side=false` for Helm upgrades. Client-side apply avoids ownership conflicts when the Argo Rollouts controller normalizes resource quantities, for example `2000m` to `2`.

For an external KEDA installation, install its CRDs first. For bundled KEDA, install with `keda.crdsPreinstalled=false`, then upgrade with `keda.crdsPreinstalled=true` once the CRDs and operator are ready. Without it, the chart renders no ScaledObject.

Replicated deployments (`deployment.mode=replicated`), on Pro and Enterprise, do not use `helm upgrade`. The [deployment operator](/operate/deployment-operator/) owns generation rollouts.

## Rollback

`helm rollback` works for values-only changes and for versions that do not cross a database ownership-contract boundary:

```shell
helm history xberg-pro -n xberg-pro
helm rollback xberg-pro REVISION -n xberg-pro --wait --wait-for-jobs --timeout 110m
```

A values-only rollback validates the existing broker contract and the desired physical schema before it runs the schema planner. It does not reverse broker ownership or widen migration privileges. A rollback that crosses a schema change plans a drop, and the schema job refuses it and names the object. Set `migrations.allowDestructive=true` on that rollback only when the drop is intended and your backup is current. Keep `migrations.allowLocking` and `migrations.allowDataRepair` false unless a reviewed, coordinated schema change or data repair requires them.

Helm rollback cannot undo database data changes. Do not use native `helm rollback` across a database ownership-contract boundary. Stop and contact support for a version-specific rollback plan. Retain old image and chart versions and database backups until you accept the upgrade.

For a support-coordinated ownership rollback, make sure any NetworkPolicy of your own that selects migration hooks permits your Kubernetes API destination CIDRs and ports. Apply and verify that access first, and remove temporary allowances after acceptance.
