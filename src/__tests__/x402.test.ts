import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  signTransferAuthorization,
  encodePaymentHeader,
  handleX402Payment,
  getWallet,
  isX402Error,
  type PaymentRequirements,
  type X402ErrorData,
  type Wallet,
} from '../index.js';

// Test wallet - DO NOT use in production
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

// USDC addresses
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDC_BASE_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

describe('x402 Payment Signing', () => {
  const mockRequirements: PaymentRequirements = {
    scheme: 'exact',
    network: 'base-sepolia',
    maxAmountRequired: '100000', // 0.10 USDC (6 decimals)
    resource: 'https://nullpath.com/mcp',
    description: 'Payment for MCP tool: register_agent',
    mimeType: 'application/json',
    payTo: '0x1234567890123456789012345678901234567890' as `0x${string}`,
    maxTimeoutSeconds: 300,
    asset: USDC_BASE_SEPOLIA,
    extra: {},
  };

  const testWallet: Wallet = {
    address: TEST_ADDRESS as `0x${string}`,
    privateKey: TEST_PRIVATE_KEY as `0x${string}`,
  };

  describe('signTransferAuthorization', () => {
    it('should sign a valid EIP-3009 authorization for base-sepolia', async () => {
      const payment = await signTransferAuthorization(testWallet, mockRequirements);

      expect(payment.x402Version).toBe(1);
      expect(payment.scheme).toBe('exact');
      expect(payment.network).toBe('base-sepolia');
      expect(payment.payload.signature).toMatch(/^0x[a-fA-F0-9]{130}$/);
      expect(payment.payload.authorization.from).toBe(TEST_ADDRESS);
      expect(payment.payload.authorization.to).toBe(mockRequirements.payTo);
      expect(payment.payload.authorization.value).toBe('100000');
      expect(payment.payload.authorization.nonce).toMatch(/^0x[a-fA-F0-9]{64}$/);
    });

    it('should sign a valid EIP-3009 authorization for base mainnet', async () => {
      const mainnetRequirements: PaymentRequirements = {
        ...mockRequirements,
        network: 'base',
        asset: USDC_BASE,
      };

      const payment = await signTransferAuthorization(testWallet, mainnetRequirements);

      expect(payment.network).toBe('base');
      expect(payment.payload.signature).toMatch(/^0x[a-fA-F0-9]{130}$/);
    });

    it('should throw for unsupported network', async () => {
      const badRequirements = {
        ...mockRequirements,
        network: 'ethereum' as 'base' | 'base-sepolia',
      };

      await expect(signTransferAuthorization(testWallet, badRequirements))
        .rejects.toThrow('Unsupported network: ethereum');
    });

    it('should set validBefore based on maxTimeoutSeconds', async () => {
      const now = Math.floor(Date.now() / 1000);
      const payment = await signTransferAuthorization(testWallet, mockRequirements);

      const validBefore = parseInt(payment.payload.authorization.validBefore, 10);
      // validBefore should be approximately now + maxTimeoutSeconds (within 5 seconds tolerance)
      expect(validBefore).toBeGreaterThan(now + mockRequirements.maxTimeoutSeconds - 5);
      expect(validBefore).toBeLessThan(now + mockRequirements.maxTimeoutSeconds + 5);
    });
  });

  describe('encodePaymentHeader', () => {
    it('should encode payment payload to base64', async () => {
      const payment = await signTransferAuthorization(testWallet, mockRequirements);
      const encoded = encodePaymentHeader(payment);

      // Should be valid base64
      expect(() => Buffer.from(encoded, 'base64')).not.toThrow();

      // Should decode back to valid JSON
      const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8'));
      expect(decoded.x402Version).toBe(1);
      expect(decoded.scheme).toBe('exact');
      expect(decoded.payload.signature).toBe(payment.payload.signature);
    });
  });

  describe('isX402Error', () => {
    it('should return true for valid x402 error', () => {
      const error = {
        code: -32000,
        message: 'Payment required',
        data: {
          x402Version: 1,
          error: 'Payment required for tool: register_agent',
          accepts: [mockRequirements],
        },
      };

      expect(isX402Error(error)).toBe(true);
    });

    it('should return false for non-x402 errors', () => {
      expect(isX402Error(null)).toBe(false);
      expect(isX402Error(undefined)).toBe(false);
      expect(isX402Error({ code: -32600 })).toBe(false);
      expect(isX402Error({ code: -32000, data: {} })).toBe(false);
      expect(isX402Error({ code: -32000, data: { x402Version: 1 } })).toBe(false);
    });
  });
});

describe('Wallet Management', () => {
  const originalEnv = process.env.NULLPATH_WALLET_KEY;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.NULLPATH_WALLET_KEY = originalEnv;
    } else {
      delete process.env.NULLPATH_WALLET_KEY;
    }
  });

  describe('getWallet', () => {
    it('should throw when NULLPATH_WALLET_KEY is not set', () => {
      delete process.env.NULLPATH_WALLET_KEY;

      expect(() => getWallet()).toThrow('NULLPATH_WALLET_KEY environment variable is required');
    });

    it('should return wallet when key is set with 0x prefix', () => {
      process.env.NULLPATH_WALLET_KEY = TEST_PRIVATE_KEY;

      const wallet = getWallet();
      expect(wallet.address).toBe(TEST_ADDRESS);
      expect(wallet.privateKey).toBe(TEST_PRIVATE_KEY);
    });

    it('should handle key without 0x prefix', () => {
      process.env.NULLPATH_WALLET_KEY = TEST_PRIVATE_KEY.slice(2);

      const wallet = getWallet();
      expect(wallet.address).toBe(TEST_ADDRESS);
    });
  });
});

describe('handleX402Payment', () => {
  const mockX402Data: X402ErrorData = {
    x402Version: 1,
    error: 'Payment required for tool: register_agent',
    accepts: [
      {
        scheme: 'exact',
        network: 'base-sepolia',
        maxAmountRequired: '100000',
        resource: 'https://nullpath.com/mcp',
        description: 'Payment for MCP tool: register_agent',
        mimeType: 'application/json',
        payTo: '0x1234567890123456789012345678901234567890' as `0x${string}`,
        maxTimeoutSeconds: 300,
        asset: USDC_BASE_SEPOLIA,
        extra: {},
      },
    ],
  };

  const originalEnv = process.env.NULLPATH_WALLET_KEY;

  beforeEach(() => {
    process.env.NULLPATH_WALLET_KEY = TEST_PRIVATE_KEY;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.NULLPATH_WALLET_KEY = originalEnv;
    } else {
      delete process.env.NULLPATH_WALLET_KEY;
    }
  });

  it('should generate valid payment header from 402 response', async () => {
    const header = await handleX402Payment(mockX402Data);

    // Should be valid base64
    const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf-8'));
    
    expect(decoded.x402Version).toBe(1);
    expect(decoded.scheme).toBe('exact');
    expect(decoded.network).toBe('base-sepolia');
    expect(decoded.payload.signature).toMatch(/^0x[a-fA-F0-9]{130}$/);
    expect(decoded.payload.authorization.from).toBe(TEST_ADDRESS);
    expect(decoded.payload.authorization.to).toBe(mockX402Data.accepts[0].payTo);
    expect(decoded.payload.authorization.value).toBe('100000');
  });

  it('should throw when no payment options available', async () => {
    const emptyData: X402ErrorData = {
      ...mockX402Data,
      accepts: [],
    };

    await expect(handleX402Payment(emptyData))
      .rejects.toThrow('No payment options available in 402 response');
  });

  it('should throw when wallet key is missing', async () => {
    delete process.env.NULLPATH_WALLET_KEY;

    await expect(handleX402Payment(mockX402Data))
      .rejects.toThrow('NULLPATH_WALLET_KEY environment variable is required');
  });
});
