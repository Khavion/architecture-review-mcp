# Khavion Architecture Review MCP server

An MCP server that gives an AI assistant two things it cannot make up: the cloud providers' own best-practice text, quoted word for word with a link, and a rules-based review of Terraform, CloudFormation, and Kubernetes files.

The server itself calls no AI model. Every finding comes from a fixed, version-controlled rule set, and the same input always gives the same output. It runs on your machine over stdio and has zero runtime dependencies.

## Tools

| Tool | What it does | Needs a key |
| --- | --- | --- |
| `lookup_citation` | Up to 5 cited rules for a service (`service`, optional `pillar`, optional `question`). Each has a verbatim quote and the page it came from. | No, always complete |
| `review_iac` | Reviews Terraform, CloudFormation, or Kubernetes file contents (`files`: path and content). | Optional |
| `review_stack` | Reviews a list of services (`tokens`) with an optional sentence about the workload (`intent`). | Optional |
| `explain_finding` | Explains one finding by rule id or by the 8-character id in a report link: why it matters, the fix, the citation. | No, always complete |

## Install

Any MCP client that can start a stdio server works. The command is:

```
npx -y @khavion/architecture-review-mcp
```

Claude Code:

```
claude mcp add architecture-review -- npx -y @khavion/architecture-review-mcp
```

Claude Desktop, Cursor, and most other clients take a JSON entry like this:

```json
{
  "mcpServers": {
    "architecture-review": {
      "command": "npx",
      "args": ["-y", "@khavion/architecture-review-mcp"]
    }
  }
}
```

Node 20 or newer is required.

## Free and keyed output

Without a key, `review_iac` and `review_stack` return the top 3 findings by severity, each with its citation, plus counts for the rest. The output says:

> Free work-email key opens every finding, the quote total, the recommended next step, and a report link: https://khavion.com/tools/api-key

With a valid key, they return every finding, an itemized quote total, the recommended next step, and a link to a report on khavion.com. Every price line ends with "Estimate, not an offer; final pricing by signed statement of work."

Set the key in the server's environment so it never enters the conversation:

```json
{
  "mcpServers": {
    "architecture-review": {
      "command": "npx",
      "args": ["-y", "@khavion/architecture-review-mcp"],
      "env": { "KHAVION_API_KEY": "your-key" }
    }
  }
}
```

If the key cannot be checked (offline, or not accepted), the server falls back to the free output and says why in one sentence.

## What is sent where

The review runs entirely on your machine. File contents, service lists, and tokens are never sent anywhere.

When a key is set, the server makes two calls to khavion.com, and nothing else:

1. `POST /api/api-key/verify` with the key, to check it.
2. `POST /api/api-key/report` with the key, the rule ids of the findings, and one number (how many services were found), to get a report link.

`KHAVION_BASE_URL` can point those two calls at another address, which is useful for testing. It must be https, or http on a local address.

## Citations and license

The server code is MIT licensed (see `LICENSE`).

The quotes in the knowledge base are short passages (25 words or fewer) from the cloud providers' public documentation. They are shown unchanged, with the page they came from, for commentary and attribution. The MIT license covers the code, not those passages: each remains the work of its owner, and lookup and explain results show the license label for each quote.

## About

Built and maintained by Khavion LLC, an independent firm that reviews cloud partner program filings and advises on GenAI projects. Khavion is not affiliated with, endorsed by, or sponsored by Amazon Web Services, Microsoft, or Google. Their names appear only to say which documentation a quote comes from. Questions: hello@khavion.com.

## Source

This repository holds the MCP server as published to npm. `dist/index.js` is the exact file the npm package ships: it bundles the rules engine and the verified citation knowledge base from Khavion's site code, so it needs no install step and makes no network call unless you set a key. `src/` is the server wrapper and the shared review code, for reading; it imports the engine from the site code and is not built from this repository on its own.

Report problems at https://github.com/Khavion/architecture-review-mcp/issues. Licence: MIT for the code; the quotations are public documentation, attributed to their sources.
