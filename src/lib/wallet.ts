/**
 * Wallet Client Setup for nullpath MCP Client
 *
 * Creates a viem wallet client from the NULLPATH_WALLET_KEY
 * environment variable for signing EIP-3009 payments.
 * 
 * Also supports Coinbase Agentic Wallet (awal) as an alternative
 * payment method when available.
 */

import { createWalletClient, http, type WalletClient, type Account } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { checkAwalStatus, isAwalForced, type AwalStatus } from './awal.js';

/**
 * Environment variable name for the wallet private key
 */
export const WALLET_KEY_ENV = 'NULLPATH_WALLET_KEY';

/**
 * Wallet configuration
 */
export interface WalletConfig {
  /** Private key (with or without 0x prefix) */
  privateKey?: string;
  /** RPC URL for Base (optional, uses default public RPC) */
  rpcUrl?: string;
}

/**
 * Wallet client with account information
 */
export interface NullpathWallet {
  /** viem wallet client for signing */
  client: WalletClient;
  /** Account derived from private key */
  account: Account;
  /** Wallet address */
  address: `0x${string}`;
}

/**
 * Error thrown when wallet is not configured
 */
export class WalletNotConfiguredError extends Error {
  constructor() {
    super(
      `Wallet not configured. Set ${WALLET_KEY_ENV} environment variable with your private key.`
    );
    this.name = 'WalletNotConfiguredError';
  }
}

/**
 * Error thrown when private key is invalid
 */
export class InvalidPrivateKeyError extends Error {
  constructor(reason: string) {
    super(`Invalid private key: ${reason}`);
    this.name = 'InvalidPrivateKeyError';
  }
}

/**
 * Normalize private key to proper format
 *
 * Accepts keys with or without 0x prefix
 */
function normalizePrivateKey(key: string): `0x${string}` {
  const trimmed = key.trim();

  // Add 0x prefix if missing
  const prefixed = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;

  // Validate length (0x + 64 hex chars = 66 chars)
  if (prefixed.length !== 66) {
    throw new InvalidPrivateKeyError(
      `Expected 64 hex characters, got ${prefixed.length - 2}`
    );
  }

  // Validate hex format
  if (!/^0x[0-9a-fA-F]{64}$/.test(prefixed)) {
    throw new InvalidPrivateKeyError('Must contain only hexadecimal characters');
  }

  return prefixed as `0x${string}`;
}

/**
 * Create a wallet client from configuration or environment
 *
 * @param config - Optional wallet configuration. If not provided,
 *                 reads from NULLPATH_WALLET_KEY environment variable.
 * @returns NullpathWallet with client, account, and address
 * @throws WalletNotConfiguredError if no private key available
 * @throws InvalidPrivateKeyError if private key format is invalid
 *
 * @example
 * ```ts
 * // From environment variable
 * const wallet = createWallet();
 *
 * // From explicit config
 * const wallet = createWallet({ privateKey: '0x...' });
 *
 * // Use for signing
 * const signed = await signTransferAuthorization(wallet.client, params);
 * ```
 */
export function createWallet(config?: WalletConfig): NullpathWallet {
  // Get private key from config or environment
  const rawKey = config?.privateKey ?? process.env[WALLET_KEY_ENV];

  if (!rawKey) {
    throw new WalletNotConfiguredError();
  }

  // Normalize and validate
  const privateKey = normalizePrivateKey(rawKey);

  // Create account from private key
  const account = privateKeyToAccount(privateKey);

  // Create wallet client for Base mainnet
  const client = createWalletClient({
    account,
    chain: base,
    transport: http(config?.rpcUrl),
  });

  return {
    client,
    account,
    address: account.address,
  };
}

/**
 * Check if wallet is configured (without creating it)
 *
 * @returns true if NULLPATH_WALLET_KEY is set
 */
export function isWalletConfigured(): boolean {
  return !!process.env[WALLET_KEY_ENV];
}

/**
 * Get wallet address without full client setup
 *
 * Useful for checking the configured address without
 * creating a full wallet client.
 *
 * @returns Wallet address or null if not configured
 */
export function getWalletAddress(): `0x${string}` | null {
  const rawKey = process.env[WALLET_KEY_ENV];
  if (!rawKey) return null;

  try {
    const privateKey = normalizePrivateKey(rawKey);
    const account = privateKeyToAccount(privateKey);
    return account.address;
  } catch {
    return null;
  }
}

/**
 * Payment method preference
 */
export type PaymentMethod = 'awal' | 'direct' | 'none';

/**
 * Payment configuration
 */
export interface PaymentConfig {
  /** Preferred payment method */
  method: PaymentMethod;
  /** Wallet address (for either method) */
  address?: string;
  /** Awal status if using awal */
  awalStatus?: AwalStatus;
}

/**
 * Determine the preferred payment method
 *
 * Priority:
 * 1. If NULLPATH_USE_AWAL=true, try awal first
 * 2. If awal is available and authenticated, use awal
 * 3. If NULLPATH_WALLET_KEY is set, use direct signing
 * 4. Otherwise, no payment method available
 *
 * @returns PaymentConfig with preferred method
 */
export async function getPaymentConfig(): Promise<PaymentConfig> {
  // Check if awal is forced
  const forceAwal = isAwalForced();

  // Check awal status
  const awalStatus = await checkAwalStatus();

  // If awal is available and authenticated, use it
  if (awalStatus.available && awalStatus.authenticated) {
    return {
      method: 'awal',
      address: awalStatus.address,
      awalStatus,
    };
  }

  // If awal was forced but not available/authenticated, don't fall back to direct
  if (forceAwal) {
    return {
      method: 'none',
      awalStatus,
    };
  }

  // Fall back to direct signing if wallet key is configured
  if (isWalletConfigured()) {
    const address = getWalletAddress();
    return {
      method: 'direct',
      address: address ?? undefined,
    };
  }

  return { method: 'none' };
}

/**
 * Check if any payment method is available
 *
 * @returns true if either awal or direct signing is configured
 */
export async function isPaymentConfigured(): Promise<boolean> {
  const config = await getPaymentConfig();
  return config.method !== 'none';
}
