---
title: Source connectors
description: Ingest documents from cloud drives, object stores and SFTP with encrypted credentials and scheduled, resumable synchronization.
sidebar:
  order: 2
---

**Available in:** Pro, Enterprise

Source connectors ingest documents from cloud drives, object stores and SFTP, so your application never holds the provider credentials.

You create an integration, connect it, and either pull documents on demand or let Xberg synchronize it on a schedule. Credentials are encrypted at rest with AES-256-GCM, access is audited, and read routes return only a masked copy.

## Supported sources

| Kind         | Source               | Authentication                         |
| ------------ | -------------------- | -------------------------------------- |
| `s3`         | Amazon S3            | `static`                               |
| `gcs`        | Google Cloud Storage | `static`                               |
| `azure_blob` | Azure Blob Storage   | `static`                               |
| `sftp`       | SFTP server          | `static`, password                     |
| `gdrive`     | Google Drive         | `oauth2`                               |
| `dropbox`    | Dropbox              | `oauth2`                               |
| `onedrive`   | Microsoft OneDrive   | `oauth2`                               |
| `sharepoint` | Microsoft SharePoint | `oauth2`                               |
| `notion`     | Notion               | `api_key` (internal integration token) |
| `confluence` | Confluence           | `static`                               |

## Enable the integration hub

The hub encrypts credentials with a key you control. On Pro, set both of these on the container, each to the base64 encoding of 32 random bytes:

```shell
export INTEGRATION_KEK=$(openssl rand -base64 32)
export INTEGRATION_STATE_SECRET=$(openssl rand -base64 32)
```

Pro refuses to start with only one of them. With both unset, the hub is disabled and `/v1/projects/{project_id}/integrations` answers `503` while the rest of the service runs normally. Back up both values: losing `INTEGRATION_KEK` makes stored credentials unreadable. To rotate the key, set the outgoing key as `INTEGRATION_KEK_PREVIOUS` and the new one as `INTEGRATION_KEK`; reads re-wrap credentials, and a background sweep re-wraps the rest. Remove `INTEGRATION_KEK_PREVIOUS` after the sweep completes. Enterprise includes the hub with per-tenant encryption.

OAuth sources also need `OAUTH_CALLBACK_BASE_URL` (your public API origin) and `FRONTEND_BASE_URL`. Register `<OAUTH_CALLBACK_BASE_URL>/v1/oauth/callback` as an exact redirect URI at the provider.

## Create an integration

Object stores take their provider credentials in a `credentials` object, which is encrypted before it is stored, and non-secret settings in `config`:

| Kind         | Required `config`         | Optional `config` | Required `credentials`                          | Optional `credentials` |
| ------------ | ------------------------- | ----------------- | ----------------------------------------------- | ---------------------- |
| `s3`         | `bucket`, `region`        | `root`            | `access_key_id`, `secret_access_key`            | `session_token`        |
| `gcs`        | `bucket`                  | `root`            | `credential` (service-account JSON as a string) | none                   |
| `azure_blob` | `bucket` (container name) | `root`            | `account_name`, `account_key`                   | none                   |

Custom endpoints and ambient instance credentials are not accepted. Every integration names its public cloud target and carries project-scoped credentials, so it cannot route requests to an internal endpoint or inherit the service's own cloud identity.

```bash
curl -X POST "$XBERG_URL/v1/projects/$PROJECT_ID/integrations" \
  -H "Authorization: Bearer $XBERG_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Document archive",
    "kind": "s3",
    "auth_type": "static",
    "config": { "bucket": "customer-documents", "region": "eu-central-1", "root": "incoming" },
    "credentials": { "access_key_id": "REPLACE_WITH_KEY_ID", "secret_access_key": "REPLACE_WITH_SECRET" }
  }'
```

On Enterprise, requests also set `provider` to the same value as `kind`; Pro derives it. `GET` on the same path lists integrations, and `GET` and `DELETE` on `/v1/projects/{project_id}/integrations/{iid}` read and remove one.

## Connect an OAuth source

OAuth sources need a client application at the provider. Create the integration with `auth_type: "oauth2"` and the application's `client_id` and `client_secret` in `credentials`, then start the flow:

```bash
curl -X POST "$XBERG_URL/v1/projects/$PROJECT_ID/integrations/$INTEGRATION_ID/connect" \
  -H "Authorization: Bearer $XBERG_API_KEY"
```

Open the returned authorization URL in a browser and complete the consent. Xberg stores the tokens encrypted and rotates refresh tokens automatically. `POST .../disconnect` revokes the connection.

- **Dropbox.** Create a scoped app with `files.metadata.read` and `files.content.read`. An optional `config.path` limits discovery to one absolute path; omit it to scan the connected root.
- **OneDrive.** Use delegated `Files.read` plus `offline_access` in a Microsoft identity-platform application, with an empty `config`.
- **SharePoint.** Use the same delegated permissions and set `config.site_id` to the Graph site identifier.

Downloads from OneDrive, SharePoint and Dropbox are limited to 100 MiB and stay on the provider's own hosts. Redirects follow only SSRF-validated destinations.

## SFTP

The SFTP connector uses password authentication, inventories regular files recursively and takes part in synchronization. Create the integration with `kind: "sftp"`, `auth_type: "static"` and sealed `username` and `password` credentials. Its `config` holds the non-secret settings:

```json
{
  "host": "files.example.com",
  "port": 22,
  "root": "/incoming",
  "host_key_sha256": "SHA256:<OpenSSH SHA-256 fingerprint>"
}
```

- `host:port` must exactly match one comma-separated entry of the operator-owned `SFTP_HOST_ALLOWLIST` variable. Suffix and wildcard matches are rejected, and an empty list refuses every SFTP integration.
- DNS resolves once per connection and the SSH transport connects to that address.
- The handshake must present the configured SHA-256 host-key fingerprint. Compare it through a trusted channel: `ssh-keyscan files.example.com | ssh-keygen -lf - -E sha256`.
- Discovery skips symlinks. A direct fetch may follow a symlink whose resolved target stays under `root`.
- Downloads are capped at 100 MiB. Operations time out at 8 seconds, a full inventory at 120 seconds and a fetch at 45 seconds; the `SFTP_*_TIMEOUT_SECS` variables in [Pro configuration](/reference/pro-configuration/#timeouts-and-shutdown) change them.

SFTP v3 exposes no content ETag, so the connector derives a revision from the canonical path, size and second-resolution modification time. A file replaced with identical path, size and modification time looks unchanged, so preserve meaningful modification times. Files whose attributes omit size or modification time are rejected rather than given a synthetic revision.

With Kubernetes network policies enabled, add the SFTP destination CIDR and TCP port to the operator egress rules: `networkPolicy.extraEgress` for the Pro chart, and `backend.networkPolicy.extraEgress`, `worker.networkPolicy.extraEgress` and `workerGpu.networkPolicy.extraEgress` for Enterprise. On Enterprise, also set `SFTP_HOST_ALLOWLIST` in `backend.env`, `worker.env` and `workerGpu.env`.

## Browse and ingest documents

List what an integration can see, then submit documents by reference instead of uploading bytes:

```bash
curl "$XBERG_URL/v1/projects/$PROJECT_ID/integrations/$INTEGRATION_ID/documents" \
  -H "Authorization: Bearer $XBERG_API_KEY"
```

`POST /v1/extract` accepts an `integration` reference in a document entry in place of inline `data`; the two are mutually exclusive. A request takes at most 10 documents inline or by reference.

## Scheduled synchronization

Synchronization discovers new, changed and deleted documents on a schedule, and admits each new revision once as an extraction job. It is off by default and needs two steps.

1. Enable the scheduler on the deployment. On Pro, set `PRO_INTEGRATION_SYNC_ENABLED=true` and a stable `PRO_INTEGRATION_SYNC_CURSOR_KEY` (base64 of 32 random bytes), then restart. Keep the key in a Secret and reuse it across restarts, because it protects the stored sync cursors. On Enterprise, set `INTEGRATION_SYNC_ENABLED=true` and `INTEGRATION_SYNC_CURSOR_KEY` on the backend.
2. Opt each integration in:

   ```bash
   curl -X PUT "$XBERG_URL/v1/projects/$PROJECT_ID/integrations/$INTEGRATION_ID/sync" \
     -H "Authorization: Bearer $XBERG_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"enabled": true}'
   ```

   `GET` on the same path reports the effective state and interval.

Tune the scheduler with `PRO_INTEGRATION_SYNC_INTERVAL_SECS` (default 300), `_POLL_SECS`, `_LEASE_SECS`, `_CLAIM_LIMIT` and `_PAGE_LIMIT`; the ranges are in [Pro configuration](/reference/pro-configuration/#integration-sync). Scheduled sync is not supported in replicated Pro deployments.

Revisions are identified by the provider: the Graph `cTag` (with `eTag` as fallback) for Microsoft sources, the `rev` for Dropbox, and path, size and time for SFTP. A moved file keeps its identity where the provider offers a stable ID. A deletion is reconciled only after a complete scan finishes. Sync resumes from its encrypted cursor after a restart, and an expired provider cursor starts a replacement full scan.

To send synchronized documents straight into a RAG collection, set the target with `PUT /v1/projects/{project_id}/integrations/{iid}/sync/rag-target`; see [RAG](/guides/rag/).

## Limits and errors

- `503` on `/v1/projects/{id}/integrations` means the integration hub is disabled. Set both `INTEGRATION_KEK` and `INTEGRATION_STATE_SECRET`.
- A `POST /v1/extract` request takes at most 10 documents, inline or by reference.
- Downloads from Dropbox, OneDrive, SharePoint and SFTP are capped at 100 MiB.
- An SFTP integration is refused when `host:port` is not an exact entry of `SFTP_HOST_ALLOWLIST`, and its connection fails when the host-key fingerprint differs.
- Scheduled synchronization is off by default and not supported in replicated Pro deployments.

## Security

- Credentials and OAuth tokens never leave the encrypted store in plaintext.
- Each integration has its own data-encryption key, rotated on demand.
- Every credential access is written to the [audit log](/guides/audit-log/).
- Outbound requests to providers use a guarded HTTP client with connect, read and total timeouts (`SAFE_HTTP_*_TIMEOUT_SECS`).
