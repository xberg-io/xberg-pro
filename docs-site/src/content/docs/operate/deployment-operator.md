---
title: Deployment operator
description: Run replicated Pro and Enterprise installations with the packaged deployment operator, including initial admission, planned rollouts and recovery.
sidebar:
  order: 2
---

**Available in:** Pro and Enterprise, replicated deployments only

The Pro and Enterprise OCI Helm packages include `charts/_deployment-operator.tar.gz`. It drives replicated installations: it qualifies shared storage, admits a generation of pods, switches traffic between generations and retires the old one. A single-instance Pro install does not need it.

The operator is proprietary software under the package `LICENSE`. It bundles its Python commands and the canonical SQL they use, so you need no source repository access. These distribution assets stay in the downloaded archive and are excluded from Helm's stored release so the release fits Kubernetes object limits. The complete chart guide is `charts/_distribution/README.md` in the extracted package.

## Obtain and verify

Set `CHART_VERSION` to the selected chart release. For Enterprise, replace `pro` with `xberg-enterprise` in the pull and extraction paths.

```sh
helm pull oci://us-central1-docker.pkg.dev/xberg-public-assets/helm-charts/pro \
  --version "$CHART_VERSION" --untar
tar -xzf pro/charts/_deployment-operator.tar.gz
cd deployment-operator
export PYTHONDONTWRITEBYTECODE=1
python3 verify.py
```

[Verify the chart](/operate/helm-distribution/) before you extract its contents. The operator's internal manifest checks the complete extracted file set and bytes; publisher identity comes from the signed chart distribution. Keep the operator directory unchanged, including its SQL, and store requests and results outside it. The verifier rejects extra files, including Python bytecode caches.

The host needs Python 3.11 or newer, `kubectl` and `psql` on `PATH`. Supply an explicit Kubernetes context and the appropriate PostgreSQL credentials through the documented environment variables. The operator installs no tools and creates no cloud infrastructure. Native mode needs no Argo controller; Argo mode uses your separately installed Argo Rollouts controller.

## HTTP routing and planned draining

Replicated Pro and Enterprise need a customer-managed L7 ingress or load balancer in front of the lifecycle-owned installation Service. Keep generation ingress disabled. Neither Kubernetes Service load balancing nor multiple replicas supplies the HTTP connection contract below. Native Kubernetes and Argo Rollouts use the same requirement. No proxy is bundled.

Before you set `deployment.traffic.connectionDrainingConfirmed=true`, configure and test this behavior with your actual L7, controller version and upstream settings:

- Keep downstream client connections open while choosing upstream backends independently.
- Retire old upstream connections before the source drain starts. Use a hard upstream connection maximum age shorter than the operator's fixed 30-second propagation hold, with a margin (for example 20 seconds), or disable upstream connection reuse. An idle timeout alone does not bound a busy reused connection. Stop assigning new requests at the bound, but do not terminate in-flight requests to enforce it.
- Route fresh upstream connections to the current installation Service endpoints after candidate convergence. A proxy that targets the unchanged Service ClusterIP may never receive backend deregistration events, so a generic draining option is not enough.
- Preserve in-flight requests through upstream retirement and pod shutdown. Set request, response and drain timeouts for your maximum supported request duration, and provision capacity for both generations plus the L7 during a rollout.

The chart checks only the boolean assertion. It does not inspect L7 settings or verify connections, so do not enable it merely because an Ingress or LoadBalancer exists. Test with persistent clients through an A to B to C sequence, with no POST retries, no forced client reconnects and no hidden upstream retries that could duplicate an uncertain submission. An idle connection or a passing readiness probe is not this test.

The operator changes the public Service selector, verifies complete candidate EndpointSlice convergence, then holds that route for 30 seconds before it drains the source generation. Its receipts prove Kubernetes routing and admission, not external L7 convergence. All L7 routing and upstream-retirement delays must fit inside that hold with margin.

Preserving connections alone does not protect a request that reaches durable SQL admission only after the source drains. Let D be the worst delay from candidate endpoint convergence to assignment of the last request to the source. Let A be the worst time from that assignment through body transfer, validation and object staging to durable database admission. Require D + A < 30 seconds with an explicit margin. A 20-second connection-age bound alone does not satisfy this. With no upstream reuse, D approaches zero after convergence, but A must still be bounded and tested. Unbounded uploads are outside planned zero-error continuity. Include a slow in-flight POST during promotion in acceptance testing, and verify its exact accepted job and result with no retry.

A successful planned rollout does not promise zero HTTP errors on sudden pod or node loss. Such a fault can break an in-flight connection or leave a POST acknowledgement uncertain. Accepted durable jobs recover through their processing leases within the configured recovery bounds. Verify that recovery separately, and never automatically resubmit an uncertain POST. Database and Enterprise NATS failover remain your responsibility.

## Maintenance retry boundary

Resume interrupted schema maintenance only with the same immutable chart, values, images, manifest and operation, installation and epoch bindings. Changed assets cannot resume an active schema-bridge receipt. Preserve the original inputs, hook logs and database status, and contact support if the operation cannot finish. Do not manually finalize or clear failed state. Native and Argo `recover` commands do not supersede schema maintenance.

## Commands

Each command prints its usage with `--help`:

```sh
python3 scripts/deployment-installation.py --help
python3 scripts/deployment_lifecycle_native_initial.py --help
python3 scripts/deployment_lifecycle_native_enterprise_initial.py --help
python3 scripts/deployment-lifecycle.py --help
python3 scripts/deployment_lifecycle_argo_initial.py --help
python3 scripts/deployment_lifecycle_argo_enterprise_initial.py --help
```

Create versioned immutable configuration and register the installation's shared-cloud storage identity before you register generations. Use the chart's replicated profile with at least two replicas on distinct nodes and platform-specific image manifest digests. The runtime images must include the matching `/app/xberg-storage-challenge` utility. A version string alone does not qualify a cluster: the operator checks the admitted pods, immutable configuration, owner chains, image identity, scheduled nodes and authenticated runtime health.

Structural qualification has been exercised on EKS Kubernetes 1.36. Other Kubernetes versions above the chart's 1.29 minimum still need your own structural and runtime qualification.

## Native Pro initial installation

Provide the single-workload request and registered tuple in format `xberg-native-initial-command/v1`, plus the exact OCI manifest and configuration bytes:

```sh
python3 scripts/deployment_lifecycle_native_initial.py observe \
  --request ../initial.json --manifest ../image-manifest.json \
  --configuration ../image-config.json --context "$KUBE_CONTEXT"
python3 scripts/deployment_lifecycle_native_initial.py qualify \
  --request ../initial.json --manifest ../image-manifest.json \
  --configuration ../image-config.json --context "$KUBE_CONTEXT"
python3 scripts/deployment_lifecycle_native_initial.py ready \
  --request ../initial.json --manifest ../image-manifest.json \
  --configuration ../image-config.json --context "$KUBE_CONTEXT"
```

`qualify` needs `DEPLOYMENT_MAINTENANCE_DATABASE_URL`. It persists an unpredictable challenge before any storage I/O, checks every writer and reader pair through each pod's own storage client, records the proof, cleans up its synthetic objects, rechecks identities and invokes initial admission. Its result leaves `readiness_verified` false. `ready` performs the separate serving check, because admission alone does not prove the browser UI and API are ready. The installation Service must keep `publishNotReadyAddresses: false` and the chart's combined readiness probe.

The operator does not clean up or retry a failed or uncertain write. Preserve the persisted challenge identity and reconcile its exact synthetic keys before another attempt. Do not replay bootstrap to hide an uncertain admission.

For an image upgrade, A/B qualification journals source readiness and candidate warmup, then runs a fresh storage challenge. Also pass `--source-image-manifest` and `--source-image-configuration` describing the source's platform manifest. A failed or interrupted A/B challenge blocks a new nonce until you reconcile it, and you must keep the previous route while recovery is pending.

### Bounded storage proofs

Pro two-generation native and Argo qualification can use the explicit profile `XBERG_STORAGE_PROOF_PROFILE=two-witness-star/v1`. Install the matching schema migration and operator package first. The setting is an assertion that the migration is installed, not automatic capability negotiation, and an older database rejects the versioned challenge before any storage I/O. The default remains the complete matrix.

For each generation, the pod with the smallest UID is its witness. Each witness reads every pod's object in the other generation, each opposite pod reads that witness's object, and every pod reads its own object. At 32 source and 32 candidate pods this takes 64 writes and 190 reads. Unexpected, missing, duplicate or disconnected edge sets do not qualify.

### Finalize a native Pro rollout

Add `--finalize` to retire the source after promotion and drain. The operator waits for the source's accepted work to drain, scales its Deployment to zero, proves its ReplicaSets observed zero and its pods are gone, and finalizes the operation while the candidate stays ready through the public Service:

```sh
python3 scripts/deployment-lifecycle.py prepare --config ../operation.json \
  --context "$KUBE_CONTEXT" --qualify-native --promote-native --drain-native --finalize \
  --image-manifest ../candidate-manifest.json --image-configuration ../candidate-config.json
```

Declare `source_workload_spec_digest` in the immutable format-2 operation configuration before you start. Read the source Deployment as JSON and compute the digest over its complete `spec`, normalizing only `replicas` to zero:

```python
import copy
import hashlib
import json

spec = copy.deepcopy(source_deployment["spec"])
spec["replicas"] = 0
encoded = json.dumps(spec, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()
source_workload_spec_digest = "sha256:" + hashlib.sha256(encoded).hexdigest()
```

Keep every server-defaulted field. The operator verifies the source UID, registered pod template and referenced configuration on every source read. Changes to other specification fields fail the seal. Finalization has one 600-second phase budget. A timeout leaves explicit recovery work and does not relax ownership or readiness checks.

Older configurations without the seal remain valid for their existing commands but cannot acquire a seal later, because changing the configuration changes the persisted request digest. Declare the seal before any new operation that uses `--finalize`.

### Recover an interrupted operation

After an interrupted invocation and expiry of its owner lease, run `recover` with the same configuration, image evidence and flags. Recovery fences the complete inventory, re-establishes the candidate route under the new owner and continues retirement. It can continue an already-retired or partially scaled source without requiring source health and without blindly replaying an uncertain scale mutation. Preserve the status and the original immutable files if an acknowledgement is lost.

To recover an interrupted storage challenge, use `recover --qualify-native --abandon-native-storage` with the same configuration and image evidence once the old lease expires. The new owner records the old nonce, epoch and synthetic writer keys as pending cleanup debt and never accepts that nonce's receipts, including late ones. A fresh nonce and a complete current pod matrix must pass before admission. This option deletes no keys and does not prove the interrupted request stopped. Keep the journal's `cleanup_debt` keys for cleanup after provider activity has stopped; they hold synthetic challenge bytes only. A recovery that already routed traffic uses its sealed route-recovery protocol, and this option refuses that combination.

### Register a later Pro generation

Use `register-generation` for each candidate after the initial generation is admitted. Prepare the format-1 configuration with the candidate's image and configuration digests and the completed schema digest, and keep the installation's storage identity and serving policy digest.

```sh
python3 scripts/deployment-installation.py generation-registry-sql \
  --config ../pro-candidate.json
python3 scripts/deployment-installation.py register-generation \
  --config ../pro-candidate.json
```

The first command renders the registration statement and its authority checks for review. The second needs `DEPLOYMENT_MAINTENANCE_DATABASE_URL` in the environment and commits the registration without resetting the bootstrap or changing admissions. It requires one compatible admitted source with an idle lifecycle, or an exact finalized previous operation of the same installation. It refuses active operations, maintenance fences, foreign or missing history, and incompatible protocol, schema, storage or policy. An identical registration can be retried. Registration is neither storage qualification nor traffic promotion, so continue with the native lifecycle workflow.

## Native Enterprise cohort

Run `deployment_lifecycle_native_enterprise_initial.py observe|qualify|ready --plan ../enterprise-initial.json --context "$KUBE_CONTEXT"` to install Enterprise without an Argo controller. The plan format is `xberg-native-enterprise-initial/v1`. It binds the six-row component manifest, the aggregate registration, and one native Deployment request plus OCI manifest and configuration file for each enabled component. Each component request uses `xberg-native-enterprise-component/v1` with its namespace, health port, replica count and Deployment UID and spec digest.

The supported profile is `extraction_only`, with API and worker enabled and optional webhooks. Backend, GPU worker and RAG components must be disabled, and the operator refuses enabled unsupported components before qualification. Each enabled component needs at least two replicas on distinct nodes and its own runtime tuple and health protocol. Six pods across API, worker and webhooks take six writes and 36 reads. `qualify` persists the complete cohort proof and uses restricted maintenance admission. `ready` separately checks admitted runtime health and Kubernetes readiness.

### Register and create the Service

Prepare the plan and the exact OCI evidence for every component outside the verified operator directory. The registration image digest is the digest of the six-row component manifest, not of any one component's image. Use the same installation, generation and policy in the chart values, the manifest, the component requests and the runtime environment. Read actual Deployment UIDs and spec digests after creation, and never use example identifiers as cluster evidence.

Apply the restricted database bootstrap and the compatible schema migration separately. `SCHEMA_DIGEST` must match the completed schema-bridge receipt. Install the generation with `helm install`, never `helm upgrade`, using the substituted `charts/_distribution/examples/native-enterprise-ha.yaml` from the extracted chart. Unregistered or unadmitted pods do not serve protected requests. Keep credentials in the environment, not in command arguments:

```sh
python3 scripts/deployment_lifecycle_native_enterprise_initial.py register \
  --plan ../enterprise-initial.json --schema-digest "$SCHEMA_DIGEST"
python3 scripts/deployment_lifecycle_native_enterprise_initial.py create-service \
  --plan ../enterprise-initial.json --service-name extraction-api --api-port 8080 \
  --context "$KUBE_CONTEXT"
python3 scripts/deployment_lifecycle_native_enterprise_initial.py observe \
  --plan ../enterprise-initial.json --context "$KUBE_CONTEXT"
python3 scripts/deployment_lifecycle_native_enterprise_initial.py qualify \
  --plan ../enterprise-initial.json --context "$KUBE_CONTEXT"
python3 scripts/deployment_lifecycle_native_enterprise_initial.py ready \
  --plan ../enterprise-initial.json --context "$KUBE_CONTEXT"
```

`register` needs `DEPLOYMENT_MAINTENANCE_DATABASE_URL` and `DEPLOYMENT_APPLICATION_DATABASE_URL`. `qualify` needs only the maintenance credential, and the observation, Service and readiness commands use neither. An identical registration can resume after the maintenance phase succeeded and application registration failed. A different tuple or manifest is refused, as is any registration after admission or a lifecycle operation starts.

`create-service` creates the named Service once, or verifies an exactly matching existing Service without modifying it. A conflict or changed selector needs inspection, and the command never falls back to apply or patch. The Service targets only the API component of the initial generation and exposes TCP 8080. Keep the returned UID and spec receipt for later operations, and do not manage this Service in generation Helm releases.

### Register the next generation

After the source generation is admitted, install the candidate as a new generation release and seal its plan and OCI evidence:

```sh
python3 scripts/deployment_lifecycle_native_enterprise_initial.py register-generation \
  --plan ../enterprise-candidate.json --schema-digest "$SCHEMA_DIGEST"
python3 scripts/deployment_lifecycle_native_enterprise_operation.py prepare \
  --configuration ../enterprise-operation.json \
  --source-plan ../enterprise-initial.json --candidate-plan ../enterprise-candidate.json \
  --context "$KUBE_CONTEXT" --promote --drain-source --finalize
```

`register-generation` needs both database credentials, one compatible admitted source, an idle lifecycle, the same storage and policy, and a matching completed schema receipt. It registers only the candidate aggregate and its six component rows. Supply the public Service UID and spec and all source and candidate Deployment bindings in `enterprise-operation.json`. `--drain-source` stops new source work. `--finalize` requires both `--promote` and `--drain-source`, waits for accepted source work, retires admission, scales every sealed source Deployment to zero and finalizes while the candidate serves the Service. The completion phase has one 600-second budget. Recovery follows the same rules as for Pro: rerun `recover` with the same configuration, plans and flags after the lease expires.

Each chart generation permits at most 32 pods across enabled components, and the operation rejects a source-plus-candidate plan above 64 participants. The matrix writes once per pod and reads every writer from every pod. Qualification keeps its 40-second execution budget and 45-second SQL freshness bound. Counts within the limit do not promise enough capacity or latency, and failure stays closed rather than extending those deadlines.

## Enterprise with Argo Rollouts

The extracted chart's `charts/_distribution/examples/argo-enterprise-ha.yaml` publishes immutable desired component ConfigMaps. It creates no Rollouts, Services or PodDisruptionBudgets. Install your Argo Rollouts controller and CRDs separately. The supported cohort is extraction-only API and worker with optional webhooks. Backend, GPU, RAG and autoscaling are unsupported. Database, JetStream and scoped credentials are separately provisioned dependencies, and this profile does not qualify their failover.

Publish each rendered component with `deployment_lifecycle_argo_publish.py plan` and `publish-planned`, using its source UID, digest and platform OCI evidence. The publisher verifies the immutable NATS ConfigMap and every versioned Secret, canonicalizes typed pod fields and derives the component configuration digest. Keep each publication receipt.

Create an `xberg-argo-enterprise-bootstrap/v1` JSON plan with the closed fields `namespace`, `registration`, `manifest`, `public_service_name` and `components`. Each enabled component entry has exactly `component`, `publication` (the full publisher receipt), `manifest` and `configuration` (OCI evidence paths relative to the plan). Keep all files in one plan directory.

```sh
python3 scripts/deployment_lifecycle_argo_enterprise_initial.py register \
  --plan ../enterprise-argo-bootstrap.json --schema-digest "$SCHEMA_DIGEST"
python3 scripts/deployment_lifecycle_argo_enterprise_initial.py create \
  --plan ../enterprise-argo-bootstrap.json --context "$KUBE_CONTEXT"
python3 scripts/deployment_lifecycle_argo_enterprise_initial.py plan-initial \
  --plan ../enterprise-argo-bootstrap.json --context "$KUBE_CONTEXT" \
  > ../enterprise-argo-initial.json
python3 scripts/deployment_lifecycle_argo_enterprise_initial.py observe \
  --plan ../enterprise-argo-initial.json --context "$KUBE_CONTEXT"
python3 scripts/deployment_lifecycle_argo_enterprise_initial.py qualify \
  --plan ../enterprise-argo-initial.json --context "$KUBE_CONTEXT"
python3 scripts/deployment_lifecycle_argo_enterprise_initial.py ready \
  --plan ../enterprise-argo-initial.json --context "$KUBE_CONTEXT"
```

Registration uses the separate maintenance and application credentials and never admits a generation. `create` is one-shot. It verifies every publication before any create and refuses existing, foreign or partially created installations, so inspect an ambiguous failure instead of retrying. It creates one Rollout per role, each with internal active and preview Services and a generation-specific PodDisruptionBudget. Only the lifecycle operator owns the public API Service. `plan-initial` reads actual Rollout and ReplicaSet identities, so rerun it after those objects exist. Qualification writes six synthetic objects and verifies 36 cross-pod reads for the usual three-role, two-replica cohort.

For a later cohort, `register-generation --schema-digest "$SCHEMA_DIGEST"` performs the candidate registration, and `create-budgets` creates its exact PodDisruptionBudgets before staging. Source budgets stay unchanged.

### Run an A/B operation

Keep the source and candidate bootstrap plans, publication receipts and OCI files together outside the operator directory. Create a closed `xberg-argo-enterprise-run/v1` wrapper with `configuration` and `cohorts` fields. `cohorts` holds exactly `source` and `candidate`, each a bootstrap-plan path relative to the wrapper. `configuration` is the complete `xberg-argo-enterprise-operation/v1` contract: installation, operation and generation identities, namespace, public Service binding and contract digest, component bindings, and exact route and Rollout targets. Use observed resource UIDs and the publisher receipts.

```sh
python3 scripts/deployment_lifecycle_argo_enterprise_initial.py plan-operation \
  --plan ../enterprise-argo-operation.json --context "$KUBE_CONTEXT" \
  > ../enterprise-argo-plan-observation.json
python3 scripts/deployment_lifecycle_argo_enterprise_initial.py run-operation \
  --plan ../enterprise-argo-operation.json --context "$KUBE_CONTEXT" \
  --expected-epoch "$EXPECTED_EPOCH"
python3 scripts/deployment_lifecycle_argo_enterprise_initial.py status-operation \
  --plan ../enterprise-argo-operation.json
```

Planning validates both cohorts and current ownership without acquiring controller authority. Running needs only `DEPLOYMENT_CONTROLLER_DATABASE_URL`, an explicit Kubernetes context and the expected installation epoch. The operator stages every component, validates the shared-storage matrix, admits the candidate, switches the public API Service and verifies the propagation hold. It then drains and retires the source, reconciles each Argo release, verifies source pod absence and finalizes. The usual two-replica API, worker and webhooks A/B cohort takes 12 synthetic writes and 144 cross-pod reads before admission.

### Recover an Argo operation

Preserve the wrapper and its evidence. Inspect `status-operation` after an interruption, and do not start another operation or replay Kubernetes mutations. After the recorded lease expires, recover with the current expected epoch:

```sh
python3 scripts/deployment_lifecycle_argo_enterprise_initial.py recover-operation \
  --plan ../enterprise-argo-operation.json --context "$KUBE_CONTEXT" \
  --expected-epoch "$EXPECTED_EPOCH"
```

Recovery acquires a fresh epoch and fences the recorded targets. Prepared recovery reconciles partially staged components. Admitted recovery verifies the actual source or candidate route before fresh qualification. Promoted recovery keeps the candidate route and continues source drain and retirement. Historical source ReplicaSets from earlier finalized operations may remain at zero replicas, but live or terminating source pods block finalization.

When you resume a prepared or admitted operation that has a previous storage challenge, add `--abandon-storage`. Recovery keeps that challenge's synthetic writer keys as cleanup debt, chooses a new nonce and requires a fresh complete matrix. The flag deletes no objects. `status-operation` returns the owned synthetic paths in `cleanup_keys`, with `cleanup_pending` and `owned_keys`. Promoted recovery also accepts `--abandon-storage` when its candidate-only challenge was interrupted. A finalized rollout does not erase the separate cleanup obligation.
