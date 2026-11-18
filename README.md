<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://cdn.jsdelivr.net/gh/xberg-io/assets@v1/banner/readme-banner-dark.svg">
    <img alt="Xberg" width="420" src="https://cdn.jsdelivr.net/gh/xberg-io/assets@v1/banner/readme-banner-light.svg">
  </picture>
</p>

# Xberg Pro and Enterprise

<p align="center">
  <a href="https://pro.xberg.io"><img src="https://img.shields.io/badge/Docs-pro.xberg.io-007ec6" alt="Documentation"></a>
  <a href="https://discord.gg/xt9WY3GnKR"><img src="https://img.shields.io/badge/Discord-Join-007ec6?logo=discord&logoColor=white" alt="Discord"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/Docs%20license-CC%20BY%204.0-007ec6" alt="Documentation license: CC BY 4.0"></a>
</p>

One engine, three packages. Xberg Core, Pro and Enterprise run the same open-source extraction engine. Pro and Enterprise add what runs around it: durable jobs, storage, search, access control, audit and scale. They are self-hosted, and documents never pass through Xberg-operated systems.

Documentation: [pro.xberg.io](https://pro.xberg.io)

This repository holds documentation only. Xberg Pro and Xberg Enterprise are proprietary software, licensed by written agreement. The documentation is licensed under CC BY 4.0, see [LICENSE](LICENSE).

## Tiers

|               | Core                       | Pro                            | Enterprise                                    |
| ------------- | -------------------------- | ------------------------------ | --------------------------------------------- |
| License       | MIT                        | Proprietary                    | Proprietary                                   |
| Availability  | Released                   | Released                       | By arrangement, with private images and chart |
| Runs as       | Library, CLI, Docker, Helm | Docker Compose or Helm         | Helm, on your Kubernetes cluster              |
| Scale ceiling | One process                | One node                       | A cluster                                     |
| Price         | Free                       | Per license, by contract       | Per license, by contract                      |
| Support       | GitHub, Discord            | Email, dedicated Slack channel | Private channel, contractual SLA              |

The full comparison is in [Core, Pro and Enterprise](https://pro.xberg.io/overview/tiers/).

## What you get with Pro

Pro is one container plus PostgreSQL, built for a single team on a single node.

- A durable job queue and history that survive restarts
- Object storage on S3, GCS, Azure Blob or the filesystem, and presigned uploads
- API keys and multiple projects, isolated by row-level security in the database
- Single sign-on through any OIDC provider
- A web console with a playground, job history and settings
- Crawling, content enrichment and source connectors for Google Drive, Dropbox, OneDrive, SharePoint, Notion, Confluence, S3, GCS, Azure Blob and SFTP
- RAG collections with hybrid search and reranking on PostgreSQL with pgvector
- Auto-Tune, which searches your own corpus for the settings that extract it best
- An append-only, hash-chained audit log
- Prometheus metrics, OpenTelemetry traces and prebuilt Grafana dashboards
- Client SDKs for Python, TypeScript and Go

A valid license turns on everything Pro does. Nothing is sold as an add-on.

## What Enterprise adds

Enterprise runs everything in Pro on your Kubernetes cluster, and adds the multi-user and multi-tenant layer:

- Teams, invitations and roles
- SAML 2.0 and SCIM provisioning
- Registered webhook endpoints with retries, delivery history and replay
- Document versions and diff
- Data rooms
- Cross-project usage analytics
- Browser-rendered crawls
- Elastic workers that autoscale on queue depth

## What Pro replaces

With Core you build the work around the engine: a durable queue with retries and dead-lettering, storage plumbing, API-key authentication and project scoping, an audit trail, a retrieval layer and a console your team can use. Pro replaces that work with a supported product, and you stop maintaining it. See [What Pro replaces](https://pro.xberg.io/overview/what-pro-replaces/).

## Deployment

Pro runs as `ghcr.io/xberg-io/xberg-pro` next to PostgreSQL with pgvector. The image is publicly pullable, but it needs a signed license token to start. This abbreviated sketch shows the shape of the service. The [Docker Compose guide](https://pro.xberg.io/start/pro-docker/) has the complete file, including the PostgreSQL role bootstrap that the three database URLs depend on.

```yaml
services:
  pro:
    image: ${PRO_IMAGE:?Set PRO_IMAGE to ghcr.io/xberg-io/xberg-pro:<version>}
    environment:
      DATABASE_URL: postgres://xberg_app:${PRO_POSTGRES_APPLICATION_PASSWORD}@postgres:5432/xberg
      MAINTENANCE_DATABASE_URL: postgres://xberg_maintenance_login:${PRO_POSTGRES_MAINTENANCE_PASSWORD}@postgres:5432/xberg
      VECTOR_INDEX_BROKER_DATABASE_URL: postgres://xberg_vector_index_broker_login:${PRO_POSTGRES_VECTOR_BROKER_PASSWORD}@postgres:5432/xberg
      VECTOR_INDEX_QUEUE_DATABASE_URL: postgres://xberg_index_worker_login:${PRO_POSTGRES_INDEX_WORKER_PASSWORD}@postgres:5432/xberg
      STORAGE_PROVIDER: fs
      STORAGE_FS_ROOT: /data/xberg
      XBERG_ADMIN_KEY: ${XBERG_ADMIN_KEY:?Set XBERG_ADMIN_KEY}
      XBERG_LICENSE_KEY: ${XBERG_LICENSE_KEY:?Set XBERG_LICENSE_KEY to your signed token}
    ports:
      - "127.0.0.1:8080:8080"
      - "127.0.0.1:3000:3000"
    volumes:
      - xberg-data:/data
volumes:
  xberg-data:
```

The API listens on port 8080 and the web console on port 3000. For Kubernetes, see the [Pro Helm guide](https://pro.xberg.io/start/pro-helm/) and the [Enterprise Helm guide](https://pro.xberg.io/start/enterprise-helm/).

## Licensing and contact

Pricing is per license, by contract. A license token is verified offline and is valid for 180 days, followed by a 30-day grace period. There is no phone-home and no usage beacon. See [Pricing and licensing](https://pro.xberg.io/overview/pricing-and-licensing/).

To buy a license or arrange a trial, write to [contact@xberg.io](mailto:contact@xberg.io). Report security issues through the [security policy](https://github.com/xberg-io/xberg-pro/security/policy), not a public issue.

## Part of Xberg.io

- [Xberg](https://github.com/xberg-io/xberg): the open-source content-intelligence engine behind every tier
- [sdks](https://github.com/xberg-io/sdks): official client SDKs for the extraction API
- [crawlberg](https://github.com/xberg-io/crawlberg): web crawling and scraping with HTML to Markdown conversion
- [html-to-markdown](https://github.com/xberg-io/html-to-markdown): a fast, lossless HTML to Markdown engine
- [liter-llm](https://github.com/xberg-io/liter-llm): a universal LLM API client with 170+ providers
- [tree-sitter-language-pack](https://github.com/xberg-io/tree-sitter-language-pack): tree-sitter grammars and code-intelligence primitives
- [sceptre](https://github.com/xberg-io/sceptre): EasyOCR's accuracy in a single Rust binary
- [alef](https://github.com/xberg-io/alef): the polyglot binding generator
