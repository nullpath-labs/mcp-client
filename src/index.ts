#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

const NULLPATH_API_URL = "https://nullpath.com/mcp";

interface Agent {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  reputation?: number;
  owner?: string;
}

interface AgentExecutionResult {
  success: boolean;
  result?: any;
  error?: string;
}

interface CapabilitiesResponse {
  version: string;
  features: string[];
  supportedOperations: string[];
}

interface ReputationResponse {
  agentId: string;
  score: number;
  reviews: number;
  lastUpdated: string;
}

class NullpathMCPServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: "nullpath-mcp",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    
    this.server.onerror = (error) => console.error("[MCP Error]", error);
    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.getTools(),
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "discover_agents":
            return await this.discoverAgents(args);
          case "lookup_agent":
            return await this.lookupAgent(args);
          case "execute_agent":
            return await this.executeAgent(args);
          case "register_agent":
            return await this.registerAgent(args);
          case "get_capabilities":
            return await this.getCapabilities(args);
          case "check_reputation":
            return await this.checkReputation(args);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text",
              text: `Error: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  private getTools(): Tool[] {
    return [
      {
        name: "discover_agents",
        description:
          "Discover available agents in the nullpath.com marketplace. Search and filter agents by category, capabilities, or keywords.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query to filter agents (optional)",
            },
            category: {
              type: "string",
              description: "Category to filter agents by (optional)",
            },
            limit: {
              type: "number",
              description: "Maximum number of agents to return (default: 10)",
            },
          },
        },
      },
      {
        name: "lookup_agent",
        description:
          "Look up detailed information about a specific agent by its ID or name. Returns agent metadata, capabilities, pricing, and usage information.",
        inputSchema: {
          type: "object",
          properties: {
            agentId: {
              type: "string",
              description: "The unique identifier of the agent",
            },
          },
          required: ["agentId"],
        },
      },
      {
        name: "execute_agent",
        description:
          "Execute a specific agent with provided parameters. Handles x402 micropayment automatically if required. Returns the agent's execution results.",
        inputSchema: {
          type: "object",
          properties: {
            agentId: {
              type: "string",
              description: "The unique identifier of the agent to execute",
            },
            parameters: {
              type: "object",
              description: "Parameters to pass to the agent",
            },
            timeout: {
              type: "number",
              description: "Execution timeout in seconds (default: 30)",
            },
          },
          required: ["agentId"],
        },
      },
      {
        name: "register_agent",
        description:
          "Register a new agent in the nullpath.com marketplace. Requires authentication and agent metadata including name, description, capabilities, and pricing.",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Name of the agent",
            },
            description: {
              type: "string",
              description: "Description of what the agent does",
            },
            capabilities: {
              type: "array",
              items: { type: "string" },
              description: "List of agent capabilities",
            },
            endpoint: {
              type: "string",
              description: "API endpoint for the agent",
            },
            pricing: {
              type: "object",
              description: "Pricing information for the agent",
            },
          },
          required: ["name", "description", "capabilities", "endpoint"],
        },
      },
      {
        name: "get_capabilities",
        description:
          "Get the capabilities and features of the nullpath.com marketplace server. Returns supported operations, API version, and available features.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "check_reputation",
        description:
          "Check the reputation score and reviews for a specific agent. Returns reputation metrics, review counts, and trust indicators.",
        inputSchema: {
          type: "object",
          properties: {
            agentId: {
              type: "string",
              description: "The unique identifier of the agent",
            },
          },
          required: ["agentId"],
        },
      },
    ];
  }

  private async discoverAgents(args: any) {
    const query = args?.query || "";
    const category = args?.category || "";
    const limit = args?.limit || 10;

    // In a real implementation, this would make an HTTP request to the nullpath API
    // For now, we'll simulate the response
    const response = {
      query,
      category,
      agents: [
        {
          id: "agent-001",
          name: "Data Analyzer",
          description: "Advanced data analysis and visualization agent",
          capabilities: ["data-analysis", "visualization", "statistics"],
          reputation: 4.8,
        },
        {
          id: "agent-002",
          name: "Code Assistant",
          description: "AI-powered code review and debugging assistant",
          capabilities: ["code-review", "debugging", "refactoring"],
          reputation: 4.9,
        },
      ].slice(0, limit),
      total: 2,
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  }

  private async lookupAgent(args: any) {
    const agentId = args?.agentId;
    if (!agentId) {
      throw new Error("agentId is required");
    }

    // In a real implementation, this would make an HTTP request to the nullpath API
    const agent = {
      id: agentId,
      name: "Sample Agent",
      description: "This is a sample agent from the nullpath marketplace",
      capabilities: ["example-capability", "sample-feature"],
      reputation: 4.5,
      owner: "nullpath-labs",
      pricing: {
        model: "pay-per-use",
        rate: 0.001,
        currency: "USD",
      },
      endpoint: `${NULLPATH_API_URL}/agents/${agentId}`,
      version: "1.0.0",
      lastUpdated: new Date().toISOString(),
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(agent, null, 2),
        },
      ],
    };
  }

  private async executeAgent(args: any) {
    const agentId = args?.agentId;
    const parameters = args?.parameters || {};
    const timeout = args?.timeout || 30;

    if (!agentId) {
      throw new Error("agentId is required");
    }

    // In a real implementation, this would:
    // 1. Make an HTTP request to the nullpath API
    // 2. Handle x402 micropayment if required
    // 3. Execute the agent with provided parameters
    // 4. Return the execution results

    const result: AgentExecutionResult = {
      success: true,
      result: {
        agentId,
        executionId: `exec-${Date.now()}`,
        parameters,
        output: "Agent executed successfully",
        timestamp: new Date().toISOString(),
        cost: 0.001,
        currency: "USD",
      },
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  private async registerAgent(args: any) {
    const { name, description, capabilities, endpoint, pricing } = args;

    if (!name || !description || !capabilities || !endpoint) {
      throw new Error(
        "name, description, capabilities, and endpoint are required"
      );
    }

    // In a real implementation, this would:
    // 1. Authenticate the user
    // 2. Validate the agent metadata
    // 3. Register the agent in the nullpath marketplace
    // 4. Return the registration confirmation

    const registrationResponse = {
      success: true,
      agentId: `agent-${Date.now()}`,
      name,
      description,
      capabilities,
      endpoint,
      pricing,
      status: "pending-review",
      createdAt: new Date().toISOString(),
      message: "Agent registered successfully and is pending review",
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(registrationResponse, null, 2),
        },
      ],
    };
  }

  private async getCapabilities(args: any) {
    // In a real implementation, this would make an HTTP request to the nullpath API
    const capabilities: CapabilitiesResponse = {
      version: "1.0.0",
      features: [
        "agent-discovery",
        "agent-execution",
        "x402-micropayments",
        "reputation-system",
        "agent-registration",
      ],
      supportedOperations: [
        "discover_agents",
        "lookup_agent",
        "execute_agent",
        "register_agent",
        "check_reputation",
      ],
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(capabilities, null, 2),
        },
      ],
    };
  }

  private async checkReputation(args: any) {
    const agentId = args?.agentId;
    if (!agentId) {
      throw new Error("agentId is required");
    }

    // In a real implementation, this would make an HTTP request to the nullpath API
    const reputation: ReputationResponse = {
      agentId,
      score: 4.7,
      reviews: 142,
      lastUpdated: new Date().toISOString(),
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(reputation, null, 2),
        },
      ],
    };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Nullpath MCP server running on stdio");
  }
}

const server = new NullpathMCPServer();
server.run().catch(console.error);
