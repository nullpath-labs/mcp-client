/**
 * EIP-3009: Transfer With Authorization for USDC
 *
 * Implements typed data structures and signing for USDC's
 * TransferWithAuthorization function, enabling gasless transfers
 * where a third party can submit the transaction.
 *
 * @see https://eips.ethereum.org/EIPS/eip-3009
 */

import type { WalletClient } from 'viem';

/**
 * USDC contract address on Base mainnet
 */
export const USDC_ADDRESS_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;

/**
 * USDC decimals (standard across all networks)
 */
export const USDC_DECIMALS = 6;

/**
 * EIP-712 Domain for USDC on Base
 */
export const USDC_DOMAIN = {
  name: 'USD Coin',
  version: '2',
  chainId: 8453,
  verifyingContract: USDC_ADDRESS_BASE,
} as const;

/**
 * EIP-712 types for TransferWithAuthorization
 */
export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
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
 * Parameters for TransferWithAuthorization
 */
export interface TransferAuthorizationParams {
  /** Sender address (must match wallet) */
  from: `0x${string}`;
  /** Recipient address */
  to: `0x${string}`;
  /** Amount in atomic units (6 decimals for USDC) */
  value: bigint;
  /** Unix timestamp after which the authorization is valid */
  validAfter: bigint;
  /** Unix timestamp before which the authorization is valid */
  validBefore: bigint;
  /** Unique nonce (32 bytes) to prevent replay */
  nonce: `0x${string}`;
}

/**
 * Signed authorization ready to submit on-chain
 */
export interface SignedTransferAuthorization extends TransferAuthorizationParams {
  /** EIP-712 signature */
  signature: `0x${string}`;
  /** Signature v component */
  v: number;
  /** Signature r component */
  r: `0x${string}`;
  /** Signature s component */
  s: `0x${string}`;
}

/**
 * Generate a cryptographically random nonce (32 bytes)
 */
export function generateNonce(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')}` as `0x${string}`;
}

/**
 * Convert USD amount to USDC atomic units
 */
export function usdToAtomicUsdc(usd: number): bigint {
  return BigInt(Math.round(usd * 10 ** USDC_DECIMALS));
}

/**
 * Convert USDC atomic units to USD
 */
export function atomicUsdcToUsd(atomic: bigint): number {
  return Number(atomic) / 10 ** USDC_DECIMALS;
}

/**
 * Sign a TransferWithAuthorization message
 *
 * Creates an EIP-712 signature that authorizes a transfer of USDC
 * from the signer's wallet to a recipient. The signature can be
 * submitted by anyone to execute the transfer.
 *
 * @param walletClient - viem wallet client with signing capability
 * @param params - Transfer authorization parameters
 * @returns Signed authorization with signature components
 *
 * @example
 * ```ts
 * const signed = await signTransferAuthorization(walletClient, {
 *   from: '0x...',
 *   to: '0x...',
 *   value: usdToAtomicUsdc(0.10),
 *   validAfter: 0n,
 *   validBefore: BigInt(Math.floor(Date.now() / 1000) + 3600),
 *   nonce: generateNonce(),
 * });
 * ```
 */
export async function signTransferAuthorization(
  walletClient: WalletClient,
  params: TransferAuthorizationParams
): Promise<SignedTransferAuthorization> {
  const account = walletClient.account;
  if (!account) {
    throw new Error('Wallet client must have an account');
  }

  // Verify from address matches wallet
  if (params.from.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(
      `From address ${params.from} does not match wallet address ${account.address}`
    );
  }

  // Sign the typed data
  const signature = await walletClient.signTypedData({
    account,
    domain: USDC_DOMAIN,
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: 'TransferWithAuthorization',
    message: {
      from: params.from,
      to: params.to,
      value: params.value,
      validAfter: params.validAfter,
      validBefore: params.validBefore,
      nonce: params.nonce,
    },
  });

  // Validate signature length (65 bytes = 130 hex chars + 0x prefix)
  if (signature.length !== 132) {
    throw new Error(`Unexpected signature length: ${signature.length}, expected 132`);
  }

  // Extract v, r, s components from signature
  const r = `0x${signature.slice(2, 66)}` as `0x${string}`;
  const s = `0x${signature.slice(66, 130)}` as `0x${string}`;
  const v = parseInt(signature.slice(130, 132), 16);

  return {
    ...params,
    signature,
    v,
    r,
    s,
  };
}

/**
 * Create transfer authorization params with sensible defaults
 *
 * @param from - Sender address
 * @param to - Recipient address
 * @param amountUsd - Amount in USD
 * @param validitySeconds - How long the authorization is valid (default 5 minutes)
 * @returns TransferAuthorizationParams ready for signing
 */
export function createTransferAuthorizationParams(
  from: `0x${string}`,
  to: `0x${string}`,
  amountUsd: number,
  validitySeconds: number = 300
): TransferAuthorizationParams {
  const now = Math.floor(Date.now() / 1000);

  return {
    from,
    to,
    value: usdToAtomicUsdc(amountUsd),
    validAfter: 0n, // Valid immediately
    validBefore: BigInt(now + validitySeconds),
    nonce: generateNonce(),
  };
}
