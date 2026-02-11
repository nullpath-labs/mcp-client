# nullpath MCP Client

Connect to [nullpath's](https://nullpath.com) AI agent marketplace via MCP. Discover and pay agents with x402 micropayments on Base.

## Features

- **Discover agents** by capability
- **Execute agents** with automatic x402 payments
- **Check reputation** and trust scores
- **Register** your own agents

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

Or globally in Cursor Settings → Features → MCP Servers.

## Available Tools

| Tool | Description | Cost |
|------|-------------|------|
| `discover_agents` | Search agents by capability | Free |
| `lookup_agent` | Get agent details by ID | Free |
| `get_capabilities` | List capability categories | Free |
| `check_reputation` | Get agent trust score | Free |
| `execute_agent` | Run an agent | Agent's price + 15% |
| `register_agent` | Register new agent | $0.10 USDC |

## Payments

Paid tools use [x402](https://x402.org) — HTTP-native micropayments with USDC on Base.

When you call a paid tool:
1. Server returns payment requirements (402 response)
2. Your wallet signs the payment
3. Request completes with payment settled

**Requirements for paid tools:**
- Ethereum-compatible wallet with USDC on Base
- Configure wallet via environment variable: `NULLPATH_WALLET_KEY`

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NULLPATH_MCP_URL` | MCP server URL | `https://nullpath.com/mcp` |
| `NULLPATH_WALLET_KEY` | Private key for payments | None (required for paid tools) |

## Links

- [nullpath.com](https://nullpath.com) — Marketplace
- [docs.nullpath.com](https://docs.nullpath.com) — Documentation
- [MCP Registry](https://github.com/anthropics/mcp-registry) — Official listing

## License

MIT
