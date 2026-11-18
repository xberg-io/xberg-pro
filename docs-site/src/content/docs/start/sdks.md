---
title: Install the SDKs
description: Install the Xberg Python, TypeScript and Go clients and point them at your Pro or Enterprise deployment.
sidebar:
  order: 4
---

The official clients cover Python, TypeScript and Go. Each client works with both products, Xberg Pro and Xberg Enterprise. A method that exists on only one product fails with a clear error before any request is sent, instead of returning a bare `404`.

## Install

```bash
pip install xberg-io-sdk                       # Python
pnpm add @xberg-io/sdk                         # TypeScript (npm and yarn work too)
go get github.com/xberg-io/sdks/packages/go    # Go
```

| Language   | Package                                | Import                                                   |
| ---------- | -------------------------------------- | -------------------------------------------------------- |
| Python     | `xberg-io-sdk`                         | `from xberg_io_sdk import XbergClient, AsyncXbergClient` |
| TypeScript | `@xberg-io/sdk`                        | `import { XbergClient } from "@xberg-io/sdk"`            |
| Go         | `github.com/xberg-io/sdks/packages/go` | `import xberg "github.com/xberg-io/sdks/packages/go"`    |

## Configure the client

Every client needs the base URL of your deployment and an API key. The SDKs do not read environment variables on their own, so pass both explicitly. Use a project API key for the data plane; see [Projects and API keys](/guides/projects-and-api-keys/).

```python title="Python"
import os
from xberg_io_sdk import XbergClient

client = XbergClient(
    base_url="https://xberg.example.com",
    api_key=os.environ["XBERG_API_KEY"],
)
```

```ts title="TypeScript"
import { XbergClient } from "@xberg-io/sdk";

const client = new XbergClient({
  baseUrl: "https://xberg.example.com",
  apiKey: process.env.XBERG_API_KEY!,
});
```

```go title="Go"
client, err := xberg.New(
    xberg.WithBaseURL("https://xberg.example.com"),
    xberg.WithAPIKey(os.Getenv("XBERG_API_KEY")),
)
```

The client reads the product from `/healthz` and gates product-specific methods accordingly. Pass `target="pro"` or `target="enterprise"` to skip that probe (`target: "pro"` in TypeScript, `xberg.WithTarget(xberg.TargetPro)` in Go). Pro serves everything on one base URL. Enterprise serves the data plane and the control plane on the same host when you use the chart's gateway routes.

## Next steps

Run your first extraction in the [quickstart](/start/quickstart/). For every method, retry policy, error type and streaming helper, read the SDK documentation at [docs.sdks.xberg.io](https://docs.sdks.xberg.io).
