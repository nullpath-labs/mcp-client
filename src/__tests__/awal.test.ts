import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.hoisted ensures this runs before vi.mock
const mockExecAsync = vi.hoisted(() => vi.fn());

// Mock util.promisify to return our controllable mock
vi.mock('util', () => ({
  promisify: () => mockExecAsync,
}));

// Import after mocking
import {
  checkAwalStatus,
  isAwalForced,
  clearAwalCache,
  awalPay,
  AwalPaymentError,
  USE_AWAL_ENV,
} from '../lib/awal.js';

describe('awal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAwalCache();
    delete process.env[USE_AWAL_ENV];
  });

  afterEach(() => {
    delete process.env[USE_AWAL_ENV];
  });

  describe('isAwalForced', () => {
    it('returns false when env not set', () => {
      expect(isAwalForced()).toBe(false);
    });

    it('returns true when env is "true"', () => {
      process.env[USE_AWAL_ENV] = 'true';
      expect(isAwalForced()).toBe(true);
    });

    it('returns true when env is "1"', () => {
      process.env[USE_AWAL_ENV] = '1';
      expect(isAwalForced()).toBe(true);
    });

    it('returns false for other values', () => {
      process.env[USE_AWAL_ENV] = 'false';
      expect(isAwalForced()).toBe(false);
    });
  });

  describe('checkAwalStatus', () => {
    it('returns authenticated status when awal is available', async () => {
      mockExecAsync.mockResolvedValueOnce({
        stdout: JSON.stringify({ authenticated: true, address: '0x1234' }),
        stderr: '',
      });

      const status = await checkAwalStatus();
      
      expect(status.available).toBe(true);
      expect(status.authenticated).toBe(true);
      expect(status.address).toBe('0x1234');
    });

    it('handles loggedIn field as alternative to authenticated', async () => {
      mockExecAsync.mockResolvedValueOnce({
        stdout: JSON.stringify({ loggedIn: true, walletAddress: '0xabcd' }),
        stderr: '',
      });

      const status = await checkAwalStatus();
      
      expect(status.available).toBe(true);
      expect(status.authenticated).toBe(true);
      expect(status.address).toBe('0xabcd');
    });

    it('handles awal not found', async () => {
      mockExecAsync.mockRejectedValueOnce(new Error('command not found'));

      const status = await checkAwalStatus();
      
      expect(status.available).toBe(false);
      expect(status.authenticated).toBe(false);
      expect(status.error).toContain('not found');
    });

    it('handles timeout', async () => {
      mockExecAsync.mockRejectedValueOnce(new Error('timeout'));

      const status = await checkAwalStatus();
      
      expect(status.available).toBe(false);
      expect(status.authenticated).toBe(false);
      expect(status.error).toContain('timeout');
    });

    it('caches status results', async () => {
      mockExecAsync.mockResolvedValue({
        stdout: JSON.stringify({ authenticated: true }),
        stderr: '',
      });

      await checkAwalStatus();
      await checkAwalStatus();
      await checkAwalStatus();

      // Should only call exec once due to caching
      expect(mockExecAsync).toHaveBeenCalledTimes(1);
    });
  });

  describe('awalPay', () => {
    it('calls awal x402 pay with correct arguments', async () => {
      mockExecAsync.mockResolvedValueOnce({
        stdout: JSON.stringify({ 
          success: true, 
          body: { result: 'ok' },
          statusCode: 200,
        }),
        stderr: '',
      });

      const result = await awalPay('https://example.com/api', {
        method: 'POST',
        body: '{"test": true}',
        headers: { 'X-Custom': 'header' },
      });

      expect(result.success).toBe(true);
      expect(result.body).toEqual({ result: 'ok' });
      expect(result.statusCode).toBe(200);

      // Verify the command was constructed correctly
      expect(mockExecAsync).toHaveBeenCalled();
      const command = mockExecAsync.mock.calls[0][0];
      expect(command).toContain('npx awal@latest x402 pay');
      expect(command).toContain('https://example.com/api');
      expect(command).toContain('-X POST');
      expect(command).toContain('--json');
    });

    it('handles payment errors from response', async () => {
      mockExecAsync.mockResolvedValueOnce({
        stdout: JSON.stringify({ 
          error: 'Insufficient balance',
          statusCode: 402,
        }),
        stderr: '',
      });

      const result = await awalPay('https://example.com/api');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Insufficient balance');
    });

    it('handles data field as body alternative', async () => {
      mockExecAsync.mockResolvedValueOnce({
        stdout: JSON.stringify({ 
          data: { response: 'value' },
          statusCode: 200,
        }),
        stderr: '',
      });

      const result = await awalPay('https://example.com/api');

      expect(result.success).toBe(true);
      expect(result.body).toEqual({ response: 'value' });
    });

    it('extracts payment details', async () => {
      mockExecAsync.mockResolvedValueOnce({
        stdout: JSON.stringify({ 
          body: { result: 'ok' },
          statusCode: 200,
          payment: {
            amount: '1000000',
            recipient: '0x1234',
            transactionHash: '0xabcd',
          },
        }),
        stderr: '',
      });

      const result = await awalPay('https://example.com/api');

      expect(result.success).toBe(true);
      expect(result.payment?.amount).toBe('1000000');
      expect(result.payment?.recipient).toBe('0x1234');
      expect(result.payment?.transactionHash).toBe('0xabcd');
    });

    it('handles txHash as transactionHash alternative', async () => {
      mockExecAsync.mockResolvedValueOnce({
        stdout: JSON.stringify({ 
          body: { result: 'ok' },
          txHash: '0xefgh',
        }),
        stderr: '',
      });

      const result = await awalPay('https://example.com/api');

      expect(result.success).toBe(true);
      expect(result.payment?.transactionHash).toBe('0xefgh');
    });

    it('returns error from stderr on exec failure', async () => {
      const error = new Error('Command failed') as Error & { stderr?: string };
      error.stderr = 'awal: not authenticated';
      mockExecAsync.mockRejectedValueOnce(error);

      const result = await awalPay('https://example.com/api');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not authenticated');
    });

    it('parses JSON error from stderr', async () => {
      const error = new Error('Command failed') as Error & { stderr?: string };
      error.stderr = JSON.stringify({ error: 'Wallet locked', code: 'WALLET_LOCKED' });
      mockExecAsync.mockRejectedValueOnce(error);

      const result = await awalPay('https://example.com/api');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Wallet locked');
    });

    it('throws AwalPaymentError on unexpected failures without stderr', async () => {
      const error = new Error('Network error');
      mockExecAsync.mockRejectedValueOnce(error);

      await expect(awalPay('https://example.com/api')).rejects.toThrow(AwalPaymentError);
    });

    it('throws AwalPaymentError on JSON parse failure', async () => {
      mockExecAsync.mockResolvedValueOnce({
        stdout: 'not valid json',
        stderr: '',
      });

      await expect(awalPay('https://example.com/api')).rejects.toThrow(AwalPaymentError);
    });
  });

  describe('clearAwalCache', () => {
    it('clears the cached status', async () => {
      // First call returns authenticated
      mockExecAsync.mockResolvedValueOnce({
        stdout: JSON.stringify({ authenticated: true }),
        stderr: '',
      });
      // Second call returns not authenticated
      mockExecAsync.mockResolvedValueOnce({
        stdout: JSON.stringify({ authenticated: false }),
        stderr: '',
      });

      const status1 = await checkAwalStatus();
      expect(status1.authenticated).toBe(true);

      clearAwalCache();

      const status2 = await checkAwalStatus();
      expect(status2.authenticated).toBe(false);
      expect(mockExecAsync).toHaveBeenCalledTimes(2);
    });
  });
});
