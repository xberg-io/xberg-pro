---
title: Air-gapped installation
description: Run Xberg Pro or Enterprise with no internet route by mirroring images, pre-seeding model and Tesseract caches, and disabling the Hugging Face fallback.
sidebar:
  order: 6
---

**Available in:** Pro, Enterprise

Xberg can run with no outbound network access after three preparations on a connected machine: mirror the images, pre-seed the unbundled model and Tesseract caches, and turn off the Hugging Face network fallback. This page walks through the Pro shape and summarizes what differs for Enterprise at the end. A fresh Pro image runs its bundled Tesseract, PaddleOCR and Sceptre paths offline. Features backed by other models need a prepared persistent cache.

## What air-gapped means for this product

Extraction, the REST API, the dashboard and the bundled RAG runtime talk only to PostgreSQL and your configured object store, both of which you run inside the perimeter. Pro's own binaries make three kinds of outbound call:

1. **Model weights.** The Pro image carries the complete pinned classic OCR catalog under `/usr/share/xberg/ocr-models/hub`: the PaddleOCR artifacts, plus Sceptre's eight recognizers and its shared CRAFT detector. Embedding presets, rerankers, layout detection, named-entity recognition and chunking tokenizers are fetched from Hugging Face Hub on first use. Their persistent cache lives under `HF_HOME` or `XBERG_CACHE_DIR`, which stays `/data/models`.
2. **Tesseract language files.** The image bakes in ten pinned `tessdata_fast` files under `/usr/share/tessdata`: `eng`, `deu`, `fra`, `spa`, `nld`, `kor`, `chi_sim`, `jpn`, `jpn_vert` and the `osd` script-detection file. The Enterprise worker image ships the same set. OCR in those languages needs no network access. Any other language is fetched from `github.com/tesseract-ocr/tessdata_fast` into `$XBERG_CACHE_DIR/tessdata` the first time a job asks for it.
3. **Optional egress.** Structured extraction against a hosted LLM, vision OCR through Gemini or OpenAI, LLM reranking against a hosted provider, the integration hub's OAuth round trip and source reads (Google Drive), crawl jobs that fetch the URLs you submit, and webhook deliveries to the URLs you register. None of these run unless you configure them, and baseline extraction needs none.

License verification is not an outbound call. See [License activation](#license-activation).

The Enterprise CPU and GPU worker images include the pinned tree-sitter grammar pack, its notices and provenance, so code-file ingestion needs no GitHub egress. Custom worker images must include a parser pack matching their `tree-sitter-language-pack` crate version and set `TREE_SITTER_LANGUAGE_PACK_LIBS_DIR` to the directory that holds its libraries. The Pro image does not include this pack, so code-file ingestion is unavailable on an air-gapped Pro install.

## Prerequisites

Before you disconnect the host or cluster from the internet, have these ready:

- A connected machine that runs the same Pro image digest you intend to deploy. Model caches and the license key are tied to the exact build.
- A private registry the air-gapped cluster can reach, to hold the mirrored images.
- PostgreSQL 15 to 18 reachable from the air-gapped host. See [Cloud SQL and managed PostgreSQL](/operate/cloud-sql/) for the bootstrap, and [Pro with Docker](/start/pro-docker/) or [Pro on Kubernetes](/start/pro-helm/) for the install order.
- Object storage reachable from the air-gapped host: S3-compatible, GCS, Azure Blob or the local filesystem (`fs`). See [Object storage configuration](/operate/storage/).
- A signed `XBERG_LICENSE_KEY` token from Xberg.
- Free space for the caches next to `STORAGE_FS_ROOT` and `CACHE_DIR`. Budget about 20 GiB for the model caches under `/data/models` plus the bounded 10 GiB result cache, then add your retained corpus. See the sizing note in the [Pro configuration reference](/reference/pro-configuration/).

## 1. Mirror the images

Copy the licensed Pro image to a registry the air-gapped host or cluster can reach. Preserve the multi-architecture index and both platform manifests if the cluster has amd64 and arm64 nodes. `docker pull` followed by `docker push` on one host copies only that host's platform. After you authenticate Skopeo to both registries:

```bash
set -euo pipefail
SOURCE_IMAGE=ghcr.io/xberg-io/xberg-pro:REPLACE_WITH_RELEASE_VERSION
MIRROR_IMAGE=registry.example.com/xberg-pro:REPLACE_WITH_RELEASE_VERSION
skopeo copy --all "docker://$SOURCE_IMAGE" "docker://$MIRROR_IMAGE"
skopeo inspect --raw "docker://$MIRROR_IMAGE" | sha256sum
```

Record the mirror's reported index digest and deploy the mirror repository with that digest. Do not assume it equals the source digest. Mirror the migration images pinned in the chart values too, and the test images if you run `helm test` offline.

Point the deployment at the mirror:

- **Docker Compose.** Set `PRO_IMAGE` to the mirrored image's versioned tag or digest and `PRO_PULL_POLICY=missing` in your `.env` file.
- **Helm, same path layout.** If the mirror keeps the original repository paths under a prefix and preserves digests, set one value:

  ```yaml
  global:
    imageRegistry: registry.example.com/mirror
  ```

  The chart puts the original repository path under that prefix, so `ghcr.io/xberg-io/xberg-pro@sha256:...` becomes `registry.example.com/mirror/xberg-io/xberg-pro@sha256:...`. The tag or digest is kept, and a digest still wins over a tag. The prefix applies only where an image repository still equals the packaged default. A different per-image repository takes precedence.

- **Helm, different layout or digests.** Set `image.repository` to the mirror repository and `image.digest` to its `sha256:` index digest. A released chart already pins a digest, so changing `image.tag` alone does not select the mirror. Override `migrations.artifactImage` with its mirrored repository and digest, and set the `tests.images` entries when you run tests.

Set `imagePullSecrets` if the mirror needs credentials, then check the `helm template` output for every container, init container and hook that still references the old registries.

For Enterprise, mirror each enabled service image (`api`, `backend`, `worker`, `webhook`, `rag`, and `worker-gpu` if enabled), the migration images, the `ragAudit` image, any model-loader image under `dataLoader`, and `tests.images` if you run `helm test`. Use `global.imageRegistry` or the matching per-image `*.image.repository` and digest keys in the Enterprise chart values. If you use the optional bundled PostgreSQL subchart, its images need their own settings, and `global.imageRegistry` takes precedence over `postgresql.image.registry`. If its origin check rejects your mirror, verify the mirrored digests against the trusted source before you set `postgresql.global.security.allowInsecureImages=true` for that installation.

If you use an Enterprise nginx ingress, supply the TLS Secret and certificate through your own process. To use cert-manager with an internal issuer, add an annotation such as `cert-manager.io/cluster-issuer: internal-issuer` under each applicable `api.ingress.annotations`, `backend.ingress.annotations` or `frontend.ingress.annotations`.

### Verify Enterprise image evidence offline

Each Enterprise image release comes with a signed evidence bundle: `enterprise-images.json`, its public key `enterprise-images.pub`, a Cosign bundle and the SBOM and provenance files it lists. Obtain it through your Xberg contact and transfer it with the mirrored images. Get the signing-key fingerprint through a separate channel, and verify with Cosign 3.1.4 or later:

```bash
set -euo pipefail
cd image-evidence
fingerprint=$(openssl pkey -pubin -in enterprise-images.pub -outform DER | shasum -a 256 | cut -d' ' -f1)
test "$fingerprint" = "$ENTERPRISE_IMAGE_TRUSTED_KEY_SHA256"
cosign trusted-root create --out private-trust.json
cosign verify-blob --key enterprise-images.pub --trusted-root private-trust.json \
  --insecure-ignore-tlog --bundle enterprise-images.sigstore.json enterprise-images.json

jq -er '.images[] | (.provenance, .sboms[]) | "\(.sha256)  \(.file)"' enterprise-images.json |
  shasum -a 256 -c -
jq -er '.images[] | .indexes[] | .repository + "@" + .digest' enterprise-images.json
```

The signature is detached and uses the trusted key without a public transparency log. Compare each mirror index digest with the matching line from the last command. Provenance records the source revision, index and platform manifest digests.

## 2. Pre-seed the model cache

On the connected machine, start the same fully configured Pro image against an isolated, bootstrapped database and storage backend, with RAG warmup enabled. The shipped default is `false`. The image does not create its own database or role credentials, so complete the database bootstrap first. Set `XBERG_RAG_WARMUP_ENABLED=true` in the container environment and persist `/data`, including `HF_HOME=/data/hf`, while you seed. A bare image start without runtime credentials cannot warm models.

Warmup fetches the named-entity model and the embedding preset of every collection that already exists, so create the collections you plan to run offline before the warmup pass. Warmup does not fetch everything. Also submit one job of each unbundled kind you plan to run offline, for example a retrieve request that uses reranking, because those models load on first use. PaddleOCR and Sceptre need no warmup.

Copy the seeded `/data` volume onto the air-gapped host's persistent volume before the first start there. The volume holds `XBERG_CACHE_DIR` (`/data/models`) and, if you set a distinct `HF_HOME`, that directory too. The classic OCR catalog and Tesseract's ten bundled languages ship inside the image and need no seeding. A Tesseract language outside that set needs the same treatment: run one job that uses it on the connected machine first, so the file lands under `$XBERG_CACHE_DIR/tessdata` before you copy the volume.

If you add collections with new embedding presets later, repeat the warmup pass on a connected machine and copy the volume again before the presets are needed offline. Turn `XBERG_RAG_WARMUP_ENABLED` back off when you finish, so the disconnected instance does not spend cycles rebuilding models it cannot download.

## 3. Turn off the Hugging Face fallback

Set `HF_HUB_OFFLINE=1` on the Pro container. The alias `HUGGINGFACE_HUB_OFFLINE=1` is also accepted. A model already in the cache loads from disk. A missing model fails fast with `Hugging Face offline mode is enabled and '<file>' from <repo> is not available in the local cache`, instead of hanging on a connection timeout. The flag does not skip local checksum verification of cached files, so a warm cache can take a moment to become model-ready in a fresh process. That delay does not mean the cache is missing.

The flag covers only Hugging Face. Tesseract has no equivalent switch, and step 2 already closed that gap. A job that asks for a language the pre-seed missed fails with `Failed to download language pack '<lang>' from tessdata_fast repository` after two attempts instead of silently reaching out.

## License activation

`XBERG_LICENSE_KEY` is an Ed25519-signed token verified against the public key baked into the image at build time (see [Licensing](/reference/licensing/)). Verification is local. No network call is involved, so a disconnected deployment is licensed exactly like a connected one.

Before you copy a token to the disconnected host, verify it on a connected machine with the same image digest you are about to deploy:

```bash
docker run --rm --entrypoint /app/xberg-admin \
  registry.example.com/xberg-pro@sha256:REPLACE_WITH_MIRROR_INDEX_DIGEST \
  license verify --token "$XBERG_LICENSE_KEY"
```

The command checks the signature and reports the license state without starting the service. A bad or mismatched token is caught before it becomes a crash loop on a host you can no longer reach easily. The signed token is the only artifact you need from Xberg for activation.

## Verify that no egress is needed

Run this sequence with egress already blocked, after steps 1 to 3:

1. Start the container or roll out the chart pointed at the mirrored image.
2. Poll liveness and readiness:

   ```bash
   curl -sf http://localhost:8080/healthz
   curl -sf http://localhost:8080/readyz
   ```

   `/readyz` checks PostgreSQL and the object store only. It does not prove the model cache is complete.

3. Submit one extraction of each kind you plan to run. At minimum, run a native-text document and an OCR job in a bundled Tesseract language, and confirm both complete:

   ```bash
   curl -sf -X POST http://localhost:8080/v1/extract \
     -H "Authorization: Bearer $XBERG_ADMIN_KEY" \
     -F "file=@sample.pdf"
   ```

4. If RAG is enabled, run one ingest and one retrieve-with-reranking request against a collection you warmed in step 2.

A missing model reports the Hugging Face offline message from step 3, not a timeout. A missing Tesseract language reports the download failure. Either message during verification means the pre-seed was incomplete, not that the flags are wrong, so go back to step 2 and re-seed on a connected machine. Run this sequence yourself before you rely on the deployment.

## Xberg Enterprise differences

The chart-based product follows the same three preparations with different mechanics:

- **Mirroring** is per service. Mirror every enabled image as described in [step 1](#1-mirror-the-images). Set `global.imageRegistry` for packaged defaults and use per-image overrides for custom repositories.
- **Pre-seeding** has no in-process warmup pass. On a connected machine, use the open-source Xberg CLI that matches the worker's engine version and a fresh staging directory:

  ```bash
  export XBERG_CACHE_DIR="$(mktemp -d)"
  HF_HUB_CACHE="$XBERG_CACHE_DIR" xberg cache warm --cache-dir "$XBERG_CACHE_DIR" --all-table-models
  worker --upload-cache
  ```

  Run the worker uploader with your bucket's storage variables and the same staging directory. It writes the model files and a `manifest.json` under `MODEL_CACHE_PREFIX` (default `models/v1`) in object storage, so there is no volume to copy by hand. Refresh the prefix before you roll out upgraded workers, so the manifest holds the new snapshot paths. To seed the formula-recognition model files, build the CLI with formula recognition. The uploader includes only the formula files present in the staging cache, and cache sync succeeds with a partial set. With egress blocked, upload the full set before you use `layout.formula_model`. A missing file makes extraction keep the region's plain text and report a processing warning. If you enable `worker.formulaWarmup.enabled` or `workerGpu.formulaWarmup.enabled`, the same missing file fails worker startup. In the cluster, set `worker.modelCache.strategy: objectStorage` and `worker.modelCache.objectStorage.required: true`. The chart's `sync-models` init container then copies the manifest's files into each pod, verifies checksums and blocks the pod if the sync fails. Set `dataLoader.enabled: true` to keep one node-local copy instead of one per pod. If the data loader already tried to sync the old manifest, restart its DaemonSet after the upload.

- **The RAG service** seeds its own cache the same way. Run `rag --upload-cache` against its bucket prefix (default `models/rag/v1`), then set `rag.modelCache.strategy: objectStorage`. The chart refuses to render an offline RAG pod (`HF_HUB_OFFLINE` or `HUGGINGFACE_HUB_OFFLINE`) unless `rag.modelCache.objectStorage.required` is `true`, because a fresh pod otherwise fails on its first embed and cannot recover. Size `rag.modelCache.objectStorage.manifestSize` from the manifest the uploader writes.
- **The offline flag and Tesseract behavior** are identical. Set `HF_HUB_OFFLINE=1` on `worker`, `worker-gpu` and `rag` through each service's `extraEnv`. The same ten bundled languages ship in the worker image, with the same fetch-on-miss fallback for anything else.
- **Licensing** does not use the offline token. Enterprise access is by commercial agreement, with OIDC or JWT authentication and API keys.
