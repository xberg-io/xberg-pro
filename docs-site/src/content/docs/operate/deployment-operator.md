---
title: Deployment operator
description: Install and roll out replicated Pro and Enterprise deployments with the deployment operator that ships in the Helm chart archive.
sidebar:
  order: 2
---

**Available in:** Pro, Enterprise (replicated deployments only)

## When you need it

A default install runs one Pro pod and upgrades with `helm upgrade`. You need the deployment operator only for a **replicated** deployment: `deployment.mode=replicated`, with two or more pods on distinct nodes and shared object storage.

A replicated release is not upgraded with `helm upgrade`. Each rollout installs the whole fleet again as a new Helm release, and the operator moves traffic to it behind one stable Service.

The operator is a set of Python commands that ship in the chart archive. It is proprietary software under the archive's `LICENSE`, and it installs no tools and creates no cloud resources.

Use it when you need planned rollouts with no HTTP errors. For everything else, use the [Pro Helm install](/start/pro-helm/) or the [Enterprise Helm install](/start/enterprise-helm/).

## Terms

| Term       | Meaning                                                                                                                                      |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Generation | One Helm release of the whole fleet. A rollout installs a new generation and retires the old one.                                            |
| Cohort     | The components of one generation (API, worker, optional webhooks) that are checked and switched together.                                    |
| Qualify    | The operator's checks before a generation takes traffic, including a proof that all pods share the same object storage.                      |
| Receipt    | A stored record of a completed step, such as a schema migration or a published component.                                                    |
| Lease      | A time-limited claim that a running command holds on its operation. If the command dies, recovery is possible only after the lease expires.  |
| Epoch      | The installation's current state counter. Passing it as `--expected-epoch` makes the operator refuse a command that works from a stale view. |
| Fence      | A marker that keeps the workload stopped until maintenance finishes.                                                                         |

## Prerequisites

- Python 3.11 or newer, `kubectl` and `psql` on the machine that runs the commands.
- A Kubernetes context you pass explicitly with `--context`. Kubernetes 1.29 or newer.
- Shared object storage that every pod can reach. Filesystem storage and PVC-backed models are not supported in replicated mode. See [Object storage](/operate/storage/).
- Two to 32 replicas per generation, each on a distinct node, and image digests that point to a single-platform manifest that matches your node architecture.
- A PostgreSQL database prepared with the chart's bootstrap files. See [Cloud SQL and managed PostgreSQL](/operate/cloud-sql/).
- A customer-managed HTTP load balancer, described below.
- For Enterprise with Argo Rollouts, an Argo Rollouts controller that you install yourself. Native mode needs no Argo.

## Get and verify the operator

Pull the chart, [verify it](/operate/helm-distribution/), then unpack the operator and run its self-check. For Enterprise, replace `pro` with `xberg-enterprise`.

```sh
export CHART_VERSION=REPLACE_WITH_CHART_VERSION
helm pull oci://us-central1-docker.pkg.dev/xberg-public-assets/helm-charts/pro \
  --version "$CHART_VERSION" --untar
tar -xzf pro/charts/_deployment-operator.tar.gz
cd deployment-operator
export PYTHONDONTWRITEBYTECODE=1
python3 verify.py
```

`verify.py` fails on any changed or extra file, including Python bytecode caches. Keep the directory unmodified and store your request and result files outside it. The chart guide is `charts/_distribution/README.md` in the extracted archive.

Each command prints its usage with `--help`:

```sh
python3 scripts/deployment-installation.py --help
python3 scripts/deployment-lifecycle.py --help
python3 scripts/deployment_lifecycle_native_initial.py --help
python3 scripts/deployment_lifecycle_native_enterprise_initial.py --help
python3 scripts/deployment_lifecycle_argo_initial.py --help
python3 scripts/deployment_lifecycle_argo_enterprise_initial.py --help
```

## Configure the load balancer

Put a load balancer or ingress that you manage in front of the operator-owned installation Service. Keep the per-generation ingress disabled. The chart bundles no proxy, and Kubernetes Service balancing alone does not meet this requirement.

During a rollout the operator moves the Service to the new generation, waits 30 seconds, then drains the old one. Your load balancer must stop sending requests to the old pods inside that window.

1. Keep client connections open while the load balancer picks upstream pods independently.
2. Retire upstream connections within a hard maximum age well below 30 seconds (for example 20), or do not reuse them. An idle timeout alone does not do this. Retiring a connection must not cancel requests already in flight.
3. Make new upstream connections follow the Service's current endpoints. A proxy pinned to the Service ClusterIP may never see pods leave.
4. Keep the time from the new pods becoming ready until the last request reaches the old pods, plus the time that request needs to upload, validate and be accepted, under 30 seconds with margin. Uploads that can run longer are outside the zero-error guarantee.
5. Test it. Use long-lived clients through a three-step sequence (A to B to C), with a slow POST in flight during one switch, and no client or proxy retries. Confirm that the POST creates exactly one job and returns its result. A passing readiness probe is not this test.
6. Set `deployment.traffic.connectionDrainingConfirmed=true`. The chart only checks this boolean and does not inspect your load balancer.

A sudden pod or node loss can still drop in-flight connections. Accepted jobs recover on their own, but never resubmit an uncertain POST automatically. Database and Enterprise NATS failover remain your responsibility.

## Install the first generation (Pro)

Prepare the immutable request file for the first generation, the platform image manifest and the image configuration bytes (`--request`, `--manifest`, `--configuration`). Use the digests of the images your pods actually run. The image must include `/app/xberg-storage-challenge`, which the Pro image does.

Install the generation's Helm release first, then run three steps. Each takes the same arguments:

```sh
export ARGS="--request ../initial.json --manifest ../image-manifest.json \
  --configuration ../image-config.json --context $KUBE_CONTEXT"
python3 scripts/deployment_lifecycle_native_initial.py observe $ARGS
DEPLOYMENT_MAINTENANCE_DATABASE_URL="$MAINTENANCE_URL" \
  python3 scripts/deployment_lifecycle_native_initial.py qualify $ARGS
python3 scripts/deployment_lifecycle_native_initial.py ready $ARGS
```

| Step      | What it does                                                                                                                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `observe` | Reads the cluster and checks pods, configuration, image identity and node placement.                                                                                                                               |
| `qualify` | Writes test objects from every pod and reads them back from every other pod, to prove they share storage. Then it removes the test objects and admits the generation. Needs `DEPLOYMENT_MAINTENANCE_DATABASE_URL`. |
| `ready`   | Checks that the browser UI and API answer. Admission alone does not prove it. The Service must keep `publishNotReadyAddresses: false`.                                                                             |

To verify, run `kubectl get pods` for the release and call the public URL's `/readyz` through your load balancer.

For very large generations, set `XBERG_STORAGE_PROOF_PROFILE=two-witness-star/v1` on `qualify` to cut the number of storage checks. Install the matching schema migration and operator version first. An older database rejects the setting.

## Roll out a new generation (Pro)

1. Install the candidate as a new Helm release with `helm install`, not `helm upgrade`.
2. Register it. The first command prints the SQL for review, and the second applies it. It needs `DEPLOYMENT_MAINTENANCE_DATABASE_URL`.

   ```sh
   python3 scripts/deployment-installation.py generation-registry-sql --config ../pro-candidate.json
   python3 scripts/deployment-installation.py register-generation --config ../pro-candidate.json
   ```

   Registration refuses when an operation is active or the installation, schema, storage or policy are incompatible. Repeating an identical registration is safe. It does not qualify the generation or move traffic.

3. Qualify, promote, drain and retire the old generation:

   ```sh
   python3 scripts/deployment-lifecycle.py prepare --config ../operation.json \
     --context "$KUBE_CONTEXT" --qualify-native --promote-native --drain-native --finalize \
     --image-manifest ../candidate-manifest.json --image-configuration ../candidate-config.json
   ```

   For an image upgrade, also pass `--source-image-manifest` and `--source-image-configuration` for the running generation. `--finalize` waits for the old generation's accepted work, scales it to zero and confirms its pods are gone. The candidate keeps serving throughout. Finalization has a 600-second budget.

4. Verify that the old pods are gone, the Service selects the new generation and a test extraction succeeds.

Declare `source_workload_spec_digest` in `operation.json` before you start if you use `--finalize`. It pins the old Deployment so the operator can prove it retired the right one. Compute it from the live Deployment with replicas set to zero:

```python
import copy, hashlib, json

spec = copy.deepcopy(source_deployment["spec"])
spec["replicas"] = 0
encoded = json.dumps(spec, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()
source_workload_spec_digest = "sha256:" + hashlib.sha256(encoded).hexdigest()
```

Keep every server-defaulted field. A change to the Deployment after you compute the digest fails the operation. You cannot add the digest to an operation that already started.

## Recover an interrupted operation

If a command is interrupted, do not start another operation and do not apply Kubernetes changes by hand.

1. Keep the original request files and the status output.
2. Wait until the interrupted command's lease has expired.
3. Rerun with the same files and flags, replacing `prepare` with `recover`:

   ```sh
   python3 scripts/deployment-lifecycle.py recover --config ../operation.json \
     --context "$KUBE_CONTEXT" --qualify-native --promote-native --drain-native --finalize \
     --image-manifest ../candidate-manifest.json --image-configuration ../candidate-config.json
   ```

Recovery re-establishes the route to the new generation and continues retiring the old one. It does not replay a scale change whose result is unknown.

If the interruption happened during the storage check, add `--abandon-native-storage` to `recover` with `--qualify-native`. The operator discards that attempt's results, starts a fresh check and requires a complete pass before admission. This option cannot be combined with a recovery that already moved traffic.

It deletes nothing. The test objects the interrupted run wrote stay in the bucket and are listed under `cleanup_debt` in the status output. They contain only synthetic bytes, so delete them once storage activity has stopped.

An initial installation that failed or stopped uncertain cannot be retried blindly. Keep the stored challenge identity, clean up its exact test keys, then start again. Never replay the database bootstrap to hide an uncertain admission.

`recover` does not cover schema maintenance. If schema maintenance is interrupted, resume it only with the same chart, values, images and operation. Keep the hook logs and database status, and contact [support](/more/support/) if it cannot finish. Do not clear failed state manually. See also [Schema changes and migration failures](#schema-changes-and-migration-failures).

## Enterprise: native mode

Native mode installs Enterprise without Argo Rollouts. The supported profile is the extraction-only cohort: API and worker, with optional webhooks. Backend, GPU worker and RAG must be disabled, and the operator refuses to qualify a plan that enables them. Each enabled component needs at least two replicas on distinct nodes.

1. Write the plan `enterprise-initial.json` (format `xberg-native-enterprise-initial/v1`). It lists each enabled component with its namespace, health port, replica count, Deployment UID and spec digest, and the image manifest and configuration files for each. Read UIDs and digests from the live cluster after creating the Deployments, not from examples. Use the same installation, generation and policy in the chart values, the plan and the runtime environment.
2. Apply the database bootstrap and schema migration. Install the generation with `helm install` using `charts/_distribution/examples/native-enterprise-ha.yaml` from the extracted chart. Set `SCHEMA_DIGEST` to the digest of the completed schema migration.
3. Register, create the public Service, then observe, qualify and mark ready:

   ```sh
   S=scripts/deployment_lifecycle_native_enterprise_initial.py
   python3 $S register --plan ../enterprise-initial.json --schema-digest "$SCHEMA_DIGEST"
   python3 $S create-service --plan ../enterprise-initial.json \
     --service-name extraction-api --api-port 8080 --context "$KUBE_CONTEXT"
   python3 $S observe --plan ../enterprise-initial.json --context "$KUBE_CONTEXT"
   python3 $S qualify --plan ../enterprise-initial.json --context "$KUBE_CONTEXT"
   python3 $S ready --plan ../enterprise-initial.json --context "$KUBE_CONTEXT"
   ```

   `register` needs `DEPLOYMENT_MAINTENANCE_DATABASE_URL` and `DEPLOYMENT_APPLICATION_DATABASE_URL`. `qualify` needs only the maintenance URL. Keep credentials in the environment, never in arguments. Repeating an identical `register` is safe after a partial failure. A different plan is refused, as is any registration after admission.

   `create-service` creates the Service once, or confirms an identical existing one without changing it. A conflict needs your inspection. Keep the Service UID it returns, and do not manage that Service in any generation's Helm release.

4. For each later generation, install the candidate as a new release, then register it and run the operation:

   ```sh
   python3 $S register-generation --plan ../enterprise-candidate.json --schema-digest "$SCHEMA_DIGEST"
   python3 scripts/deployment_lifecycle_native_enterprise_operation.py prepare \
     --configuration ../enterprise-operation.json \
     --source-plan ../enterprise-initial.json --candidate-plan ../enterprise-candidate.json \
     --context "$KUBE_CONTEXT" --promote --drain-source --finalize
   ```

   `--finalize` requires `--promote` and `--drain-source`. List the public Service UID and all source and candidate Deployments in `enterprise-operation.json`. Recovery works as for Pro: rerun with `recover` and the same files after the lease expires.

A generation has at most 32 pods, and a source plus candidate plan at most 64. Each qualification has a 40-second execution budget. Within those limits, capacity and latency are not guaranteed, and a failure never extends the deadlines.

## Enterprise: Argo Rollouts

With Argo Rollouts, the chart's `charts/_distribution/examples/argo-enterprise-ha.yaml` publishes only the immutable component ConfigMaps. It creates no Rollouts, Services or PodDisruptionBudgets. The supported cohort is extraction-only API and worker with optional webhooks. Backend, GPU, RAG and autoscaling are unsupported, and the database, JetStream and credentials are dependencies you provision and fail over yourself.

1. Publish each rendered component with `deployment_lifecycle_argo_publish.py plan` and then `publish-planned` (see `--help`), using its source UID, digest and image evidence. Keep every publication receipt.

2. Write the bootstrap plan `enterprise-argo-bootstrap.json` (format `xberg-argo-enterprise-bootstrap/v1`) with the fields `namespace`, `registration`, `manifest`, `public_service_name` and `components`. Each component lists its publication receipt, image manifest and image configuration, as paths relative to the plan.
3. Run the first installation:

   ```sh
   S=scripts/deployment_lifecycle_argo_enterprise_initial.py
   python3 $S register --plan ../enterprise-argo-bootstrap.json --schema-digest "$SCHEMA_DIGEST"
   python3 $S create --plan ../enterprise-argo-bootstrap.json --context "$KUBE_CONTEXT"
   python3 $S plan-initial --plan ../enterprise-argo-bootstrap.json \
     --context "$KUBE_CONTEXT" > ../enterprise-argo-initial.json
   python3 $S observe --plan ../enterprise-argo-initial.json --context "$KUBE_CONTEXT"
   python3 $S qualify --plan ../enterprise-argo-initial.json --context "$KUBE_CONTEXT"
   python3 $S ready --plan ../enterprise-argo-initial.json --context "$KUBE_CONTEXT"
   ```

   `create` runs once and refuses existing or partial installations, so inspect an ambiguous failure instead of retrying. It creates one Rollout per component and a PodDisruptionBudget for each generation. The operator owns the public API Service. Run `plan-initial` after the Rollouts exist.

4. For a later generation, run `register-generation --schema-digest "$SCHEMA_DIGEST"` and `create-budgets` for the candidate, then write a run file `enterprise-argo-operation.json` (format `xberg-argo-enterprise-run/v1`). It holds `configuration` (installation, generation, namespace, public Service and component bindings) and `cohorts` (the `source` and `candidate` bootstrap plans). Use observed UIDs and the publisher receipts. Then:

   ```sh
   python3 $S plan-operation --plan ../enterprise-argo-operation.json \
     --context "$KUBE_CONTEXT" > ../enterprise-argo-plan-observation.json
   python3 $S run-operation --plan ../enterprise-argo-operation.json \
     --context "$KUBE_CONTEXT" --expected-epoch "$EXPECTED_EPOCH"
   python3 $S status-operation --plan ../enterprise-argo-operation.json
   ```

   `plan-operation` validates only. `run-operation` needs `DEPLOYMENT_CONTROLLER_DATABASE_URL`, an explicit context and the installation's current epoch. It stages the candidate, qualifies storage, switches the Service, holds 30 seconds, drains and retires the source and finalizes.

To recover, check `status-operation`, wait for the recorded lease to expire, then run:

```sh
python3 $S recover-operation --plan ../enterprise-argo-operation.json \
  --context "$KUBE_CONTEXT" --expected-epoch "$EXPECTED_EPOCH"
```

If a storage check was interrupted, add `--abandon-storage`. As with native mode, it starts a fresh check and deletes nothing. `status-operation` lists the leftover test objects in `cleanup_keys`. Old source ReplicaSets from earlier operations may stay at zero replicas, but live or terminating source pods block finalization.

## Schema changes and migration failures

Schema changes run in chart hooks, not in the operator. These procedures apply when a release changes the database schema.

### Online schema changes

By default, migrations run in `maintenance` mode, which stops the workload. `migrations.mode=online` accepts only a converged no-op today, and refuses anything else before it changes the database. Use the maintenance procedure for every schema change.

### Recover a failed Pro migration

A failure during schema apply, maintenance grant reconciliation, controller API setup or role validation can leave the database on a different contract than the running image expects. When any of these hooks fails, the Pro chart keeps the StatefulSet scaled down and records the original replica count in the annotation `rollback.xberg.io/original-replicas`.

1. Keep the workload scaled down and leave the fence in place.
2. Capture the failed hook's logs (`helm get hooks xberg-pro -n xberg-pro` and the hook job logs) and the active schema receipt, and send them to [support](/more/support/).
3. Do not restart the previous image until support confirms it matches the live database.
4. For forward recovery, fix the verified cause and rerun the reviewed maintenance upgrade with the same chart, values and images. A newer chart or image can change the receipt and need a separate recovery.

After the hooks succeed and restore the recorded replica count, verify the replica count, readiness and an authenticated extraction before you route traffic. A recorded count of zero stays zero.

### First upgrade to guarded Enterprise S3 payload cleanup

When you upgrade an Enterprise installation that uses S3 SSE-KMS for staged inputs or extraction context, use the fenced maintenance path:

1. Stop the old API cleanup executors before you apply the schema and reconcile grants.
2. Quiesce the other workloads that share the database, and hold their reconcilers until the new schema and routine grants are verified.
3. Keep outstanding cleanup leases. An interrupted delete is retried after its lease expires, and the new executor deletes only the recorded object version.

The upgraded grants include a maintenance-only cleanup guard. Before you return to an older binary, complete a reviewed rollback that restores the previous schema and routine grants, and verify the older binary's role contract.

### First upgrade to fenced Pro webhook delivery

Older Pro relays can release or settle an in-flight webhook delivery by event identity alone, including one already reclaimed by a newer relay. Neither runtime admission nor a route switch stops an older relay that is still running. Before you roll out an image with fenced webhook delivery over a source image that may not support it, use a maintenance transition:

1. Record each legacy writer's replica count and image.
2. Stop new submissions at ingress and suspend every reconciler that can recreate a legacy writer.
3. Inventory all writers that share the database, including ones outside the serving release or cluster, and stop them gracefully while the destination is still disabled.
4. For each legacy Pro StatefulSet, run the read-only check below in its own cluster and namespace. It needs `get` on the StatefulSet and `list` on Pods. For other writer types, confirm the process has exited at its supervisor and keep restart disabled.

```sh
(
  set -eu
  : "${KUBE_CONTEXT:?Set the reviewed context}"
  : "${PRO_NAMESPACE:?Set the legacy workload namespace}"
  : "${PRO_STATEFULSET:?Set the legacy StatefulSet name}"
  kube() {
    kubectl --context "$KUBE_CONTEXT" --namespace "$PRO_NAMESPACE" --request-timeout=15s "$@"
  }
  snapshot=$(kube get statefulset "$PRO_STATEFULSET" -o json)
  selector=$(printf '%s' "$snapshot" | jq -er '
    select(.kind == "StatefulSet"
      and .metadata.deletionTimestamp == null
      and (.metadata.generation | type == "number")
      and .status.observedGeneration == .metadata.generation
      and .spec.replicas == 0
      and (.status.replicas // 0) == 0
      and (.status.readyReplicas // 0) == 0
      and ((.spec.selector.matchExpressions // []) | length) == 0)
    | .spec.selector.matchLabels
    | select(type == "object" and length > 0)
    | to_entries | map(.key + "=" + .value) | join(",")') || {
      echo 'The legacy StatefulSet has no observed zero-replica revision' >&2
      exit 1
    }
  pods=$(kube get pods --selector "$selector" -o json)
  printf '%s' "$pods" | jq -e '
    (.kind == "List" or .kind == "PodList")
    and (.metadata.continue // "") == "" and .items == []' >/dev/null || {
    echo 'The legacy Pod inventory is incomplete or still contains Pods' >&2
    exit 1
  }
  current=$(kube get statefulset "$PRO_STATEFULSET" -o json)
  [ "$snapshot" = "$current" ] || {
    echo 'The legacy StatefulSet changed during the check' >&2
    exit 1
  }
  echo 'The reviewed legacy StatefulSet is stopped and its Pod selector is empty'
)
```

A terminating or unreachable pod still counts. If you forced deletion or a node was unreachable, confirm separately that the old process cannot reconnect or send callbacks. Keep the legacy reconcilers and writers stopped for the whole cutover. The check covers only the named selector, so keep your writer inventory as evidence.

Keep durable jobs and webhook ledger rows in place. After you restart on the fenced single instance, let normal lease expiry recover unfinished attempts, then verify that accepted jobs and callback event IDs survived. A receiver may already have a callback whose acknowledgement was lost, so deduplicate replays by event ID. Roll back or overlap only between images that share the same delivery behavior, and use maintenance for any transition back across this boundary.

## Customer-managed keys for Enterprise S3 inputs

**Available in:** Enterprise

The replicated Enterprise API can require native AWS S3 SSE-KMS for staged inline extraction inputs and their job context. It is off by default and the chart does not enable it. Pro, presigned upload tickets and protected results are outside this option.

Before you publish an API revision with it, qualify the installation's versioned general-purpose S3 bucket:

- The API can use the key and write, the worker can read the exact version and decrypt, and the cleanup role can delete versions.
- The bucket uses an installation-owned storage root.
- A bucket policy denies writes with missing or wrong SSE-KMS headers on the `documents/` and `job-context/` prefixes, including any storage root. The policy must also cover the previous API revision and stay in place during rollback.
- Existing object versions and key access stay available while their jobs or cleanup leases are live.

Then create the canary object. Write the exact bytes `synthetic S3 protected input canary v1` (no trailing newline) with the chosen key to `deployment-challenges/v1/<installation-id>/api-s3-protected-inputs` under the same storage root, and record the S3 version ID. Publish the three variables together in the API's digest-qualified pod template:

| Variable                                       | Value                                                  |
| ---------------------------------------------- | ------------------------------------------------------ |
| `ENTERPRISE_PROTECTED_INPUT_ENCRYPTION`        | `s3-kms`                                               |
| `ENTERPRISE_PROTECTED_INPUT_S3_KMS_KEY_ARN`    | Canonical key ARN in the bucket's region and partition |
| `ENTERPRISE_PROTECTED_INPUT_S3_CANARY_VERSION` | The recorded non-null object version                   |

API readiness and protected submissions check the canary's version, key metadata and content. To verify, make synthetic writes under the protected prefixes before customer traffic, and confirm a wrong-key write is denied. The API checks the returned version and key of each staged object. Each input and context must fit within 5 MiB. Keep old versions readable while you qualify new keys.

### Record the bucket policy for a GCS generation

After a generation is admitted and the installation has no active transition, you can record the bucket's encryption policy against that generation. Take the installation, generation, epoch, image and configuration digests, bucket and storage root from the admitted generation. Take the project number, bucket location (uppercase), metageneration and versionless Cloud KMS key name from your reviewed bucket configuration. Keep the expected metageneration fixed for the attempt so drift is refused.

Set `GCS_POLICY_OBSERVATION_DATABASE_URL` from your secret store, using a non-superuser schema-owner login over TLS or a trusted local Unix socket. Pass a short-lived Google access token with `storage.buckets.get` on the bucket as one `Bearer <token>` line on standard input:

```sh
xberg-admin record-gcs-bucket-policy-observation \
  --installation "$INSTALLATION_ID" --generation "$GENERATION_ID" --epoch "$EPOCH" \
  --image-digest "$IMAGE_DIGEST" --config-digest "$CONFIG_DIGEST" \
  --bucket "$BUCKET" --root "$STORAGE_ROOT" --project-number "$PROJECT_NUMBER" \
  --location "$BUCKET_LOCATION" --metageneration "$METAGENERATION" \
  --default-kms-key "$CRYPTO_KEY" <&3
```

Omit `--root` when the configuration uses the bucket root. The command stores the policy digest, metageneration and observation time. A provider failure, mismatch or concurrent change leaves the last successful observation in place. The record is evidence at that time only, so verify object generations, key access and each upload path separately before you enable protected traffic.

### Inventory encryption and key changes

Track object storage, the database, processing volumes and integration secrets separately. The S3 setting above covers only eligible inline documents and job context. Verify encryption for database records, RAG text and indexes, WAL, replicas, backups, temporary volumes and caches in the way your platform provides it.

For each storage namespace, record the write and read identities, key policy, retained versions and restore procedure. Before you change a key, qualify writes with the new key and drain outstanding upload tickets. Then exercise an existing read, a new write, a wrong-key rejection and a restore with synthetic content. Keep the previous key accessible until retained versions and backups can be restored or have expired. For Azure, record the container's encryption scope and its key-policy history, because an object's scope name does not show which key protected it.
