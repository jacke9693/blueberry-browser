import { experimental_createMCPClient as createMCPClient } from "@ai-sdk/mcp";
import type { experimental_MCPClient as MCPClient } from "@ai-sdk/mcp";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as fs from "fs";
import * as path from "path";

/**
 * Configuration for HTTP-based MCP server
 */
export interface MCPServerConfigHTTP {
  type?: "http";
  url: string;
  headers?: Record<string, string>;
}

/**
 * Configuration for SSE-based MCP server
 */
export interface MCPServerConfigSSE {
  type?: "sse";
  url: string;
  headers?: Record<string, string>;
}

/**
 * Configuration for Stdio-based MCP server (local only)
 */
export interface MCPServerConfigStdio {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * Union type for all supported MCP server configurations
 */
export type MCPServerConfig =
  | MCPServerConfigHTTP
  | MCPServerConfigSSE
  | MCPServerConfigStdio;

export interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

interface MCPServerConnection {
  client: MCPClient;
  config: MCPServerConfig;
}

export class MCPManager {
  private servers: Map<string, MCPServerConnection> = new Map();
  private configPath: string;

  constructor(configPath?: string) {
    // Default to .mcp-config.json in the user's home directory
    this.configPath =
      configPath ||
      path.join(
        process.env.HOME || process.env.USERPROFILE || ".",
        ".mcp-config.json",
      );
  }

  /**
   * Initialize all MCP servers from the configuration file
   */
  async initialize(): Promise<void> {
    try {
      const config = await this.loadConfig();
      if (!config || !config.mcpServers) {
        console.log("No MCP servers configured");
        return;
      }

      const serverNames = Object.keys(config.mcpServers);
      console.log(`Initializing ${serverNames.length} MCP server(s)...`);
      for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
        try {
          await this.connectToServer(name, serverConfig);
          console.log(`✅ Connected to MCP server: ${name}`);
        } catch (error) {
          console.error(`❌ Failed to connect to MCP server '${name}':`, error);
        }
      }

      console.log(
        `MCP Manager initialized with ${this.servers.size} server(s)`,
      );
    } catch (error) {
      console.error("Error initializing MCP Manager:", error);
    }
  }

  /**
   * Connect to a single MCP server using HTTP, SSE, or Stdio transport
   */
  private async connectToServer(
    name: string,
    config: MCPServerConfig,
  ): Promise<void> {
    let mcpClient: MCPClient;

    // Auto-detect stdio if command property exists
    const isStdio = "command" in config;

    if (isStdio) {
      // For stdio transport, use StdioClientTransport from MCP SDK
      const stdioConfig = config as MCPServerConfigStdio;

      // Filter out undefined env values
      const cleanEnv = Object.entries({ ...process.env, ...stdioConfig.env })
        .filter(([_, value]) => value !== undefined)
        .reduce(
          (acc, [key, value]) => ({ ...acc, [key]: value as string }),
          {},
        );

      const transport = new StdioClientTransport({
        command: stdioConfig.command,
        args: stdioConfig.args,
        env: cleanEnv,
      });

      mcpClient = await createMCPClient({
        transport,
      });
    } else {
      // For HTTP or SSE transport, use the built-in transport configuration
      const httpConfig = config as MCPServerConfigHTTP | MCPServerConfigSSE;
      mcpClient = await createMCPClient({
        transport: {
          type: httpConfig.type || "http",
          url: httpConfig.url,
          headers: httpConfig.headers,
        },
      });
    }

    // Store the connection
    this.servers.set(name, {
      client: mcpClient,
      config,
    });
  }

  /**
   * Load configuration from file
   */
  private async loadConfig(): Promise<MCPConfig | null> {
    try {
      if (!fs.existsSync(this.configPath)) {
        console.log(`No MCP config file found at: ${this.configPath}`);
        return null;
      }

      const configData = fs.readFileSync(this.configPath, "utf-8");
      const config = JSON.parse(configData) as MCPConfig;
      return config;
    } catch (error) {
      console.error("Error loading MCP config:", error);
      return null;
    }
  }

  /**
   * Clean up all connections
   */
  async cleanup(): Promise<void> {
    console.log("Cleaning up MCP connections...");
    for (const [name, connection] of this.servers.entries()) {
      try {
        await connection.client.close();
        console.log(`Disconnected from MCP server: ${name}`);
      } catch (error) {
        console.error(`Error disconnecting from '${name}':`, error);
      }
    }
    this.servers.clear();
  }

  /**
   * Get the number of connected servers
   */
  getServerCount(): number {
    return this.servers.size;
  }

  /**
   * Get all server names
   */
  getServerNames(): string[] {
    return Array.from(this.servers.keys());
  }

  /**
   * Get MCP configuration from file
   */
  async getConfig(): Promise<MCPConfig | null> {
    return this.loadConfig();
  }

  /**
   * Save MCP configuration to file
   */
  async saveConfig(config: MCPConfig): Promise<void> {
    try {
      const configDir = path.dirname(this.configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      fs.writeFileSync(
        this.configPath,
        JSON.stringify(config, null, 2),
        "utf-8",
      );
      console.log(`MCP config saved to: ${this.configPath}`);
    } catch (error) {
      console.error("Error saving MCP config:", error);
      throw error;
    }
  }

  /**
   * Get status of all connected servers
   */
  getStatus(): Record<
    string,
    { status: string; url?: string; command?: string; type: string }
  > {
    const status: Record<
      string,
      { status: string; url?: string; command?: string; type: string }
    > = {};

    for (const [name, connection] of this.servers.entries()) {
      const baseStatus = {
        status: "connected",
        type: connection.config.type,
      };

      if (
        connection.config.type === "stdio" ||
        "command" in connection.config
      ) {
        status[name] = {
          ...baseStatus,
          command: connection.config.command,
        };
      } else {
        status[name] = {
          ...baseStatus,
          url: connection.config.url,
        };
      }
    }

    return status;
  }

  /**
   * Reload all MCP servers
   */
  async reload(): Promise<void> {
    await this.cleanup();
    await this.initialize();
  }

  /**
   * Get all tools from all connected MCP servers using schema discovery
   * This automatically discovers all tools offered by the servers
   */
  async getAllTools(): Promise<Record<string, any>> {
    const allTools: Record<string, any> = {};

    for (const [name, connection] of this.servers.entries()) {
      try {
        // Use schema discovery to get all tools from the server
        const tools = await connection.client.tools();

        // Store tools with server name prefix to avoid conflicts
        allTools[name] = tools;
      } catch (error) {
        console.error(`Error getting tools from '${name}':`, error);
      }
    }

    return allTools;
  }

  /**
   * Get tools from a specific MCP server
   * @param serverName - The name of the server to get tools from
   * @returns Tools object that can be used with AI SDK
   */
  async getServerTools(serverName: string): Promise<any> {
    const connection = this.servers.get(serverName);
    if (!connection) {
      throw new Error(`MCP server '${serverName}' not found`);
    }

    try {
      // Use schema discovery to get all tools from the server
      const tools = await connection.client.tools();
      return tools;
    } catch (error) {
      console.error(`Error getting tools from '${serverName}':`, error);
      throw error;
    }
  }

  /**
   * Get MCP client for a specific server
   * @param serverName - The name of the server
   * @returns The MCP client instance
   */
  getClient(serverName: string): MCPClient | undefined {
    return this.servers.get(serverName)?.client;
  }

  /**
   * Get all MCP clients
   * @returns Map of server names to MCP clients
   */
  getClients(): Map<string, MCPClient> {
    const clients = new Map<string, MCPClient>();
    for (const [name, connection] of this.servers.entries()) {
      clients.set(name, connection.client);
    }
    return clients;
  }

  /**
   * List all resources from a specific MCP server
   * @param serverName - The name of the server
   * @returns List of resources
   */
  async listResources(serverName: string): Promise<any> {
    const connection = this.servers.get(serverName);
    if (!connection) {
      throw new Error(`MCP server '${serverName}' not found`);
    }

    try {
      return await connection.client.listResources();
    } catch (error) {
      console.error(`Error listing resources from '${serverName}':`, error);
      throw error;
    }
  }

  /**
   * Read a specific resource from an MCP server
   * @param serverName - The name of the server
   * @param uri - The URI of the resource to read
   * @returns Resource data
   */
  async readResource(serverName: string, uri: string): Promise<any> {
    const connection = this.servers.get(serverName);
    if (!connection) {
      throw new Error(`MCP server '${serverName}' not found`);
    }

    try {
      return await connection.client.readResource({ uri });
    } catch (error) {
      console.error(`Error reading resource from '${serverName}':`, error);
      throw error;
    }
  }

  /**
   * List all prompts from a specific MCP server
   * @param serverName - The name of the server
   * @returns List of prompts
   */
  async listPrompts(serverName: string): Promise<any> {
    const connection = this.servers.get(serverName);
    if (!connection) {
      throw new Error(`MCP server '${serverName}' not found`);
    }

    try {
      return await connection.client.listPrompts();
    } catch (error) {
      console.error(`Error listing prompts from '${serverName}':`, error);
      throw error;
    }
  }

  /**
   * Get a specific prompt from an MCP server
   * @param serverName - The name of the server
   * @param name - The name of the prompt
   * @param args - Optional arguments for the prompt
   * @returns Prompt data
   */
  async getPrompt(
    serverName: string,
    name: string,
    args?: Record<string, any>,
  ): Promise<any> {
    const connection = this.servers.get(serverName);
    if (!connection) {
      throw new Error(`MCP server '${serverName}' not found`);
    }

    try {
      return await connection.client.getPrompt({ name, arguments: args });
    } catch (error) {
      console.error(`Error getting prompt from '${serverName}':`, error);
      throw error;
    }
  }
}
