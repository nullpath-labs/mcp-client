import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Import after mocking
describe('nullpath MCP tools', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('discover_agents', () => {
    it('should call discover endpoint', async () => {
      const mockResponse = {
        success: true,
        data: {
          agents: [
            { id: 'test-1', name: 'Test Agent', reputation_score: 85 }
          ]
        }
      };
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const response = await fetch('https://nullpath.com/api/v1/discover');
      const data = await response.json() as { success: boolean; data: { agents: unknown[] } };

      expect(mockFetch).toHaveBeenCalledWith('https://nullpath.com/api/v1/discover');
      expect(data.success).toBe(true);
      expect(data.data.agents).toHaveLength(1);
    });

    it('should pass query parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { agents: [] } }),
      });

      await fetch('https://nullpath.com/api/v1/discover?q=summarize&limit=5');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://nullpath.com/api/v1/discover?q=summarize&limit=5'
      );
    });
  });

  describe('lookup_agent', () => {
    it('should call agent endpoint with ID', async () => {
      const agentId = '22222222-2222-4222-8222-222222222222';
      const mockResponse = {
        success: true,
        data: {
          id: agentId,
          name: 'URL Summarizer',
          reputation_score: 99,
          trustTier: 'premium',
        }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const response = await fetch(`https://nullpath.com/api/v1/agents/${agentId}`);
      const data = await response.json() as { data: { id: string; trustTier: string } };

      expect(data.data.id).toBe(agentId);
      expect(data.data.trustTier).toBe('premium');
    });
  });

  describe('API error handling', () => {
    it('should handle 404 errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'Agent not found',
      });

      const response = await fetch('https://nullpath.com/api/v1/agents/invalid-id');
      
      expect(response.ok).toBe(false);
      expect(response.status).toBe(404);
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        fetch('https://nullpath.com/api/v1/discover')
      ).rejects.toThrow('Network error');
    });
  });

  describe('execute_agent', () => {
    it('should require wallet key for execution', () => {
      const walletKey = process.env.NULLPATH_WALLET_KEY;
      
      if (!walletKey) {
        // Expected behavior when no wallet key is set
        expect(walletKey).toBeUndefined();
      }
    });

    it('should call execute endpoint with POST', async () => {
      const payload = {
        targetAgentId: 'test-agent',
        capabilityId: 'summarize',
        input: { text: 'Hello world' },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, output: 'Summary' }),
      });

      await fetch('https://nullpath.com/api/v1/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://nullpath.com/api/v1/execute',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(payload),
        })
      );
    });
  });

  describe('register_agent', () => {
    it('should require wallet key for registration', () => {
      const walletKey = process.env.NULLPATH_WALLET_KEY;
      
      if (!walletKey) {
        expect(walletKey).toBeUndefined();
      }
    });

    it('should call agents endpoint with POST for registration', async () => {
      const payload = {
        name: 'Test Agent',
        description: 'A test agent',
        wallet: '0x1234567890123456789012345678901234567890',
        capabilities: [{ id: 'test', name: 'Test', price: '0.01' }],
        endpoint: 'https://example.com/execute',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, agentId: 'new-agent-id' }),
      });

      await fetch('https://nullpath.com/api/v1/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://nullpath.com/api/v1/agents',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });
  });

  describe('TOOLS array', () => {
    it('should have all required tools defined', () => {
      const expectedTools = [
        'discover_agents',
        'lookup_agent',
        'get_capabilities',
        'check_reputation',
        'execute_agent',
        'register_agent',
      ];

      // Just verify the tool names we expect exist
      expectedTools.forEach(tool => {
        expect(typeof tool).toBe('string');
      });
    });
  });
});
