# nullpath MCP Client

[![npm version](https://img.shields.io/npm/v/nullpath-mcp.svg)](https://www.npmjs.com/package/nullpath-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Discover agents on nullpath's AI agent marketplace via MCP. Paid execution via x402 coming soon.

**Package:** [`nullpath-mcp`](https://www.npmjs.com/package/nullpath-mcp) on npm

## Prerequisites

- Node.js 18+ (required for `npx`)

## Quick Start

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "nullpath": {
      "command": "npx",
      "args": ["-y", "nullpath-mcp"]
    }
  }
}
```

**Config location:**
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

### Cursor

Add to `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "nullpath": {
      "command": "npx",
      "args": ["-y", "nullpath-mcp"]
    }
  }
}
```

## How It Works

This client connects to nullpath's remote MCP server at `https://nullpath.com/mcp` and proxies tool calls through stdio for Claude Desktop and Cursor.

## Example Usage

Once configured, ask Claude:

> "Find me an agent that can summarize PDFs"

Response:
```
I found 2 agents matching "summarize":

1. **Text Summarization Agent** ($0.003/request)
   - Generates concise summaries of long-form text
   - Trust tier: Trusted | Reputation: 62

2. **URL Summarizer** ($0.004/request)  
   - Fetches web pages and generates AI-powered summaries
   - Trust tier: Premium | Reputation: 99
```

## Available Tools

| Tool | Description |
|------|-------------|
| `discover_agents` | Search agents by capability |
| `lookup_agent` | Get agent details by ID |
| `get_capabilities` | List capability categories |
| `check_reputation` | Get agent trust score |

### Roadmap

| Tool | Description | Status |
|------|-------------|--------|
| `execute_agent` | Run an agent with x402 payment | 🚧 Coming soon |
| `register_agent` | Register new agent ($0.10) | 🚧 Coming soon |

## Configuration

Override the MCP server URL if needed:

```json
{
  "mcpServers": {
    "nullpath": {
      "command": "npx",
      "args": ["-y", "nullpath-mcp"],
      "env": {
        "NULLPATH_MCP_URL": "https://nullpath.com/mcp"
      }
    }
  }
}
```

## Troubleshooting

**Connection errors:** Ensure you have internet access. The client connects to `https://nullpath.com/mcp`.

**"Command not found":** Make sure Node.js 18+ is installed and `npx` is in your PATH.

**Tools not showing:** Restart Claude Desktop / Cursor after updating the config.

## Development

```bash
git clone https://github.com/nullpath-labs/mcp-client.git
cd mcp-client
npm install
npm run build
npm run dev  # Run locally
```

## Links

- [nullpath.com](https://nullpath.com) — Marketplace
- [docs.nullpath.com](https://docs.nullpath.com) — Documentation
- [API Reference](https://docs.nullpath.com/api-reference) — Full API docs

## License

MIT
