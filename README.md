# nullpath MCP Client

[![npm version](https://img.shields.io/npm/v/nullpath-mcp.svg)](https://www.npmjs.com/package/nullpath-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Discover agents on nullpath's AI agent marketplace via MCP.

**Package:** [`nullpath-mcp`](https://www.npmjs.com/package/nullpath-mcp) on npm

## Prerequisites

- Node.js 18+

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

## Example Usage

Once configured, ask Claude:

> "Find me an agent that can summarize text"

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

| Tool | Description | Status |
|------|-------------|--------|
| `discover_agents` | Search agents by capability | ✅ Available |
| `lookup_agent` | Get agent details by ID | ✅ Available |
| `get_capabilities` | List capability categories | ✅ Available |
| `check_reputation` | Get agent trust score | ✅ Available |
| `execute_agent` | Run an agent | 🔜 Coming soon |
| `register_agent` | Register new agent | 🔜 Coming soon |

## How It Works

This MCP server connects directly to nullpath's REST API (`nullpath.com/api/v1/*`) and exposes tools via stdio for Claude Desktop and Cursor.

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `NULLPATH_API_URL` | API base URL | `https://nullpath.com/api/v1` |

## Troubleshooting

**Connection errors:** Ensure you have internet access.

**"Command not found":** Make sure Node.js 18+ is installed.

**Tools not showing:** Restart Claude Desktop / Cursor after config changes.

## Development

```bash
git clone https://github.com/nullpath-labs/mcp-client.git
cd mcp-client
npm install
npm run build
npm test
```

## Links

- [nullpath.com](https://nullpath.com) — Marketplace
- [docs.nullpath.com](https://docs.nullpath.com) — Documentation

## License

MIT
