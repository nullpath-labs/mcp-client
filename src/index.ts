#!/usr/bin/env node

/**
 * nullpath MCP Client
 * 
 * Connects to nullpath.com API - AI agent marketplace with x402 micropayments.
 * 
 * Available tools:
 * - discover_agents: Search agents by capability
 * - lookup_agent: Get agent details by ID
 * - execute_agent: Run an agent (paid via x402)
 * - register_agent: Register a new agent (paid)
 * - get_capabilities: List capability categories
 * - check_reputation: Get agent trust score
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  fetchWithPayment,
  formatUsdcAmount,
  isWalletConfigured,
  WalletNotConfiguredError,
  PaymentRequiredError,
  PaymentSigningError,
} from './lib/payment.js';
import { getWalletAddress } from './lib/wallet.js';

const NULLPATH_API_URL = process.env.NULLPATH_API_URL || 'https://nullpath.com/api/v1';

// Tool definitions
const TOOLS = [
  {
    name: 'discover_agents',
    description: 'Search for agents by capability, category, or query. Returns a list of matching agents with their pricing and reputation.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query (e.g., "summarize", "translate", "code review")' },
        category: { type: 'string', description: 'Filter by category (e.g., "text", "code", "data")' },
        limit: { type: 'number', description: 'Maximum results to return (default: 10)' },
      },
    },
  },
  {
    name: 'lookup_agent',
    description: 'Get detailed information about a specific agent by ID, including capabilities, pricing, and reputation.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agentId: { type: 'string', description: 'The agent UUID' },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'get_capabilities',
    description: 'List all capability categories available in the marketplace.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'check_reputation',
    description: 'Get the reputation score and trust tier for an agent.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agentId: { type: 'string', description: 'The agent UUID' },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'execute_agent',
    description: 'Execute an agent capability. Requires payment via x402 (USDC on Base). Set NULLPATH_WALLET_KEY env var for payments.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agentId: { type: 'string', description: 'The agent UUID' },
        capabilityId: { type: 'string', description: 'The capability to execute' },
        input: { type: 'object', description: 'Input parameters for the capability' },
      },
      required: ['agentId', 'capabilityId', 'input'],
    },
  },
  {
    name: 'register_agent',
    description: 'Register a new agent on the marketplace. Requires $0.10 USDC payment. Set NULLPATH_WALLET_KEY env var.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Agent name' },
        description: { type: 'string', description: 'Agent description' },
        wallet: { type: 'string', description: 'Wallet address for receiving payments' },
        capabilities: { 
          type: 'array', 
          description: 'List of capabilities with pricing',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              description: { type: 'string' },
              price: { type: 'string', description: 'Price in USDC (e.g., "0.01")' },
            },
          },
        },
        endpoint: { type: 'string', description: 'Execution endpoint URL' },
      },
      required: ['name', 'description', 'wallet', 'capabilities', 'endpoint'],
    },
  },
];

// API helper
async function apiCall(endpoint: string, options: RequestInit = {}): Promise<unknown> {
  const url = `${NULLPATH_API_URL}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API error (${response.status}): ${error}`);
  }
  
  return response.json();
}

// Tool handlers
async function handleDiscoverAgents(args: { query?: string; category?: string; limit?: number }) {
  const params = new URLSearchParams();
  if (args.query) params.set('q', args.query);
  if (args.category) params.set('category', args.category);
  if (args.limit) params.set('limit', args.limit.toString());
  
  const queryString = params.toString();
  const endpoint = `/discover${queryString ? `?${queryString}` : ''}`;
  
  return apiCall(endpoint);
}

async function handleLookupAgent(args: { agentId: string }) {
  return apiCall(`/agents/${args.agentId}`);
}

async function handleGetCapabilities() {
  // Return the capability categories from discover endpoint
  const result = await apiCall('/discover') as { data?: { agents?: Array<{ capabilities?: unknown[] }> } };
  const agents = result?.data?.agents || [];
  const categories = new Set<string>();
  
  for (const agent of agents) {
    if (agent.capabilities) {
      for (const cap of agent.capabilities as Array<{ id?: string }>) {
        if (cap.id) categories.add(cap.id.split('-')[0]);
      }
    }
  }
  
  return { categories: Array.from(categories) };
}

async function handleCheckReputation(args: { agentId: string }) {
  const result = await apiCall(`/agents/${args.agentId}`) as { 
    data?: { 
      reputation_score?: number; 
      trustTier?: string;
      avgLatencyMs?: number;
    } 
  };
  
  return {
    agentId: args.agentId,
    reputationScore: result?.data?.reputation_score,
    trustTier: result?.data?.trustTier,
    avgLatencyMs: result?.data?.avgLatencyMs,
  };
}

async function handleExecuteAgent(args: { agentId: string; capabilityId: string; input: unknown }) {
  // Check wallet configuration upfront for better error messages
  if (!isWalletConfigured()) {
    return {
      error: 'Wallet not configured',
      message: 'Set NULLPATH_WALLET_KEY environment variable with your private key to execute paid agents.',
      hint: 'Add to Claude Desktop config: "env": { "NULLPATH_WALLET_KEY": "0x..." }',
    };
  }

  const url = `${NULLPATH_API_URL}/execute`;
  const body = JSON.stringify({
    targetAgentId: args.agentId,
    capabilityId: args.capabilityId,
    input: args.input,
  });

  try {
    // Use fetchWithPayment for automatic 402 handling
    const response = await fetchWithPayment(url, {
      method: 'POST',
      body,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API error (${response.status}): ${error}`);
    }

    const result = await response.json() as Record<string, unknown>;
    
    // Add wallet info to response for transparency
    const walletAddress = getWalletAddress() ?? 'unknown';
    return {
      ...result,
      _payment: {
        status: 'paid',
        from: walletAddress,
      },
    };
  } catch (error) {
    if (error instanceof WalletNotConfiguredError) {
      return {
        error: 'Wallet not configured',
        message: error.message,
        hint: 'Add NULLPATH_WALLET_KEY to your environment variables.',
      };
    }
    if (error instanceof PaymentRequiredError) {
      return {
        error: 'Payment failed',
        message: error.message,
        requirements: error.requirements ? {
          recipient: error.requirements.recipient,
          amount: formatUsdcAmount(error.requirements.amount),
        } : undefined,
      };
    }
    if (error instanceof PaymentSigningError) {
      return {
        error: 'Payment signing failed',
        message: error.message,
        hint: 'Check that your wallet has sufficient USDC balance on Base.',
      };
    }
    throw error;
  }
}

async function handleRegisterAgent(args: {
  name: string;
  description: string;
  wallet: string;
  capabilities: unknown[];
  endpoint: string;
}) {
  // Check wallet configuration upfront for better error messages
  if (!isWalletConfigured()) {
    return {
      error: 'Wallet not configured',
      message: 'Set NULLPATH_WALLET_KEY environment variable to register agents.',
      hint: 'Registration costs $0.10 USDC. Add to Claude Desktop config: "env": { "NULLPATH_WALLET_KEY": "0x..." }',
    };
  }

  const url = `${NULLPATH_API_URL}/agents`;
  const body = JSON.stringify(args);

  try {
    // Use fetchWithPayment for automatic 402 handling
    const response = await fetchWithPayment(url, {
      method: 'POST',
      body,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API error (${response.status}): ${error}`);
    }

    const result = await response.json() as Record<string, unknown>;
    
    // Add wallet info to response for transparency
    const walletAddress = getWalletAddress() ?? 'unknown';
    return {
      ...result,
      _payment: {
        status: 'paid',
        from: walletAddress,
        cost: '$0.10 USDC',
      },
    };
  } catch (error) {
    if (error instanceof WalletNotConfiguredError) {
      return {
        error: 'Wallet not configured',
        message: error.message,
        cost: '$0.10 USDC required for registration',
      };
    }
    if (error instanceof PaymentRequiredError) {
      return {
        error: 'Payment failed',
        message: error.message,
        requirements: error.requirements ? {
          recipient: error.requirements.recipient,
          amount: formatUsdcAmount(error.requirements.amount),
        } : undefined,
      };
    }
    if (error instanceof PaymentSigningError) {
      return {
        error: 'Payment signing failed',
        message: error.message,
        hint: 'Ensure your wallet has at least $0.10 USDC on Base.',
      };
    }
    throw error;
  }
}

// Main server
async function main() {
  const server = new Server(
    {
      name: 'nullpath-mcp',
      version: '1.2.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  // Call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      let result: unknown;

      switch (name) {
        case 'discover_agents':
          result = await handleDiscoverAgents(args as { query?: string; category?: string; limit?: number });
          break;
        case 'lookup_agent':
          result = await handleLookupAgent(args as { agentId: string });
          break;
        case 'get_capabilities':
          result = await handleGetCapabilities();
          break;
        case 'check_reputation':
          result = await handleCheckReputation(args as { agentId: string });
          break;
        case 'execute_agent':
          result = await handleExecuteAgent(args as { agentId: string; capabilityId: string; input: unknown });
          break;
        case 'register_agent':
          result = await handleRegisterAgent(args as {
            name: string;
            description: string;
            wallet: string;
            capabilities: unknown[];
            endpoint: string;
          });
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${message}`,
          },
        ],
        isError: true,
      };
    }
  });

  // Start server
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  console.error('nullpath MCP server started');
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
