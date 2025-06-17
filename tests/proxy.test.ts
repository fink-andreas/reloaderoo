/**
 * Tests for the MCP proxy functionality
 */

import { describe, it, expect } from 'vitest';
import { MCPProxy } from '../src/mcp-proxy';
import { ProxyConfig } from '../src/types';

describe('MCPProxy', () => {
  const defaultConfig: ProxyConfig = {
    childCommand: 'echo test',
    childArgs: [],
    workingDirectory: process.cwd(),
    environment: {},
    restartLimit: 3,
    operationTimeout: 30000,
    logLevel: 'error',
    autoRestart: true,
    restartDelay: 1000
  };

  it('should create a proxy instance', () => {
    const proxy = new MCPProxy(defaultConfig);
    expect(proxy).toBeDefined();
    expect(proxy.start).toBeDefined();
    expect(proxy.stop).toBeDefined();
  });

  it('should accept valid configuration', () => {
    const config: ProxyConfig = {
      childCommand: 'node',
      childArgs: ['--version'],
      workingDirectory: process.cwd(),
      environment: {},
      restartLimit: 5,
      operationTimeout: 30000,
      logLevel: 'debug',
      autoRestart: true,
      restartDelay: 1000
    };
    
    const proxy = new MCPProxy(config);
    expect(proxy).toBeDefined();
    expect(typeof proxy.start).toBe('function');
    expect(typeof proxy.stop).toBe('function');
  });
});