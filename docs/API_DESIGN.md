# x402 Payment Signing API Design

> API design for automatic EIP-3009 payment signing in the nullpath MCP client.

**Note:** This is a design document. The actual implementation may differ slightly. See the source files for current interfaces.

## Overview

This document defines the interfaces for three new modules that enable seamless x402 micropayments:

```
src/lib/
├── wallet.ts      # Wallet client setup from env
├── payment.ts     # 402 detection, signing, retry logic
└── eip3009.ts     # EIP-3009 typed data structures
```

---

## Type Definitions

### Core Types

Types are defined within each module file (wallet.ts, payment.ts, eip3009.ts):

```typescript
// Types defined in respective module files

import type { Address, Hex } from 'viem';

/**
 * Wallet configuration derived from environment.
 */
export interface WalletConfig {
  /** Private key (hex string with 0x prefix) */
  privateKey: Hex;
  /** Chain ID (8453 for Base mainnet) */
  chainId: number;
  /** USDC contract address for the chain */
  usdcAddress: Address;
}

/**
 * Payment requirements parsed from X-PAYMENT-REQUIRED header.
 * Server sends this on 402 response.
 */
export interface PaymentRequired {
  /** Recipient wallet address */
  recipient: Address;
  /** Payment amount in USDC base units (6 decimals) */
  amount: bigint;
  /** USDC contract address */
  asset: Address;
  /** Network identifier (e.g., "base") */
  network: string;
  /** Unix timestamp - signature valid after */
  validAfter: bigint;
  /** Unix timestamp - signature valid before */
  validBefore: bigint;
  /** Optional: specific nonce from server */
  nonce?: Hex;
}

/**
 * Signed payment to send in X-PAYMENT header.
 */
export interface PaymentSignature {
  /** EIP-3009 signature */
  signature: Hex;
  /** Payer address (derived from wallet) */
  from: Address;
  /** Recipient address */
  to: Address;
  /** Amount in base units */
  value: string;
  /** Unix timestamp */
  validAfter: string;
  /** Unix timestamp */
  validBefore: string;
  /** Random nonce (32 bytes) */
  nonce: Hex;
}

/**
 * Result of a payment-aware API call.
 */
export interface PaymentResult<T = unknown> {
  /** Response data on success */
  data?: T;
  /** Whether payment was made */
  paid: boolean;
  /** Payment details if paid */
  payment?: {
    amount: string;
    recipient: Address;
    txHash?: Hex;
  };
}
```

### Error Types

```typescript
// src/lib/errors.ts

/**
 * Base error for all payment-related failures.
 */
export class PaymentError extends Error {
  constructor(
    message: string,
    public readonly code: PaymentErrorCode,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'PaymentError';
  }
}

export enum PaymentErrorCode {
  /** NULLPATH_WALLET_KEY not set */
  WALLET_NOT_CONFIGURED = 'WALLET_NOT_CONFIGURED',
  /** Private key format invalid */
  INVALID_PRIVATE_KEY = 'INVALID_PRIVATE_KEY',
  /** Could not parse X-PAYMENT-REQUIRED header */
  INVALID_PAYMENT_HEADER = 'INVALID_PAYMENT_HEADER',
  /** Signature generation failed */
  SIGNING_FAILED = 'SIGNING_FAILED',
  /** Payment was made but server still rejected */
  PAYMENT_REJECTED = 'PAYMENT_REJECTED',
  /** Network mismatch (e.g., server wants Sepolia, client on Base) */
  NETWORK_MISMATCH = 'NETWORK_MISMATCH',
  /** Insufficient balance (optional: if we add balance checks) */
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
}

/**
 * Type guard for PaymentError.
 */
export function isPaymentError(error: unknown): error is PaymentError {
  return error instanceof PaymentError;
}
```

---

## Module APIs

### 1. wallet.ts - Wallet Client Setup

```typescript
// src/lib/wallet.ts

import type { WalletClient, Account, Chain } from 'viem';
import type { WalletConfig } from './types';

/**
 * Environment variable name for wallet private key.
 */
export const WALLET_KEY_ENV = 'NULLPATH_WALLET_KEY';

/**
 * Supported chain configurations.
 */
export const SUPPORTED_CHAINS = {
  base: {
    chainId: 8453,
    usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const,
  },
  'base-sepolia': {
    chainId: 84532,
    usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const,
  },
} as const;

/**
 * Load wallet configuration from environment.
 * 
 * @throws {PaymentError} If NULLPATH_WALLET_KEY is not set or invalid
 * @returns Wallet configuration
 * 
 * @example
 * ```typescript
 * const config = getWalletConfig();
 * // { privateKey: '0x...', chainId: 8453, usdcAddress: '0x833...' }
 * ```
 */
export function getWalletConfig(): WalletConfig;

/**
 * Check if wallet is configured (non-throwing).
 * 
 * @returns true if NULLPATH_WALLET_KEY is set
 */
export function isWalletConfigured(): boolean;

/**
 * Create a viem wallet client for signing.
 * 
 * @param config - Wallet configuration (from getWalletConfig)
 * @returns Configured wallet client
 * 
 * @example
 * ```typescript
 * const config = getWalletConfig();
 * const wallet = createWalletClient(config);
 * const address = wallet.account.address; // '0x...'
 * ```
 */
export function createWallet(config: WalletConfig): WalletClient;

/**
 * Get the account address from a private key.
 * Useful for display without creating full wallet client.
 * 
 * @param privateKey - Hex private key
 * @returns Account with address
 */
export function getAccount(privateKey: Hex): Account;
```

### 2. eip3009.ts - EIP-3009 Typed Data

```typescript
// src/lib/eip3009.ts

import type { Address, Hex, TypedDataDomain } from 'viem';

/**
 * EIP-3009 TransferWithAuthorization typed data.
 * Used for gasless USDC transfers.
 */
export interface TransferWithAuthorizationMessage {
  from: Address;
  to: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
}

/**
 * Get the EIP-712 domain for USDC on a specific chain.
 * 
 * @param chainId - Target chain ID
 * @param usdcAddress - USDC contract address
 * @returns EIP-712 domain separator
 * 
 * @example
 * ```typescript
 * const domain = getUSDCDomain(8453, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
 * // { name: 'USD Coin', version: '2', chainId: 8453n, verifyingContract: '0x833...' }
 * ```
 */
export function getUSDCDomain(chainId: number, usdcAddress: Address): TypedDataDomain;

/**
 * EIP-712 type definitions for TransferWithAuthorization.
 * Used with viem's signTypedData.
 */
export const TRANSFER_WITH_AUTHORIZATION_TYPES: {
  TransferWithAuthorization: readonly [
    { name: 'from'; type: 'address' },
    { name: 'to'; type: 'address' },
    { name: 'value'; type: 'uint256' },
    { name: 'validAfter'; type: 'uint256' },
    { name: 'validBefore'; type: 'uint256' },
    { name: 'nonce'; type: 'bytes32' },
  ];
};

/**
 * Generate a random 32-byte nonce for EIP-3009.
 * 
 * @returns Random hex nonce
 */
export function generateNonce(): Hex;

/**
 * Build the complete typed data object for signing.
 * 
 * @param domain - EIP-712 domain
 * @param message - Transfer authorization message
 * @returns Complete typed data for signTypedData
 */
export function buildTypedData(
  domain: TypedDataDomain,
  message: TransferWithAuthorizationMessage
): {
  domain: TypedDataDomain;
  types: typeof TRANSFER_WITH_AUTHORIZATION_TYPES;
  primaryType: 'TransferWithAuthorization';
  message: TransferWithAuthorizationMessage;
};
```

### 3. payment.ts - Payment Flow Orchestration

```typescript
// src/lib/payment.ts

import type { Address, Hex } from 'viem';
import type { PaymentRequired, PaymentSignature, PaymentResult, WalletConfig } from './types';

/**
 * Parse the X-PAYMENT-REQUIRED header from a 402 response.
 * 
 * @param header - Base64-encoded JSON from X-PAYMENT-REQUIRED
 * @returns Parsed payment requirements
 * @throws {PaymentError} If header is malformed
 * 
 * @example
 * ```typescript
 * const header = response.headers.get('X-PAYMENT-REQUIRED');
 * const requirements = parsePaymentRequired(header);
 * // { recipient: '0x...', amount: 10000n, asset: '0x...', ... }
 * ```
 */
export function parsePaymentRequired(header: string): PaymentRequired;

/**
 * Encode a payment signature for the X-PAYMENT header.
 * 
 * @param payment - Signed payment data
 * @returns Base64-encoded JSON for X-PAYMENT header
 */
export function encodePaymentHeader(payment: PaymentSignature): string;

/**
 * Sign an EIP-3009 TransferWithAuthorization.
 * 
 * @param config - Wallet configuration
 * @param requirements - Payment requirements from server
 * @returns Signed payment ready for X-PAYMENT header
 * @throws {PaymentError} If signing fails
 * 
 * @example
 * ```typescript
 * const config = getWalletConfig();
 * const requirements = parsePaymentRequired(header);
 * const signed = await signPayment(config, requirements);
 * // { signature: '0x...', from: '0x...', to: '0x...', ... }
 * ```
 */
export function signPayment(
  config: WalletConfig,
  requirements: PaymentRequired
): Promise<PaymentSignature>;

/**
 * Make an API call with automatic 402 payment handling.
 * 
 * Behavior:
 * 1. Make initial request
 * 2. If 402 received, parse X-PAYMENT-REQUIRED
 * 3. Sign EIP-3009 authorization
 * 4. Retry request with X-PAYMENT header
 * 5. Return result (max 1 retry)
 * 
 * @param url - Full API URL
 * @param options - Fetch options (method, body, headers)
 * @param walletConfig - Optional wallet config (uses env if not provided)
 * @returns Response data with payment info
 * @throws {PaymentError} If payment required but wallet not configured
 * @throws {PaymentError} If payment rejected after retry
 * 
 * @example
 * ```typescript
 * const result = await apiCallWithPayment('/api/v1/execute', {
 *   method: 'POST',
 *   body: JSON.stringify({ agentId: '...', input: {...} }),
 * });
 * 
 * if (result.paid) {
 *   console.log(`Paid ${result.payment.amount} to ${result.payment.recipient}`);
 * }
 * ```
 */
export function apiCallWithPayment<T = unknown>(
  url: string,
  options?: RequestInit,
  walletConfig?: WalletConfig
): Promise<PaymentResult<T>>;

/**
 * Check if a response requires payment.
 * 
 * @param response - Fetch response
 * @returns true if status is 402
 */
export function isPaymentRequired(response: Response): boolean;
```

---

## Integration Points in index.ts

### Modified apiCall Function

```typescript
// Replace the existing apiCall with payment-aware version

import { apiCallWithPayment, isWalletConfigured } from './lib/payment';
import { PaymentError, PaymentErrorCode } from './lib/errors';

async function apiCall<T = unknown>(
  endpoint: string, 
  options: RequestInit = {},
  requiresPayment = false
): Promise<T> {
  const url = `${NULLPATH_API_URL}${endpoint}`;
  
  // For endpoints that might require payment
  if (requiresPayment) {
    const result = await apiCallWithPayment<T>(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    
    // Log payment for user visibility (optional)
    if (result.paid && result.payment) {
      console.error(`[nullpath] Paid ${result.payment.amount} USDC to ${result.payment.recipient}`);
    }
    
    return result.data as T;
  }
  
  // Standard call for free endpoints
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
  
  return response.json() as Promise<T>;
}
```

### Updated Tool Handlers

```typescript
// handleExecuteAgent - now with payment

async function handleExecuteAgent(args: { 
  agentId: string; 
  capabilityId: string; 
  input: unknown 
}) {
  // Check wallet early for better error message
  if (!isWalletConfigured()) {
    return {
      error: 'Wallet not configured',
      code: PaymentErrorCode.WALLET_NOT_CONFIGURED,
      help: 'Set NULLPATH_WALLET_KEY environment variable with your private key (0x...)',
    };
  }
  
  try {
    return await apiCall('/execute', {
      method: 'POST',
      body: JSON.stringify({
        targetAgentId: args.agentId,
        capabilityId: args.capabilityId,
        input: args.input,
      }),
    }, true); // requiresPayment = true
  } catch (error) {
    if (isPaymentError(error)) {
      return {
        error: error.message,
        code: error.code,
        help: getPaymentErrorHelp(error.code),
      };
    }
    throw error;
  }
}

// handleRegisterAgent - now with payment

async function handleRegisterAgent(args: {
  name: string;
  description: string;
  wallet: string;
  capabilities: unknown[];
  endpoint: string;
}) {
  if (!isWalletConfigured()) {
    return {
      error: 'Wallet not configured',
      code: PaymentErrorCode.WALLET_NOT_CONFIGURED,
      help: 'Registration costs $0.10 USDC. Set NULLPATH_WALLET_KEY to proceed.',
    };
  }
  
  try {
    return await apiCall('/agents', {
      method: 'POST',
      body: JSON.stringify(args),
    }, true);
  } catch (error) {
    if (isPaymentError(error)) {
      return {
        error: error.message,
        code: error.code,
        help: getPaymentErrorHelp(error.code),
      };
    }
    throw error;
  }
}

// Helper for user-friendly error messages
function getPaymentErrorHelp(code: PaymentErrorCode): string {
  switch (code) {
    case PaymentErrorCode.WALLET_NOT_CONFIGURED:
      return 'Set NULLPATH_WALLET_KEY in your Claude Desktop config.';
    case PaymentErrorCode.INVALID_PRIVATE_KEY:
      return 'Private key must be a 64-character hex string starting with 0x.';
    case PaymentErrorCode.PAYMENT_REJECTED:
      return 'Payment signature was rejected. Check wallet has USDC on Base.';
    case PaymentErrorCode.NETWORK_MISMATCH:
      return 'Server expects a different network. Check NULLPATH_API_URL.';
    default:
      return 'See https://nullpath.com/docs/payments for troubleshooting.';
  }
}
```

---

## Error Handling Strategy

### Layered Error Handling

```
┌─────────────────────────────────────────────────────────────┐
│  Tool Handler (handleExecuteAgent)                          │
│  - Catches PaymentError, returns user-friendly message      │
│  - Re-throws unexpected errors for MCP error response       │
└─────────────────────────────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  apiCallWithPayment                                          │
│  - Throws PaymentError with specific codes                   │
│  - Wraps network errors with context                        │
└─────────────────────────────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  signPayment / parsePaymentRequired                          │
│  - Throws PaymentError for signing/parsing failures         │
│  - Preserves original error as cause                        │
└─────────────────────────────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  viem (signTypedData)                                        │
│  - Low-level errors wrapped by signPayment                  │
└─────────────────────────────────────────────────────────────┘
```

### Error Code to User Message Mapping

| Code | User Message | Recovery Action |
|------|--------------|-----------------|
| `WALLET_NOT_CONFIGURED` | "Wallet not configured" | Set `NULLPATH_WALLET_KEY` env var |
| `INVALID_PRIVATE_KEY` | "Invalid private key format" | Check key is 0x + 64 hex chars |
| `INVALID_PAYMENT_HEADER` | "Server sent invalid payment request" | Report bug to nullpath |
| `SIGNING_FAILED` | "Could not sign payment" | Check key permissions |
| `PAYMENT_REJECTED` | "Payment was rejected" | Check USDC balance on Base |
| `NETWORK_MISMATCH` | "Network mismatch" | Verify API URL matches network |

---

## Usage Examples

### Claude Desktop Config

```json
{
  "mcpServers": {
    "nullpath": {
      "command": "npx",
      "args": ["nullpath-mcp"],
      "env": {
        "NULLPATH_WALLET_KEY": "0x..."
      }
    }
  }
}
```

### Programmatic Usage

```typescript
import { 
  getWalletConfig, 
  isWalletConfigured,
  signPayment,
  parsePaymentRequired 
} from 'nullpath-mcp/lib';

// Check if ready for payments
if (!isWalletConfigured()) {
  console.log('Set NULLPATH_WALLET_KEY for paid features');
}

// Manual signing (advanced usage)
const config = getWalletConfig();
const requirements = parsePaymentRequired(header);
const signed = await signPayment(config, requirements);
```

---

## File Structure After Implementation

```
src/
├── index.ts                 # Main MCP server (modified)
├── lib/
│   ├── index.ts             # Re-exports for clean imports
│   ├── types.ts             # Type definitions
│   ├── errors.ts            # PaymentError class
│   ├── wallet.ts            # Wallet setup
│   ├── payment.ts           # Payment flow
│   └── eip3009.ts           # EIP-3009 typed data
└── __tests__/
    ├── wallet.test.ts
    ├── payment.test.ts
    └── eip3009.test.ts
```

---

## Implementation Notes

### For Blockchain Engineer (wallet.ts, eip3009.ts)

1. Use `viem` v2.21+ for all signing operations
2. `privateKeyToAccount` for deriving address from key
3. `signTypedData` for EIP-712 signatures
4. Domain separator must match USDC contract exactly:
   ```typescript
   {
     name: 'USD Coin',
     version: '2',
     chainId: 8453n,
     verifyingContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
   }
   ```
5. Nonce is random 32 bytes (not sequential like EIP-2612)

### For Backend Engineer (payment.ts)

1. Headers are base64-encoded JSON
2. `X-PAYMENT-REQUIRED` → PaymentRequired (server sends)
3. `X-PAYMENT` → PaymentSignature (client sends)
4. Single retry on 402 (no retry loops)
5. Log payment details to stderr for visibility in Claude Desktop

### Testing Strategy

1. **Unit tests**: Mock viem signing, test parse/encode functions
2. **Integration tests**: Use Base Sepolia with test USDC
3. **E2E tests**: Against nullpath staging with real signatures

---

## Open Questions

1. **Balance checking**: Should we pre-check USDC balance before attempting payment?
   - Pro: Better error messages
   - Con: Extra RPC call, may be stale
   
2. **Transaction hash**: Should client wait for on-chain confirmation?
   - Current design: No, server handles settlement
   - Alternative: Return txHash in PaymentResult for receipt

3. **Multi-network**: Support both Base mainnet and Sepolia?
   - Recommend: Auto-detect from NULLPATH_API_URL or separate env var

---

## Revision History

| Date | Author | Changes |
|------|--------|---------|
| 2026-02-10 | API Design Agent | Initial design |
