---
title: Deployment operator
description: Install and roll out replicated Pro and Enterprise deployments with the deployment operator that ships in the Helm chart archive.
sidebar:
  order: 2
---

**Available in:** Pro, Enterprise (replicated deployments only)

## When you need it

A default install runs one Pro pod and upgrades with `helm upgrade`. You need the deployment operator only when you run a **replicated** deployment: `deployment.mode=replicated` with two or more pods spread over distinct nodes, shared object storage, and rollouts that replace the whole fleet with a new generation behind one stable Service. Replicated releases are not upgraded with `helm upgrade`. Each generation is a separate Helm release, and the operator moves traffic between them.

The operator is a set of Python commands that ship in the chart archive. They qualify a generation before it takes traffic, switch the Service to it and retire the old generation. It is proprietary software under the archive's `LICENSE`, and it installs no tools and creates no cloud resources.

Use it when you need planned rollouts with no HTTP errors. For everything else, use the [Pro Helm install](/start/pro-helm/) or the [Enterprise Helm install](/start/enterprise-helm/).

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

During a rollout the operator moves the Service to the new generation, waits 30 seconds, then drains the old one. Your load balancer must stop sending requests to the old pods inside that window. Configure and test all of the following, then set `deployment.traffic.connectionDrainingConfirmed=true`:

- Client connections stay open while the load balancer picks upstream pods independently.
- Upstream connections are retired within a hard maximum age well below 30 seconds (for example 20), or not reused. An idle timeout alone does not do this. Retiring a connection must not cancel requests already in flight.
- New upstream connections follow the Service's current endpoints. A proxy pinned to the Service ClusterIP may never see pods leave.
- The time from the new pods becoming ready until the last request reaches the old pods, plus the time that request needs to upload, validate and be accepted, stays under 30 seconds with margin. Uploads that can run longer than that are outside the zero-error guarantee.

The chart only checks the boolean. It does not inspect your load balancer. Before you set it, test with long-lived clients through a three-step sequence (A to B to C), with a slow POST in flight during one switch, and no client or proxy retries. Confirm that the POST creates exactly one job and returns its result. A passing readiness probe is not this test.

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

If a command is interrupted, do not start another operation and do not apply Kubernetes changes by hand. Keep the original request files and status output. When the interrupted command's lease has expired, rerun with the same files and flags, replacing `prepare` with `recover`:

```sh
python3 scripts/deployment-lifecycle.py recover --config ../operation.json \
  --context "$KUBE_CONTEXT" --qualify-native --promote-native --drain-native --finalize \
  --image-manifest ../candidate-manifest.json --image-configuration ../candidate-config.json
```

Recovery re-establishes the route to the new generation and continues retiring the old one. It does not replay a scale change whose result is unknown.

If the interruption happened during the storage check, add `--abandon-native-storage` to `recover` with `--qualify-native`. The operator discards that attempt's results, starts a fresh check and requires a complete pass before admission. It deletes nothing: the test objects the interrupted run wrote stay in the bucket and are listed under `cleanup_debt` in the status output. They contain only synthetic bytes, so delete them once storage activity has stopped. This option cannot be combined with a recovery that already moved traffic.

An initial installation that failed or stopped uncertain cannot be retried blindly. Keep the stored challenge identity, clean up its exact test keys, then start again. Never replay the database bootstrap to hide an uncertain admission.

If schema maintenance is interrupted, resume it only with the same chart, values, images and operation. Keep the hook logs and database status, and contact [support](/more/support/) if it cannot finish. Do not clear failed state manually. `recover` does not cover schema maintenance.

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
