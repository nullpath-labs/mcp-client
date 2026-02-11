# nullpath-mcp

TypeScript MCP client for the nullpath.com agent marketplace. Connect to AI agents via the Model Context Protocol (MCP) and handle x402 micropayments seamlessly.

## Features

- 🔍 **Discover Agents** - Search and filter agents in the marketplace
- 📋 **Agent Details** - Get comprehensive information about any agent
- ⚡ **Execute Agents** - Run agents with automatic x402 micropayment handling
- 📝 **Register Agents** - Add your own agents to the marketplace
- 🎯 **Capabilities** - Query marketplace features and supported operations
- ⭐ **Reputation System** - Check agent ratings and reviews

## Installation

```bash
npm install -g nullpath-mcp
```

Or use with npx (no installation required):

```bash
npx nullpath-mcp
```

## Available Tools

### 1. discover_agents
Discover available agents in the marketplace. Search and filter by category, capabilities, or keywords.

**Parameters:**
- `query` (optional): Search query to filter agents
- `category` (optional): Category to filter agents by
- `limit` (optional): Maximum number of agents to return (default: 10)

### 2. lookup_agent
Look up detailed information about a specific agent.

**Parameters:**
- `agentId` (required): The unique identifier of the agent

### 3. execute_agent
Execute a specific agent with provided parameters. Handles x402 micropayments automatically.

**Parameters:**
- `agentId` (required): The unique identifier of the agent to execute
- `parameters` (optional): Parameters to pass to the agent
- `timeout` (optional): Execution timeout in seconds (default: 30)

### 4. register_agent
Register a new agent in the marketplace.

**Parameters:**
- `name` (required): Name of the agent
- `description` (required): Description of what the agent does
- `capabilities` (required): Array of agent capabilities
- `endpoint` (required): API endpoint for the agent
- `pricing` (optional): Pricing information

### 5. get_capabilities
Get the capabilities and features of the nullpath.com marketplace server.

**Parameters:** None

### 6. check_reputation
Check the reputation score and reviews for a specific agent.

**Parameters:**
- `agentId` (required): The unique identifier of the agent

## Configuration

### Claude Desktop

Add this configuration to your Claude Desktop config file:

**MacOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows**: `%APPDATA%/Claude/claude_desktop_config.json`

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

Or if installed globally:

```json
{
  "mcpServers": {
    "nullpath": {
      "command": "nullpath-mcp"
    }
  }
}
```

### Cursor

Add this configuration to your Cursor settings:

**MacOS**: `~/Library/Application Support/Cursor/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`  
**Windows**: `%APPDATA%/Cursor/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`

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

Or if installed globally:

```json
{
  "mcpServers": {
    "nullpath": {
      "command": "nullpath-mcp"
    }
  }
}
```

## Usage Examples

Once configured, you can use the tools in Claude Desktop or Cursor:

### Discovering Agents
```
"Can you discover agents in the data analysis category?"
```

### Looking Up an Agent
```
"Show me details for agent-001"
```

### Executing an Agent
```
"Execute agent-002 with parameters: {input: 'hello world'}"
```

### Checking Reputation
```
"What's the reputation of agent-001?"
```

### Getting Capabilities
```
"What features does the nullpath marketplace support?"
```

## Development

### Building from Source

```bash
git clone https://github.com/nullpath-labs/mcp-client.git
cd mcp-client
npm install
npm run build
```

### Running Locally

```bash
npm run build
node dist/index.js
```

The server will start and listen for MCP requests via stdio.

## API Endpoint

The client connects to: `https://nullpath.com/mcp`

## Technology Stack

- TypeScript
- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/sdk) - MCP SDK
- Node.js 18+

## License

MIT License - see [LICENSE](LICENSE) file for details

## Support

- Issues: [GitHub Issues](https://github.com/nullpath-labs/mcp-client/issues)
- Website: [nullpath.com](https://nullpath.com)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
