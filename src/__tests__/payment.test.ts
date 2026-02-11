import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parsePaymentRequired,
  encodePaymentHeader,
  formatUsdcAmount,
  PaymentRequiredError,
} from '../lib/payment.js';

describe('payment', () => {
  describe('parsePaymentRequired', () => {
    it('returns null for non-402 responses', () => {
      const response = new Response('OK', { status: 200 });
      expect(parsePaymentRequired(response)).toBeNull();
    });

    it('throws if 402 but missing X-PAYMENT-REQUIRED header', () => {
      const response = new Response('Payment Required', { status: 402 });
      expect(() => parsePaymentRequired(response)).toThrow(PaymentRequiredError);
    });

    it('parses valid 402 response with payment header', () => {
      const requirements = {
        recipient: '0x1234567890123456789012345678901234567890',
        amount: '1000000', // 1 USDC
        network: 8453,
        validAfter: 0,
        validBefore: Math.floor(Date.now() / 1000) + 300,
      };
      const encoded = Buffer.from(JSON.stringify(requirements)).toString('base64');

      const response = new Response('Payment Required', {
        status: 402,
        headers: { 'X-PAYMENT-REQUIRED': encoded },
      });

      const parsed = parsePaymentRequired(response);
      expect(parsed).not.toBeNull();
      expect(parsed!.recipient).toBe(requirements.recipient);
      expect(parsed!.amount).toBe(BigInt(requirements.amount));
      expect(parsed!.network).toBe(8453);
    });

    it('handles string amounts', () => {
      const requirements = {
        recipient: '0x1234567890123456789012345678901234567890',
        amount: '500000',
        validBefore: Math.floor(Date.now() / 1000) + 300,
      };
      const encoded = Buffer.from(JSON.stringify(requirements)).toString('base64');

      const response = new Response('', {
        status: 402,
        headers: { 'X-PAYMENT-REQUIRED': encoded },
      });

      const parsed = parsePaymentRequired(response);
      expect(parsed!.amount).toBe(500000n);
    });

    it('rejects expired validBefore', () => {
      const requirements = {
        recipient: '0x1234567890123456789012345678901234567890',
        amount: '1000000',
        validBefore: Math.floor(Date.now() / 1000) - 100, // In the past
      };
      const encoded = Buffer.from(JSON.stringify(requirements)).toString('base64');

      const response = new Response('', {
        status: 402,
        headers: { 'X-PAYMENT-REQUIRED': encoded },
      });

      expect(() => parsePaymentRequired(response)).toThrow(/expired/);
    });
  });

  describe('encodePaymentHeader', () => {
    it('encodes signed authorization as base64 JSON', () => {
      const signed = {
        from: '0x1111111111111111111111111111111111111111' as `0x${string}`,
        to: '0x2222222222222222222222222222222222222222' as `0x${string}`,
        value: 1000000n,
        validAfter: 0n,
        validBefore: 9999999999n,
        nonce: '0x' + '00'.repeat(32) as `0x${string}`,
        signature: '0x' + 'ab'.repeat(65) as `0x${string}`,
        v: 27,
        r: '0x' + 'ab'.repeat(32) as `0x${string}`,
        s: '0x' + 'cd'.repeat(32) as `0x${string}`,
      };

      const encoded = encodePaymentHeader(signed);
      
      // Should be valid base64
      const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8'));
      expect(decoded.from).toBe(signed.from);
      expect(decoded.to).toBe(signed.to);
      expect(decoded.value).toBe('1000000');
      expect(decoded.signature).toBe(signed.signature);
    });
  });

  describe('formatUsdcAmount', () => {
    it('formats small amounts correctly', () => {
      expect(formatUsdcAmount(1000n)).toBe('$0.001000 USDC');
      expect(formatUsdcAmount(10000n)).toBe('$0.010000 USDC');
      expect(formatUsdcAmount(100000n)).toBe('$0.100000 USDC');
    });

    it('formats whole dollar amounts', () => {
      expect(formatUsdcAmount(1000000n)).toBe('$1.000000 USDC');
      expect(formatUsdcAmount(10000000n)).toBe('$10.000000 USDC');
    });

    it('handles zero', () => {
      expect(formatUsdcAmount(0n)).toBe('$0.000000 USDC');
    });

    it('preserves precision for large amounts', () => {
      // This would lose precision with Number conversion
      const largeAmount = 9007199254740993n; // > Number.MAX_SAFE_INTEGER
      const formatted = formatUsdcAmount(largeAmount);
      expect(formatted).toContain('9007199254');
    });
  });
});
