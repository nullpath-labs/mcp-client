/**
 * Payment Integration for nullpath MCP Client
 *
 * Handles x402 payment flow:
 * 1. Parse 402 Payment Required responses
 * 2. Sign EIP-3009 TransferWithAuthorization
 * 3. Encode payment header for retry
 */

import {
  signTransferAuthorization,
  generateNonce,
  type TransferAuthorizationParams,
  type SignedTransferAuthorization,
} from './eip3009.js';
import {
  createWallet,
  isWalletConfigured,
  WalletNotConfiguredError,
  type NullpathWallet,
} from './wallet.js';

/**
 * Payment requirements from 402 response
 */
export interface PaymentRequirements {
  /** Recipient wallet address */
  recipient: `0x${string}`;
  /** Amount in atomic USDC units */
  amount: bigint;
  /** USDC contract address */
  asset: `0x${string}`;
  /** Chain ID (8453 for Base) */
  network: number;
  /** Unix timestamp - authorization valid after */
  validAfter: bigint;
  /** Unix timestamp - authorization valid before */
  validBefore: bigint;
}

/**
 * Payment header payload
 */
export interface PaymentPayload {
  signature: string;
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

/**
 * Error thrown when payment is required but cannot be made
 */
export class PaymentRequiredError extends Error {
  constructor(
    message: string,
    public readonly requirements?: PaymentRequirements
  ) {
    super(message);
    this.name = 'PaymentRequiredError';
  }
}

/**
 * Error thrown when payment signing fails
 */
export class PaymentSigningError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'PaymentSigningError';
  }
}

/**
 * Parse 402 Payment Required response headers
 *
 * Extracts payment requirements from X-PAYMENT-REQUIRED header.
 * The header contains base64-encoded JSON with payment details.
 *
 * @param response - Fetch Response object
 * @returns PaymentRequirements or null if not a 402 response
 */
export function parsePaymentRequired(response: Response): PaymentRequirements | null {
  if (response.status !== 402) {
    return null;
  }

  const header = response.headers.get('X-PAYMENT-REQUIRED');
  if (!header) {
    // Try legacy header name
    const legacyHeader = response.headers.get('X-Payment-Required');
    if (!legacyHeader) {
      throw new PaymentRequiredError(
        'Payment required but X-PAYMENT-REQUIRED header missing'
      );
    }
    return parsePaymentHeader(legacyHeader);
  }

  return parsePaymentHeader(header);
}

/**
 * Parse the payment header value
 */
function parsePaymentHeader(header: string): PaymentRequirements {
  try {
    // Decode base64
    const decoded = Buffer.from(header, 'base64').toString('utf-8');
    const data = JSON.parse(decoded);

    // Extract and validate required fields
    const recipient = data.recipient || data.payee;
    const amount = data.amount || data.maxAmountRequired;
    const asset = data.asset || data.usdcAddress;
    const network = data.network || data.chainId || 8453;
    
    // Default validity window: now to 5 minutes from now
    const now = Math.floor(Date.now() / 1000);
    const validAfter = BigInt(data.validAfter || 0);
    const validBefore = BigInt(data.validBefore || now + 300);

    // Ensure authorization window is still valid
    if (validBefore <= BigInt(now)) {
      throw new Error(`Payment authorization expired: validBefore ${validBefore} is in the past`);
    }

    if (!recipient || !amount) {
      throw new Error('Missing recipient or amount');
    }

    return {
      recipient: recipient as `0x${string}`,
      amount: BigInt(amount),
      asset: (asset || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913') as `0x${string}`,
      network: Number(network),
      validAfter,
      validBefore,
    };
  } catch (error) {
    throw new PaymentRequiredError(
      `Failed to parse payment requirements: ${error instanceof Error ? error.message : 'unknown error'}`
    );
  }
}

/**
 * Sign a payment using EIP-3009 TransferWithAuthorization
 *
 * @param wallet - NullpathWallet instance
 * @param requirements - Payment requirements from 402 response
 * @returns Signed authorization
 */
export async function signPayment(
  wallet: NullpathWallet,
  requirements: PaymentRequirements
): Promise<SignedTransferAuthorization> {
  try {
    const params: TransferAuthorizationParams = {
      from: wallet.address,
      to: requirements.recipient,
      value: requirements.amount,
      validAfter: requirements.validAfter,
      validBefore: requirements.validBefore,
      nonce: generateNonce(),
    };

    return await signTransferAuthorization(wallet.client, params);
  } catch (error) {
    throw new PaymentSigningError(
      `Failed to sign payment: ${error instanceof Error ? error.message : 'unknown error'}`,
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Encode signed authorization as X-PAYMENT header value
 *
 * @param signed - Signed transfer authorization
 * @returns Base64-encoded JSON string for X-PAYMENT header
 */
export function encodePaymentHeader(signed: SignedTransferAuthorization): string {
  const payload: PaymentPayload = {
    signature: signed.signature,
    from: signed.from,
    to: signed.to,
    value: signed.value.toString(),
    validAfter: signed.validAfter.toString(),
    validBefore: signed.validBefore.toString(),
    nonce: signed.nonce,
  };

  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

/**
 * Execute a fetch request with automatic x402 payment handling
 *
 * If the server returns 402 Payment Required:
 * 1. Parse payment requirements
 * 2. Sign EIP-3009 authorization
 * 3. Retry with X-PAYMENT header
 *
 * @param url - Request URL
 * @param options - Fetch options
 * @returns Fetch Response
 * @throws WalletNotConfiguredError if 402 and no wallet
 * @throws PaymentSigningError if signing fails
 */
export async function fetchWithPayment(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  // Make initial request
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  // Check for 402 Payment Required
  if (response.status !== 402) {
    return response;
  }

  // Payment required - check if wallet is configured
  if (!isWalletConfigured()) {
    throw new WalletNotConfiguredError();
  }

  // Parse payment requirements
  const requirements = parsePaymentRequired(response);
  if (!requirements) {
    throw new PaymentRequiredError('Payment required but could not parse requirements');
  }

  // Create wallet and sign payment
  const wallet = createWallet();
  const signed = await signPayment(wallet, requirements);
  const paymentHeader = encodePaymentHeader(signed);

  // Retry with payment header
  const retryResponse = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
      'X-PAYMENT': paymentHeader,
    },
  });

  // If still 402, payment was rejected
  if (retryResponse.status === 402) {
    const errorBody = await retryResponse.text().catch(() => '');
    throw new PaymentRequiredError(
      `Payment was rejected by the server: ${errorBody || 'no details'}`,
      requirements
    );
  }

  // Handle other errors on retry
  if (!retryResponse.ok) {
    const errorBody = await retryResponse.text().catch(() => '');
    throw new Error(`Payment submitted but request failed (${retryResponse.status}): ${errorBody}`);
  }

  return retryResponse;
}

/**
 * Format amount in human-readable USDC
 */
export function formatUsdcAmount(atomic: bigint): string {
  const usd = Number(atomic) / 1_000_000;
  return `$${usd.toFixed(6)} USDC`;
}

// Re-export wallet utilities for convenience
export { isWalletConfigured, WalletNotConfiguredError } from './wallet.js';
