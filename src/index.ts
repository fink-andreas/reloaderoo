#!/usr/bin/env node
/**
 * mcpdev-proxy - A transparent MCP development wrapper
 * 
 * Main CLI entry point for the proxy functionality.
 */

// Re-export everything for library usage
export { MCPProxy } from './mcp-proxy.js';
export * from './types.js';
export { logger, LoggerManager } from './logger.js';

// CLI functionality - only run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const { runCLI } = await import('./bin/mcpdev-proxy.js');
  await runCLI();
}