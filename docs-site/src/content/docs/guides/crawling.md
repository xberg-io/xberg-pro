---
title: Crawling
description: Crawl websites from seed URLs, convert pages to Markdown, and extract the documents they link to.
sidebar:
  order: 3
---

**Available in:** Pro, Enterprise

Crawling turns a website into Markdown and extracted documents from seed URLs.

Submit the seeds to `POST /v1/extract` and Xberg crawls the site over HTTP, converts HTML to Markdown, follows links within your limits and, optionally, downloads and extracts the documents it finds. Crawling uses the same endpoint, authentication, webhooks and job model as document extraction. It needs no extra setup on Pro or Enterprise.

## Submit a crawl

Send `urls` instead of, or alongside, `documents`. A request accepts up to 100 seed URLs:

```bash
curl -X POST "$XBERG_URL/v1/extract" \
  -H "Authorization: Bearer $XBERG_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "urls": [{ "url": "https://docs.example.com/" }],
    "crawl_config": {
      "max_depth": 2,
      "max_pages": 200,
      "stay_on_domain": true,
      "include_paths": ["/guides/"],
      "output_mode": "extract"
    }
  }'
```

The `202` response lists `crawl_job_ids`, one per group of seed URLs that share an effective configuration. Documents submitted in the same request appear under `job_ids` as usual. `crawl_config` is the default for every URL; a `crawl_config` on one `urls` entry overrides it key by key, one level deep. Sending `crawl_config` without any `urls` is a validation error.

## Configuration

Pro validates `crawl_config` against an allowlist, so a misspelled key fails the request with `400` instead of being ignored. These keys are accepted:

| Key                                          | Purpose                                                                    |
| -------------------------------------------- | -------------------------------------------------------------------------- |
| `max_depth`                                  | How many link hops from the seed to follow. At most 5                      |
| `max_pages`                                  | Cap on pages fetched. The default is 1 and the maximum is 10,000           |
| `max_concurrent`                             | Concurrent requests. The default is 10 and the maximum is 32               |
| `stay_on_domain`, `allow_subdomains`         | Scope the crawl to the seed's host, optionally with subdomains             |
| `include_paths`, `exclude_paths`             | Restrict or skip URL paths                                                 |
| `allowed_file_types`                         | File types to accept                                                       |
| `follow_document_urls`, `document_url_depth` | Follow links that point at documents, and how deep. The depth is at most 3 |
| `download_documents`                         | Download linked documents for extraction                                   |
| `respect_robots_txt`                         | Honor `robots.txt`                                                         |
| `user_agent`, `request_timeout_secs`         | Request identity and timeout. The timeout is at most 300 seconds           |
| `extract_page_content`                       | Extract the converted page content                                         |
| `strategy`                                   | Traversal strategy. Only `bfs` (breadth-first) is available                |
| `output_mode`                                | `scrape`, `crawl` or `extract`                                             |
| `browser`, `proxy`, `bypass`                 | Rendering, proxy and bypass settings; see [Limits](#limits)                |

Values above these maximums are rejected at submission. The crawl honors `robots.txt` and discovers sitemaps, and it decodes character sets before conversion.

## Output modes

`output_mode` decides what the crawl produces:

- `scrape` fetches exactly one page, with no recursion and no extraction.
- `crawl` runs a multi-page crawl and persists the pages as raw output; nothing is extracted.
- `extract` crawls, then extracts every document it discovers. This is the default.

In `extract` mode, each discovered document becomes a child extraction job with its own `job.completed` or `job.failed` result. Use `GET /v1/jobs` to list the project's extraction jobs and crawl parents together.

## Follow progress

Stream crawl events as server-sent events with the `crawl_job_id` from the response:

```bash
curl -N "$XBERG_URL/v1/crawl-jobs/$CRAWL_JOB_ID/events" \
  -H "Authorization: Bearer $XBERG_API_KEY"
```

Events report each crawled page, discovered URL and error, and a final completion event with the page count. A crawl that this instance is not running, such as one that finished earlier, has no live stream. A webhook on the request receives one `crawl.completed` or `crawl.failed` callback per crawl parent; see [Webhooks](/guides/webhooks/).

## Limits

- The crawl fetches over plain HTTP. A configuration that only makes sense with a browser, which means `browser.mode: "always"`, `browser.stealth` or a named `browser.backend`, or one that names a proxy or bypass provider, is refused with `422`. Xberg does this instead of silently returning an unrendered page. On Pro this is the case for every deployment.
- `CRAWL_WALL_CLOCK_SECS` bounds the page-production phase of one crawl. The default is 1500, and the accepted range is 300 to 1740. A crawl that overruns it fails.
- A request carries at most 10 inline documents and 100 seed URLs.
- A `400` names an unknown `crawl_config` key or a value above a maximum. A `503` means crawl extraction is not available on this instance.
- Requests go through a resolver-protected HTTP client, and private, loopback and metadata-service addresses are blocked.

With Kubernetes network policies enabled, crawling reaches the public web on the ports in `networkPolicy.publicEgressPorts` (80 and 443 by default). A seed on any other port needs its own `networkPolicy.extraEgress` rule, or the request times out without naming the policy. See [Pro Helm](/start/pro-helm/#network-policies) and [Enterprise Helm](/start/enterprise-helm/#network-policies).
