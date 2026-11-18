---
title: Helm chart distribution and verification
description: Download the Xberg Pro and Enterprise Helm charts from the public OCI registry and verify their signed release manifest before installing.
sidebar:
  order: 1
---

**Available in:** Pro, Enterprise

The Xberg Pro and Xberg Enterprise Helm charts are public downloads, not open-source software. The packaged `LICENSE` and your commercial agreement apply. Downloading a chart does not grant a license to run the product.

Each release publishes a signed manifest that records the chart archive digests and the first-party image digests the chart pins. Verify that manifest before you install.

## Public and private registries

| Artifact                                   | Location                                                           | Access                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Helm charts (`pro`, `xberg-enterprise`)    | `oci://us-central1-docker.pkg.dev/xberg-public-assets/helm-charts` | Public. No `helm registry login` and no Google account.                       |
| Release manifest, public key and signature | `https://storage.googleapis.com/xberg-helm-releases/<tag>/`        | Public.                                                                       |
| Pro image                                  | `ghcr.io/xberg-io/xberg-pro`                                       | Anonymously pullable, but requires a valid license to run.                    |
| Migration images pinned by the charts      | `ghcr.io/xberg-io`                                                 | Anonymously pullable.                                                         |
| Enterprise service images                  | Provided with your agreement                                       | Private. Supply pull credentials through `imagePullSecrets` or node identity. |

Chart download access does not authorize pulling private product images. Each released Pro chart pins one multi-architecture Pro image digest for the application, the migration hooks and the health test.

## Verify a release

You need Helm 4, Cosign, `curl`, `jq`, OpenSSL and `shasum`.

After a release is announced, obtain its `helm-vX.Y.Z` tag and the trusted signing-key fingerprint through your authenticated customer channel. The fingerprint is the SHA-256 of the DER-encoded public key, not of the PEM file. Do not trust a key only because it was downloaded next to the signature.

```shell
set -euo pipefail
: "${TAG:?set the announced helm-vX.Y.Z tag}"
: "${TRUSTED_KEY_SHA256:?set the independently authenticated signing-key fingerprint}"
base="https://storage.googleapis.com/xberg-helm-releases/$TAG"
for file in release.json release.pub release.sigstore.json; do
  curl --fail --silent --show-error "$base/$file" -o "$file"
done
actual_key=$(openssl pkey -pubin -in release.pub -outform DER | shasum -a 256 | cut -d' ' -f1)
[ "$actual_key" = "$TRUSTED_KEY_SHA256" ] || exit 1
cosign verify-blob --key release.pub --bundle release.sigstore.json release.json
[ "$(jq -r '.tag' release.json)" = "$TAG" ] || exit 1
chart=pro # or xberg-enterprise
reference=$(jq -er --arg chart "$chart" '.charts[]|select(.name==$chart)|.oci' release.json)
version=$(jq -r --arg chart "$chart" '.charts[]|select(.name==$chart)|.version' release.json)
helm pull "oci://${reference%@*}" --version "$version"
expected=$(jq -r --arg chart "$chart" '.charts[]|select(.name==$chart)|.sha256' release.json)
[ "$(shasum -a 256 "$chart-$version.tgz" | cut -d' ' -f1)" = "$expected" ] || exit 1
jq -er '.images' release.json > release-images.json
```

The script does five things:

1. Downloads the manifest, the public key and the Cosign bundle.
2. Compares the key fingerprint with the value you obtained out of band.
3. Verifies the manifest signature with Cosign.
4. Pulls the chart and compares its SHA-256 with the signed manifest.
5. Extracts the image digests the chart pins into `release-images.json`.

Verification uses a Cosign bundle, not Helm's GPG `.prov` format. See [Helm OCI references](https://helm.sh/docs/topics/registries/) and [Cosign verification](https://docs.sigstore.dev/cosign/verifying/verify/).

## Image digests and mirrors

The packaged chart values already contain the first-party repositories and digests from `release-images.json`. Release digests identify multi-architecture indexes, so one chart selects the correct platform image on both amd64 and arm64 nodes.

When you mirror images, copy the whole index and its platform manifests, then replace the repository and the digest together. Never change one without the other. See [Air-gapped installation](/operate/air-gapped/) for a worked mirroring procedure.

A chart built from a source checkout has empty first-party tags and digests, so it needs an explicit tag before it renders. Use the released archive.

## Install the verified archive

Both charts default to a customer-provided PostgreSQL (`postgresql.enabled=false`). Configure its connection URLs and the required Kubernetes Secrets using the guide for your product:

- [Xberg Pro on Kubernetes](/start/pro-helm/)
- [Xberg Enterprise on Kubernetes](/start/enterprise-helm/)

The extracted archive also contains the [deployment operator](/operate/deployment-operator/) and the database bootstrap assets under `charts/_distribution`.
