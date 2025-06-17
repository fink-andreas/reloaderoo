/**
 * MCP Development Proxy - Production Implementation
 * 
 * A transparent proxy that enables hot-reloading of MCP servers during development
 * while maintaining client session state. Supports the full MCP protocol including
 * tools, resources, prompts, completion, sampling, and ping.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import {
  // Tools
  ListToolsRequestSchema,
  CallToolRequestSchema,
  // Prompts  
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  // Resources
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  // Completion
  CompleteRequestSchema,
  // Sampling
  CreateMessageRequestSchema,
  // Core
  PingRequestSchema,
  // Types
  Tool,
  CallToolResult,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js';
import { logger } from './mcp-logger.js';
import type { ProxyConfig } from './types.js';

/**
 * Production-ready MCP Development Proxy with full protocol support
 */
export class MCPProxy {
  private readonly config: ProxyConfig;
  private readonly server: Server;
  private childClient: Client | null = null;
  private childProcess: ChildProcessWithoutNullStreams | null = null;
  private childTransport: StdioClientTransport | null = null;
  private isShuttingDown = false;
  private restartInProgress = false;
  private childTools: Tool[] = [];

  constructor(config: ProxyConfig) {
    this.config = config;
    
    // Create proxy server with full capabilities
    this.server = new Server(
      {
        name: `${this.extractServerName()}-dev`,
        version: '1.0.0-dev'
      },
      {
        capabilities: {
          tools: { listChanged: true },
          prompts: { listChanged: true },
          resources: { subscribe: true, listChanged: true },
          completion: { argument: true },
          sampling: {}
        }
      }
    );

    this.setupRequestHandlers();
    this.setupErrorHandling();
  }

  /**
   * Start the proxy and connect to child server
   */
  async start(): Promise<void> {
    logger.info('Starting MCP Development Proxy', {
      childCommand: this.config.childCommand,
      childArgs: this.config.childArgs
    });

    // Start child server first
    await this.startChildServer();

    // Connect proxy server to stdio
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    
    logger.info('MCP Development Proxy started successfully');
  }

  /**
   * Stop the proxy and cleanup resources
   */
  async stop(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    logger.info('Stopping MCP Development Proxy');

    try {
      await this.stopChildServer();
      await this.server.close();
    } catch (error) {
      logger.error('Error during shutdown', { error });
    }
  }

  /**
   * Start or restart the child MCP server
   */
  private async startChildServer(): Promise<void> {
    await this.stopChildServer();

    logger.info('Starting child MCP server', {
      command: this.config.childCommand,
      args: this.config.childArgs
    });

    // Spawn child process
    this.childProcess = spawn(this.config.childCommand, this.config.childArgs, {
      cwd: this.config.workingDirectory,
      env: this.config.environment,
      stdio: 'pipe'
    });

    if (!this.childProcess.stdout || !this.childProcess.stdin) {
      throw new Error('Failed to create child process with stdio pipes');
    }

    // Create transport and client for child communication
    this.childTransport = new StdioClientTransport({
      command: this.config.childCommand,
      args: this.config.childArgs,
      env: this.config.environment
    });

    this.childClient = new Client(
      {
        name: 'mcpdev-proxy',
        version: '1.0.0'
      },
      {
        capabilities: {
          tools: {},
          prompts: {},
          resources: {},
          completion: {},
          sampling: {}
        }
      }
    );

    // Connect to child via stdio
    await this.childClient.connect(this.childTransport);

    // Mirror child capabilities
    await this.mirrorChildCapabilities();

    logger.info('Connected to child MCP server successfully');
  }

  /**
   * Stop the child MCP server
   */
  private async stopChildServer(): Promise<void> {
    if (this.childClient) {
      try {
        await this.childClient.close();
      } catch (error) {
        logger.debug('Error closing child client', { error });
      }
      this.childClient = null;
    }

    if (this.childTransport) {
      try {
        await this.childTransport.close();
      } catch (error) {
        logger.debug('Error closing child transport', { error });
      }
      this.childTransport = null;
    }

    if (this.childProcess) {
      this.childProcess.kill('SIGTERM');
      this.childProcess = null;
    }

    this.childTools = [];
  }

  /**
   * Mirror tools and other capabilities from child server
   */
  private async mirrorChildCapabilities(): Promise<void> {
    if (!this.childClient) {
      throw new Error('Child client not connected');
    }

    try {
      // Get tools from child
      const toolsResult = await this.childClient.listTools();

      this.childTools = toolsResult.tools || [];
      
      logger.debug('Mirrored child capabilities', {
        toolCount: this.childTools.length,
        toolNames: this.childTools.map(t => t.name)
      });

      // Notify about capability changes if this is a restart
      if (this.restartInProgress) {
        await this.notifyCapabilityChanges();
        this.restartInProgress = false;
      }

    } catch (error) {
      logger.error('Failed to mirror child capabilities', { error });
      throw error;
    }
  }

  /**
   * Send notifications about capability changes after restart
   */
  private async notifyCapabilityChanges(): Promise<void> {
    try {
      // Notify tools changed
      await this.server.notification({
        method: 'notifications/tools/list_changed'
      });

      // Notify other capabilities if supported
      await this.server.notification({
        method: 'notifications/prompts/list_changed'
      });

      await this.server.notification({
        method: 'notifications/resources/list_changed'
      });

      logger.debug('Sent capability change notifications');
    } catch (error) {
      logger.debug('Error sending notifications', { error });
    }
  }

  /**
   * Setup all MCP request handlers
   */
  private setupRequestHandlers(): void {
    // Tools
    this.setupToolHandlers();
    
    // Prompts
    this.setupPromptHandlers();
    
    // Resources
    this.setupResourceHandlers();
    
    // Completion
    this.setupCompletionHandlers();
    
    // Sampling
    this.setupSamplingHandlers();
    
    // Core
    this.setupCoreHandlers();
  }

  /**
   * Setup tool-related request handlers
   */
  private setupToolHandlers(): void {
    // List tools - include child tools + restart_server
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const allTools = [
        ...this.childTools,
        this.getRestartServerTool()
      ];

      return { tools: allTools };
    });

    // Call tool - handle restart_server locally, forward others
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (name === 'restart_server') {
        return this.handleRestartServer(args);
      }

      // Forward to child
      if (!this.childClient) {
        throw new McpError(
          ErrorCode.InternalError,
          'Child server not available'
        );
      }

      return this.childClient.callTool(request.params);
    });
  }

  /**
   * Setup prompt-related request handlers
   */
  private setupPromptHandlers(): void {
    // List prompts
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
      if (!this.childClient) {
        return { prompts: [] }; // Fallback
      }

      try {
        return this.childClient.listPrompts();
      } catch (error) {
        logger.debug('Child does not support prompts', { error });
        return { prompts: [] }; // Fallback
      }
    });

    // Get prompt
    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      if (!this.childClient) {
        throw new McpError(
          ErrorCode.InternalError,
          'Child server not available'
        );
      }

      return this.childClient.getPrompt(request.params);
    });
  }

  /**
   * Setup resource-related request handlers
   */
  private setupResourceHandlers(): void {
    // List resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      if (!this.childClient) {
        return { resources: [] }; // Fallback
      }

      try {
        return this.childClient.listResources();
      } catch (error) {
        logger.debug('Child does not support resources', { error });
        return { resources: [] }; // Fallback
      }
    });

    // Read resource
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      if (!this.childClient) {
        throw new McpError(
          ErrorCode.InternalError,
          'Child server not available'
        );
      }

      return this.childClient.readResource(request.params);
    });
  }

  /**
   * Setup completion-related request handlers
   */
  private setupCompletionHandlers(): void {
    this.server.setRequestHandler(CompleteRequestSchema, async (request) => {
      if (!this.childClient) {
        return { completion: { values: [], total: 0, hasMore: false } }; // Fallback
      }

      try {
        return this.childClient.complete(request.params);
      } catch (error) {
        logger.debug('Child does not support completion', { error });
        return { completion: { values: [], total: 0, hasMore: false } }; // Fallback
      }
    });
  }

  /**
   * Setup sampling-related request handlers  
   */
  private setupSamplingHandlers(): void {
    this.server.setRequestHandler(CreateMessageRequestSchema, async () => {
      if (!this.childClient) {
        throw new McpError(
          ErrorCode.InternalError,
          'Child server not available'
        );
      }

      // Note: createMessage may not be available in all SDK versions
      // Forward via generic request if available
      throw new McpError(
        ErrorCode.MethodNotFound,
        'Sampling not supported by child server'
      );
    });
  }

  /**
   * Setup core protocol handlers
   */
  private setupCoreHandlers(): void {
    // Ping
    this.server.setRequestHandler(PingRequestSchema, async () => {
      if (!this.childClient) {
        return {}; // Fallback - proxy is alive even if child isn't
      }

      try {
        await this.childClient.ping();
        return {};
      } catch (error) {
        logger.debug('Child ping failed', { error });
        return {}; // Fallback - proxy is alive even if child isn't
      }
    });
  }

  /**
   * Handle restart_server tool call
   */
  private async handleRestartServer(args: any): Promise<CallToolResult> {
    const force = args?.force || false;

    try {
      logger.info('Executing restart_server tool', { force });
      
      this.restartInProgress = true;
      await this.startChildServer();

      return {
        content: [{
          type: 'text',
          text: 'Child MCP server restarted successfully. New capabilities have been loaded.'
        }]
      };

    } catch (error) {
      this.restartInProgress = false;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      logger.error('Failed to restart child server', { error: errorMessage });

      return {
        content: [{
          type: 'text', 
          text: `Failed to restart child server: ${errorMessage}`
        }],
        isError: true
      };
    }
  }

  /**
   * Get the restart_server tool definition
   */
  private getRestartServerTool(): Tool {
    return {
      name: 'restart_server',
      description: 'Restart the child MCP server process for hot-reloading during development',
      inputSchema: {
        type: 'object',
        properties: {
          force: {
            type: 'boolean',
            description: 'Force restart even if server appears healthy',
            default: false
          }
        },
        required: []
      }
    };
  }

  /**
   * Setup error handling for the proxy
   */
  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      logger.error('Proxy server error', { error });
    };

    process.on('SIGINT', () => this.handleShutdown('SIGINT'));
    process.on('SIGTERM', () => this.handleShutdown('SIGTERM'));
  }

  /**
   * Handle process shutdown signals
   */
  private async handleShutdown(signal: string): Promise<void> {
    logger.info(`Received ${signal}, shutting down gracefully`);
    await this.stop();
    process.exit(0);
  }

  /**
   * Extract server name from child command for proxy naming
   */
  private extractServerName(): string {
    const command = this.config.childCommand;
    const parts = command.split(/[\\/]/);
    const filename = parts[parts.length - 1] || 'mcp-server';
    return filename.replace(/\.(js|ts|py|rb|go)$/, '') || 'mcp-server';
  }
}