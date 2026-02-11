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
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address, Hex } from 'viem';

const NULLPATH_MCP_URL = process.env.NULLPATH_MCP_URL || 'https://nullpath.com/mcp';

/**
 * Payment requirements from x402 402 response
 */
export interface PaymentRequirements {
  scheme: 'exact';
  network: 'base' | 'base-sepolia';
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: Address;
  maxTimeoutSeconds: number;
  asset: Address;
  extra: Record<string, unknown>;
}

/**
 * x402 error response structure from MCP server
 */
export interface X402ErrorData {
  x402Version: number;
  error: string;
  accepts: PaymentRequirements[];
  priceBreakdown?: {
    platformFee: number;
    agentFee: number;
    platformCut: number;
    agentEarnings: number;
    total: number;
    currency: string;
  };
}

/**
 * EIP-3009 TransferWithAuthorization typed data
 */
const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

/**
 * USDC contract metadata by network
 */
const USDC_CONTRACTS: Record<string, { name: string; version: string; chainId: number }> = {
  'base': { name: 'USD Coin', version: '2', chainId: 8453 },
  'base-sepolia': { name: 'USD Coin', version: '2', chainId: 84532 },
};

/**
 * Payment payload structure
 */
export interface PaymentPayload {
  x402Version: number;
  scheme: 'exact';
  network: string;
  payload: {
    signature: `0x${string}`;
    authorization: {
      from: Address;
      to: Address;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: `0x${string}`;
    };
  };
}

/**
 * Generate a random 32-byte nonce for EIP-3009
 */
function generateNonce(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')}` as `0x${string}`;
}

/**
 * Wallet with address and signing capability
 */
export interface Wallet {
  address: Address;
  privateKey: Hex;
}

/**
 * Sign an EIP-3009 TransferWithAuthorization
 */
export async function signTransferAuthorization(
  wallet: Wallet,
  requirements: PaymentRequirements
): Promise<PaymentPayload> {
  const network = requirements.network;
  const contractMeta = USDC_CONTRACTS[network];
  
  if (!contractMeta) {
    throw new Error(`Unsupported network: ${network}`);
  }

  const now = Math.floor(Date.now() / 1000);
  const validAfter = now - 60; // Valid from 1 minute ago
  const validBefore = now + requirements.maxTimeoutSeconds;
  const nonce = generateNonce();

  const authorization = {
    from: wallet.address,
    to: requirements.payTo,
    value: BigInt(requirements.maxAmountRequired),
    validAfter: BigInt(validAfter),
    validBefore: BigInt(validBefore),
    nonce,
  };

  // Create account for signing
  const account = privateKeyToAccount(wallet.privateKey);
  
  const signature = await account.signTypedData({
    domain: {
      name: contractMeta.name,
      version: contractMeta.version,
      chainId: contractMeta.chainId,
      verifyingContract: requirements.asset,
    },
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: 'TransferWithAuthorization',
    message: authorization,
  });

  return {
    x402Version: 1,
    scheme: 'exact',
    network,
    payload: {
      signature,
      authorization: {
        from: wallet.address,
        to: requirements.payTo,
        value: authorization.value.toString(),
        validAfter: authorization.validAfter.toString(),
        validBefore: authorization.validBefore.toString(),
        nonce,
      },
    },
  };
}

/**
 * Encode payment payload to base64 for X-PAYMENT header
 */
export function encodePaymentHeader(payment: PaymentPayload): string {
  return Buffer.from(JSON.stringify(payment)).toString('base64');
}

/**
 * Check if an error response is an x402 payment required error
 */
export function isX402Error(error: unknown): error is { code: number; message: string; data: X402ErrorData } {
  if (typeof error !== 'object' || error === null) return false;
  const err = error as Record<string, unknown>;
  if (err.code !== -32000) return false;
  if (typeof err.data !== 'object' || err.data === null) return false;
  const data = err.data as Record<string, unknown>;
  return typeof data.x402Version === 'number' && Array.isArray(data.accepts);
}

/**
 * Get wallet from environment variable
 */
export function getWallet(): Wallet {
  const privateKey = process.env.NULLPATH_WALLET_KEY;
  
  if (!privateKey) {
    throw new Error(
      'NULLPATH_WALLET_KEY environment variable is required for paid tool calls. ' +
      'Set it to your wallet private key (0x-prefixed hex string).'
    );
  }

  // Ensure the key is properly formatted
  const formattedKey = privateKey.startsWith('0x') 
    ? privateKey as Hex
    : `0x${privateKey}` as Hex;

  const account = privateKeyToAccount(formattedKey);
  
  return {
    address: account.address,
    privateKey: formattedKey,
  };
}

/**
 * Handle x402 payment flow
 * 
 * 1. Parse payment requirements from 402 error
 * 2. Sign EIP-3009 authorization
 * 3. Return payment header for retry
 */
export async function handleX402Payment(
  errorData: X402ErrorData
): Promise<string> {
  const wallet = getWallet();
  
  if (errorData.accepts.length === 0) {
    throw new Error('No payment options available in 402 response');
  }

  // Use the first payment option
  const requirements = errorData.accepts[0];
  
  // Sign the payment authorization
  const payment = await signTransferAuthorization(wallet, requirements);
  
  // Encode for header
  return encodePaymentHeader(payment);
}

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
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return tools;
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      // First attempt without payment
      const result = await client.callTool({
        name: request.params.name,
        arguments: request.params.arguments,
      });
      return result;
    } catch (error: unknown) {
      // Check if this is a 402 Payment Required error
      if (isX402Error(error)) {
        console.error(`Payment required for tool: ${request.params.name}`);
        
        try {
          // Handle x402 payment
          const paymentHeader = await handleX402Payment(error.data);
          
          // Retry with payment header
          // Note: The MCP SDK doesn't directly support custom headers on tool calls,
          // so we need to make the request ourselves with the payment header
          const retryResult = await retryWithPayment(
            request.params.name,
            request.params.arguments,
            paymentHeader
          );
          
          return retryResult;
        } catch (paymentError) {
          // Re-throw with more context
          throw new Error(
            `Payment failed for tool ${request.params.name}: ${
              paymentError instanceof Error ? paymentError.message : String(paymentError)
            }`
          );
        }
      }
      
      // Re-throw non-payment errors
      throw error;
    }
  });

  // Start local stdio transport
  const stdioTransport = new StdioServerTransport();
  await server.connect(stdioTransport);

  console.error('nullpath MCP client connected to', NULLPATH_MCP_URL);
}

/**
 * Retry a tool call with x402 payment header
 * 
 * Makes a direct HTTP request to the MCP server with the X-PAYMENT header
 */
async function retryWithPayment(
  toolName: string,
  args: Record<string, unknown> | undefined,
  paymentHeader: string
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const requestBody = {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: args || {},
    },
    id: Date.now(),
  };

  const response = await fetch(NULLPATH_MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-PAYMENT': paymentHeader,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  const result = await response.json() as {
    jsonrpc: string;
    result?: { content: Array<{ type: string; text: string }> };
    error?: { code: number; message: string; data?: unknown };
    id: number;
  };

  if (result.error) {
    throw new Error(`RPC Error: ${result.error.message}`);
  }

  return result.result || { content: [{ type: 'text', text: 'Success' }] };
}

main().catch((error) => {
  console.error('Failed to start nullpath MCP client:', error);
  process.exit(1);
});
