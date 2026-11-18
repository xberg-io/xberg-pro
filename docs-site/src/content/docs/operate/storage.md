---
title: Object storage configuration
description: Choose and configure the object storage backend for Xberg Pro and Enterprise, including S3-compatible endpoints and the endpoint allowlist.
sidebar:
  order: 3
---

**Available in:** Pro, Enterprise

Xberg stores extracted document bytes and cached embeddings in an object store. Choose the backend at deployment time with environment variables or Helm values. Supported providers are Google Cloud Storage (`gcs`), Amazon S3 (`s3`), Azure Blob Storage (`azure`) and a mounted filesystem (`fs`).

| Variable                                            | Purpose                                                      |
| --------------------------------------------------- | ------------------------------------------------------------ |
| `STORAGE_PROVIDER`                                  | `gcs`, `s3`, `azure` or `fs`. Required.                      |
| `STORAGE_BUCKET`                                    | Bucket or container name. Required.                          |
| `STORAGE_REGION`                                    | Cloud region. Required for `s3`.                             |
| `STORAGE_ROOT`                                      | Optional key prefix.                                         |
| `STORAGE_PRESIGN_TTL_SECS`                          | Maximum presigned URL lifetime in seconds. Default `3600`.   |
| `STORAGE_FS_ROOT`                                   | Root directory for the `fs` provider. Default `/data/xberg`. |
| `GCS_CREDENTIAL`                                    | Service-account JSON, base64 encoded or a file path.         |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`          | Explicit S3 credentials. Omit them to use workload identity. |
| `S3_ENDPOINT`, `S3_PATH_STYLE`                      | Custom S3-compatible endpoint settings.                      |
| `AZURE_STORAGE_ACCOUNT`, `AZURE_STORAGE_ACCESS_KEY` | Azure credentials.                                           |

Keep credentials in a Kubernetes Secret or another secret store. For AWS-specific settings, including IRSA and EKS Pod Identity, see [AWS S3 storage and workload identity](/operate/aws-storage/).

## Custom storage endpoints

Xberg supports S3-compatible endpoints. For self-hosted deployments, [RustFS](https://github.com/rustfs/rustfs) is a good choice, and any S3-compatible store works. Because a custom endpoint is a destination the service calls on your behalf, it must pass an allowlist check that prevents server-side request forgery (SSRF).

Set `STORAGE_ENDPOINT_ALLOWLIST` to a comma-separated list of hostnames allowed as custom storage endpoints:

```bash
export STORAGE_ENDPOINT_ALLOWLIST="s3.internal.example.com,backup.s3.example.com"
```

Entries match in two modes:

- **Exact match.** `example.com` matches only `example.com`.
- **Suffix match.** `.internal.example.com` matches `s3.internal.example.com`, `backup.internal.example.com` and the apex `internal.example.com`.

Pro and Enterprise enforce the allowlist at startup. If you set `GCS_ENDPOINT`, `S3_ENDPOINT` or `AZURE_ENDPOINT` and the allowlist is empty or does not cover the host, the service fails to start with an error that names the endpoint. It never falls back to a cloud backend. This applies to the Pro container and to the Enterprise API, backend, worker and RAG services. Without a custom endpoint, the allowlist has no effect.

### Example: RustFS inside the cluster

If RustFS runs at `rustfs.storage.svc.cluster.local:9000`:

```bash
export STORAGE_ENDPOINT_ALLOWLIST="rustfs.storage.svc.cluster.local"
export STORAGE_PROVIDER=s3
export S3_ENDPOINT="http://rustfs.storage.svc.cluster.local:9000"
export S3_PATH_STYLE=true
```

Then point the Helm values of each component that touches storage at the same settings. Enterprise sets these per component; see [Enterprise on Kubernetes](/start/enterprise-helm/).

### Adopt the allowlist on an existing deployment

An existing deployment that uses a custom storage endpoint must add the endpoint hostname to `STORAGE_ENDPOINT_ALLOWLIST` before it upgrades, or it fails to start. On Pro, set it in `configMap`.

1. Set `STORAGE_ENDPOINT_ALLOWLIST` to your custom endpoint hostname.
2. Deploy the updated release.
3. Verify that extraction jobs succeed and files land in the custom backend.

### Private addresses

The allowlist, not an IP deny list, gates storage endpoints. A listed hostname may resolve to a private (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local, loopback or multicast address. In-cluster endpoints such as `rustfs.storage.svc.cluster.local` resolve to private IPs, so the RustFS example depends on this. SSRF protection for storage therefore comes entirely from the allowlist: only hostnames you list can be used as custom endpoints.

When the chart's NetworkPolicy is enabled, also allow egress to the endpoint.

### S3 path style

`S3_PATH_STYLE` controls bucket addressing. `true` selects path style (`https://endpoint/bucket/key`). The default `false` selects virtual-host style (`https://bucket.endpoint/key`). RustFS and most S3-compatible endpoints need `S3_PATH_STYLE=true`. Set the flag explicitly.

### GCS credentials for custom endpoints

A custom GCS endpoint (`GCS_ENDPOINT`) requires an explicit `GCS_CREDENTIAL`. Without it, presigned URL generation fails, because ambient default credentials do not work for a non-standard endpoint.

## Filesystem provider

The `fs` provider writes to a mounted volume at `STORAGE_FS_ROOT`. It suits single-node Pro installs. Back up the volume with your snapshot tooling; see [Backup and restore](/operate/backup-and-restore/).
