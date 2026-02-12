/**
 * Payment Integration for nullpath MCP Client
 *
 * Handles x402 payment flow:
 * 1. Parse 402 Payment Required responses
 * 2. Sign EIP-3009 TransferWithAuthorization OR use awal CLI
 * 3. Encode payment header for retry (direct signing)
 * 4. Or delegate to awal x402 pay (awal mode)
 */

import {
  signTransferAuthorization,
  generateNonce,
  USDC_ADDRESS_BASE,
  type TransferAuthorizationParams,
  type SignedTransferAuthorization,
} from './eip3009.js';
import {
  createWallet,
  isWalletConfigured,
  WalletNotConfiguredError,
  InvalidPrivateKeyError,
  getPaymentConfig,
  type NullpathWallet,
  type PaymentConfig,
} from './wallet.js';
import {
  awalPay,
  AwalPaymentError,
  type AwalPaymentResponse,
} from './awal.js';

/** Expected network for payments (Base mainnet) */
const EXPECTED_NETWORK = 8453;

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
      asset: (asset || USDC_ADDRESS_BASE) as `0x${string}`,
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
  // Validate that the requested payment matches our signing configuration
  const requestedNetwork = requirements.network;
  const requestedAsset = requirements.asset?.toLowerCase();
  const expectedAsset = USDC_ADDRESS_BASE.toLowerCase();

  if (requestedNetwork !== EXPECTED_NETWORK || requestedAsset !== expectedAsset) {
    throw new PaymentRequiredError(
      `Payment requirements mismatch: requested network ${requestedNetwork} and asset ${requirements.asset} ` +
      `do not match supported Base mainnet USDC (network ${EXPECTED_NETWORK}, asset ${USDC_ADDRESS_BASE}).`
    );
  }

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
 * Build headers for fetch, properly handling Headers instances
 */
function buildHeaders(base?: RequestInit['headers'], extra?: Record<string, string>): Headers {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const headers = new Headers(base as any);
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      headers.set(key, value);
    }
  }
  return headers;
}

/**
 * Result from fetchWithPayment including payment metadata
 */
export interface FetchWithPaymentResult {
  /** The fetch Response object */
  response: Response;
  /** Payment method used (if payment was made) */
  paymentMethod?: 'awal' | 'direct';
  /** Address that paid (if payment was made) */
  paidFrom?: string;
}

/**
 * Execute a fetch request with automatic x402 payment handling
 *
 * Payment methods (in order of preference):
 * 1. Coinbase Agentic Wallet (awal) - if available and authenticated
 * 2. Direct EIP-3009 signing - if NULLPATH_WALLET_KEY is set
 *
 * If the server returns 402 Payment Required:
 * - awal mode: Delegates to `awal x402 pay` command
 * - direct mode: Signs EIP-3009 authorization and retries with X-PAYMENT header
 *
 * @param url - Request URL
 * @param options - Fetch options
 * @returns Fetch Response
 * @throws WalletNotConfiguredError if 402 and no payment method available
 * @throws PaymentSigningError if signing fails
 * @throws AwalPaymentError if awal payment fails
 */
export async function fetchWithPayment(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  // Get payment configuration
  const paymentConfig = await getPaymentConfig();

  // Build headers properly (handles both plain objects and Headers instances)
  const initialHeaders = buildHeaders(options.headers, {
    'Content-Type': 'application/json',
  });

  // Make initial request
  const response = await fetch(url, {
    ...options,
    headers: initialHeaders,
  });

  // Check for 402 Payment Required
  if (response.status !== 402) {
    return response;
  }

  // Payment required - check if any payment method is available
  if (paymentConfig.method === 'none') {
    throw new WalletNotConfiguredError();
  }

  // Use awal for payment if configured
  if (paymentConfig.method === 'awal') {
    return handleAwalPayment(url, options);
  }

  // Use direct signing
  return handleDirectPayment(url, options, response);
}

/**
 * Handle payment using Coinbase Agentic Wallet (awal)
 */
async function handleAwalPayment(
  url: string,
  options: RequestInit
): Promise<Response> {
  // Extract headers as plain object
  const headers: Record<string, string> = {};
  const originalHeaders = options.headers;
  
  if (originalHeaders) {
    if (originalHeaders instanceof Headers) {
      originalHeaders.forEach((value, key) => {
        headers[key] = value;
      });
    } else if (Array.isArray(originalHeaders)) {
      for (const [key, value] of originalHeaders) {
        headers[key] = value;
      }
    } else {
      Object.assign(headers, originalHeaders);
    }
  }

  // Ensure Content-Type is set
  if (!headers['Content-Type'] && !headers['content-type']) {
    headers['Content-Type'] = 'application/json';
  }

  try {
    const result = await awalPay(url, {
      method: options.method as string || 'GET',
      body: options.body as string | undefined,
      headers,
    });

    if (!result.success) {
      throw new AwalPaymentError(result.error || 'awal payment failed');
    }

    // Create a synthetic Response from awal result
    const responseBody = typeof result.body === 'string' 
      ? result.body 
      : JSON.stringify(result.body);

    return new Response(responseBody, {
      status: result.statusCode || 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Payment-Method': 'awal',
      },
    });
  } catch (error) {
    if (error instanceof AwalPaymentError) {
      throw error;
    }
    throw new AwalPaymentError(
      `awal payment failed: ${error instanceof Error ? error.message : String(error)}`,
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Handle payment using direct EIP-3009 signing
 */
async function handleDirectPayment(
  url: string,
  options: RequestInit,
  initialResponse: Response
): Promise<Response> {
  // Parse payment requirements from 402 response
  const requirements = parsePaymentRequired(initialResponse);
  if (!requirements) {
    throw new PaymentRequiredError('Payment required but could not parse requirements');
  }

  // Create wallet and sign payment
  let wallet: NullpathWallet;
  try {
    wallet = createWallet();
  } catch (error) {
    if (error instanceof InvalidPrivateKeyError) {
      throw new PaymentSigningError(
        `Invalid wallet configuration: ${error.message}`,
        error
      );
    }
    throw error;
  }

  const signed = await signPayment(wallet, requirements);
  const paymentHeader = encodePaymentHeader(signed);

  // Build retry headers with payment
  const retryHeaders = buildHeaders(options.headers, {
    'Content-Type': 'application/json',
    'X-PAYMENT': paymentHeader,
  });

  // Retry with payment header
  const retryResponse = await fetch(url, {
    ...options,
    headers: retryHeaders,
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
 * Format amount in human-readable USDC (using bigint arithmetic to avoid precision loss)
 */
export function formatUsdcAmount(atomic: bigint): string {
  const whole = atomic / 1_000_000n;
  const fraction = atomic % 1_000_000n;
  const fractionStr = fraction.toString().padStart(6, '0');
  return `$${whole.toString()}.${fractionStr} USDC`;
}

// Re-export wallet utilities for convenience
export { isWalletConfigured, WalletNotConfiguredError, InvalidPrivateKeyError, getPaymentConfig } from './wallet.js';
export { AwalPaymentError, checkAwalStatus, isAwalForced } from './awal.js';
