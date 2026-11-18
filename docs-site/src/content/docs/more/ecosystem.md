---
title: Ecosystem
description: Xberg Core, the client SDKs and the open-source projects that Xberg Pro and Enterprise build on.
---

Xberg Pro and Enterprise are proprietary, self-hosted platforms built on the Xberg ecosystem: open-source, MIT-licensed libraries for extraction, crawling, conversion and retrieval. Most of these projects have one Rust core, and [alef](https://github.com/xberg-io/alef) generates their bindings for other languages.

## Xberg Core

[Xberg](https://github.com/xberg-io/xberg) is the open-source content-intelligence engine inside both commercial products. It extracts text, tables and metadata from 107 formats, with OCR and code intelligence. Use it as a library, CLI, REST API, MCP server or Docker image. Documentation is at [docs.xberg.io](https://docs.xberg.io).

Pro and Enterprise customers can use Core alongside their deployment at no cost. See [Core, Pro and Enterprise](/overview/tiers/).

## SDKs

The official [client SDKs](https://github.com/xberg-io/sdks) cover the extraction API served by Pro and Enterprise. One client library targets either deployment. Full API documentation is at [docs.sdks.xberg.io](https://docs.sdks.xberg.io), and [SDKs](/start/sdks/) shows how to install and configure them here.

## Open-source projects

| Project                                                                            | What it does                                                                                                                                                          |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [crawlberg](https://github.com/xberg-io/crawlberg)                                 | Web crawling and scraping with HTML to Markdown conversion and a headless Chrome fallback. Documentation: [docs.crawlberg.xberg.io](https://docs.crawlberg.xberg.io). |
| [html-to-markdown](https://github.com/xberg-io/html-to-markdown)                   | A fast, lossless HTML to Markdown engine.                                                                                                                             |
| [liter-llm](https://github.com/xberg-io/liter-llm)                                 | A universal LLM API client with native bindings and a catalog of 170+ providers.                                                                                      |
| [tree-sitter-language-pack](https://github.com/xberg-io/tree-sitter-language-pack) | Tree-sitter grammars and code-intelligence primitives.                                                                                                                |
| [sceptre](https://github.com/xberg-io/sceptre)                                     | EasyOCR's accuracy in a single Rust binary, with no Python runtime.                                                                                                   |
| [alef](https://github.com/xberg-io/alef)                                           | The polyglot binding generator behind the per-language bindings.                                                                                                      |

## Where each project appears in the platform

- **Acquire.** Pro and Enterprise crawl with crawlberg and convert HTML with html-to-markdown. See [Pipeline](/concepts/pipeline/).
- **Extract.** Xberg and tree-sitter-language-pack do the extraction work in every tier.
- **Enrich.** Structured extraction and LLM reranking reach model providers through liter-llm. See [Structured extraction](/concepts/structured-extraction/).

## Community

- Discord: [join the server](https://discord.gg/xt9WY3GnKR)
- LinkedIn: [xberg-io](https://www.linkedin.com/company/xberg-io)
- Contact: [contact@xberg.io](mailto:contact@xberg.io)
