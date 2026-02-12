/**
 * Coinbase Agentic Wallet (awal) Integration
 *
 * Provides alternative payment method using awal CLI for x402 payments.
 * Falls back to direct EIP-3009 signing if awal is not available.
 *
 * @see https://docs.cdp.coinbase.com/agentic-wallet/skills/pay-for-service
 */

import { exec, execSync } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Environment variable to force awal usage
 */
export const USE_AWAL_ENV = 'NULLPATH_USE_AWAL';

/**
 * Cache for awal status check
 */
let awalStatusCache: AwalStatus | null = null;
let awalStatusCacheTime = 0;
const CACHE_TTL_MS = 60_000; // 1 minute

/**
 * Status of awal CLI
 */
export interface AwalStatus {
  /** Whether awal CLI is available */
  available: boolean;
  /** Whether user is authenticated */
  authenticated: boolean;
  /** Wallet address if authenticated */
  address?: string;
  /** Error message if check failed */
  error?: string;
}

/**
 * Response from awal x402 pay command
 */
export interface AwalPaymentResponse {
  /** Whether payment succeeded */
  success: boolean;
  /** Response body from the paid request */
  body?: unknown;
  /** HTTP status code of the response */
  statusCode?: number;
  /** Error message if payment failed */
  error?: string;
  /** Payment details */
  payment?: {
    amount?: string;
    recipient?: string;
    transactionHash?: string;
  };
}

/**
 * Error thrown when awal payment fails
 */
export class AwalPaymentError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'AwalPaymentError';
  }
}

/**
 * Check if NULLPATH_USE_AWAL is set to force awal mode
 */
export function isAwalForced(): boolean {
  const value = process.env[USE_AWAL_ENV];
  return value === 'true' || value === '1';
}

/**
 * Check awal CLI status (availability and authentication)
 *
 * Results are cached for 1 minute to avoid repeated CLI calls.
 *
 * @returns AwalStatus with availability and auth state
 */
export async function checkAwalStatus(): Promise<AwalStatus> {
  // Check cache
  if (awalStatusCache && Date.now() - awalStatusCacheTime < CACHE_TTL_MS) {
    return awalStatusCache;
  }

  try {
    // Check if awal is available and get status
    const { stdout } = await execAsync('npx awal@latest status --json', {
      timeout: 15_000, // 15 second timeout for npx
      env: { ...process.env, NO_COLOR: '1' },
    });

    const status = JSON.parse(stdout.trim());

    awalStatusCache = {
      available: true,
      authenticated: status.authenticated === true || status.loggedIn === true,
      address: status.address || status.walletAddress,
    };
    awalStatusCacheTime = Date.now();
    return awalStatusCache;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Check for specific error types
    if (errorMessage.includes('not found') || errorMessage.includes('ENOENT')) {
      awalStatusCache = {
        available: false,
        authenticated: false,
        error: 'awal CLI not found',
      };
    } else if (errorMessage.includes('timeout')) {
      awalStatusCache = {
        available: false,
        authenticated: false,
        error: 'awal CLI timeout',
      };
    } else {
      awalStatusCache = {
        available: false,
        authenticated: false,
        error: errorMessage,
      };
    }

    awalStatusCacheTime = Date.now();
    return awalStatusCache;
  }
}

/**
 * Synchronous check for awal availability (uses cached result if available)
 *
 * @returns true if awal was previously detected as available and authenticated
 */
export function isAwalAvailable(): boolean {
  if (awalStatusCache && Date.now() - awalStatusCacheTime < CACHE_TTL_MS) {
    return awalStatusCache.available && awalStatusCache.authenticated;
  }
  return false;
}

/**
 * Clear the awal status cache
 */
export function clearAwalCache(): void {
  awalStatusCache = null;
  awalStatusCacheTime = 0;
}

/**
 * Execute a paid request using awal x402 pay
 *
 * @param url - The URL to call
 * @param options - Request options (method, body, headers)
 * @returns AwalPaymentResponse with result or error
 */
export async function awalPay(
  url: string,
  options: {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
  } = {}
): Promise<AwalPaymentResponse> {
  const { method = 'GET', body, headers } = options;

  // Build the awal command
  const args: string[] = ['npx', 'awal@latest', 'x402', 'pay', url];

  // Add method
  if (method !== 'GET') {
    args.push('-X', method);
  }

  // Add body
  if (body) {
    args.push('-d', body);
  }

  // Add headers
  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      args.push('-H', `${key}: ${value}`);
    }
  }

  // Request JSON output
  args.push('--json');

  const command = args.map(arg => {
    // Quote arguments that contain spaces or special characters
    if (/[\s"'\\]/.test(arg)) {
      return `'${arg.replace(/'/g, "'\\''")}'`;
    }
    return arg;
  }).join(' ');

  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout: 60_000, // 60 second timeout for payment
      env: { ...process.env, NO_COLOR: '1' },
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large responses
    });

    // Parse JSON response
    const response = JSON.parse(stdout.trim());

    // Handle different response formats
    if (response.error) {
      return {
        success: false,
        error: response.error,
        statusCode: response.statusCode,
      };
    }

    return {
      success: true,
      body: response.body || response.data || response,
      statusCode: response.statusCode || 200,
      payment: {
        amount: response.payment?.amount,
        recipient: response.payment?.recipient,
        transactionHash: response.payment?.transactionHash || response.txHash,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Parse stderr for error details if available
    if (error instanceof Error && 'stderr' in error) {
      const stderr = (error as { stderr?: string }).stderr;
      if (stderr) {
        // Try to parse stderr as JSON
        try {
          const errorJson = JSON.parse(stderr);
          return {
            success: false,
            error: errorJson.error || errorJson.message || stderr,
          };
        } catch {
          return {
            success: false,
            error: stderr.trim() || errorMessage,
          };
        }
      }
    }

    throw new AwalPaymentError(
      `awal payment failed: ${errorMessage}`,
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Get the awal wallet address (if authenticated)
 *
 * @returns Wallet address or null if not available
 */
export async function getAwalAddress(): Promise<string | null> {
  const status = await checkAwalStatus();
  return status.address || null;
}
