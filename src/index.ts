#!/usr/bin/env node

/**
 * nullpath MCP Client
 * 
 * Connects to nullpath.com/mcp - AI agent marketplace with x402 micropayments.
 * 
 * Available tools:
 * - discover_agents: Search agents by capability
 * - lookup_agent: Get agent details by ID
 * - execute_agent: Run an agent (paid via x402)
 * - register_agent: Register a new agent (paid)
 * - get_capabilities: List capability categories
 * - check_reputation: Get agent trust score
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

const NULLPATH_MCP_URL = process.env.NULLPATH_MCP_URL || 'https://nullpath.com/mcp';

async function main() {
  // Create a local stdio server that proxies to nullpath's remote MCP
  const server = new Server(
    {
      name: 'nullpath-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Connect to remote nullpath MCP server
  const transport = new SSEClientTransport(new URL(NULLPATH_MCP_URL));
  const client = new Client(
    {
      name: 'nullpath-mcp-proxy',
      version: '1.0.0',
    },
    {
      capabilities: {},
    }
  );

  await client.connect(transport);

  // List available tools from remote server
  const tools = await client.listTools();
  
  // Register tool handlers that proxy to remote
  server.setRequestHandler('tools/list', async () => {
    return tools;
  });

  server.setRequestHandler('tools/call', async (request) => {
    const result = await client.callTool({
      name: request.params.name,
      arguments: request.params.arguments,
    });
    return result;
  });

  // Start local stdio transport
  const stdioTransport = new StdioServerTransport();
  await server.connect(stdioTransport);

  console.error('nullpath MCP client connected to', NULLPATH_MCP_URL);
}

main().catch((error) => {
  console.error('Failed to start nullpath MCP client:', error);
  process.exit(1);
});
