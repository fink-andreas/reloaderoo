/**
 * Comprehensive tests for the configuration system
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Config, createConfig, validateConfigObject, validateCommand } from '../src/config.js';
import type { ProxyConfig, ConfigValidationResult } from '../src/types.js';

describe('Config', () => {
  let config: Config;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    config = new Config();
    originalEnv = { ...process.env };
    
    // Clear all MCPDEV_PROXY_* environment variables
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('MCPDEV_PROXY_')) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('loadConfig', () => {
    it('should load default configuration when no environment variables are set', () => {
      const result = config.loadConfig();
      
      expect(result.valid).toBe(false); // No childCommand provided
      expect(result.errors).toContain('childCommand is required');
    });

    it('should load configuration from environment variables', () => {
      process.env.MCPDEV_PROXY_CHILD_CMD = 'node';
      process.env.MCPDEV_PROXY_LOG_LEVEL = 'debug';
      process.env.MCPDEV_PROXY_RESTART_LIMIT = '5';
      process.env.MCPDEV_PROXY_AUTO_RESTART = 'false';
      
      const result = config.loadConfig();
      const loadedConfig = config.getCurrentConfig();
      
      expect(result.valid).toBe(true);
      expect(loadedConfig?.childCommand).toBe('node');
      expect(loadedConfig?.logLevel).toBe('debug');
      expect(loadedConfig?.restartLimit).toBe(5);
      expect(loadedConfig?.autoRestart).toBe(false);
    });

    it('should handle boolean environment variables correctly', () => {
      process.env.MCPDEV_PROXY_CHILD_CMD = 'node';
      process.env.MCPDEV_PROXY_AUTO_RESTART = 'true';
      
      config.loadConfig();
      expect(config.getCurrentConfig()?.autoRestart).toBe(true);

      process.env.MCPDEV_PROXY_AUTO_RESTART = '1';
      config.loadConfig();
      expect(config.getCurrentConfig()?.autoRestart).toBe(true);

      process.env.MCPDEV_PROXY_AUTO_RESTART = 'yes';
      config.loadConfig();
      expect(config.getCurrentConfig()?.autoRestart).toBe(true);

      process.env.MCPDEV_PROXY_AUTO_RESTART = 'false';
      config.loadConfig();
      expect(config.getCurrentConfig()?.autoRestart).toBe(false);
    });

    it('should handle array environment variables correctly', () => {
      process.env.MCPDEV_PROXY_CHILD_CMD = 'node';
      process.env.MCPDEV_PROXY_CHILD_ARGS = '--version, --help, --verbose';
      
      config.loadConfig();
      expect(config.getCurrentConfig()?.childArgs).toEqual(['--version', '--help', '--verbose']);
    });

    it('should emit configLoaded event on successful load', async () => {
      process.env.MCPDEV_PROXY_CHILD_CMD = 'node';
      
      const eventPromise = new Promise<ProxyConfig>((resolve) => {
        config.on('configLoaded', resolve);
      });
      
      config.loadConfig();
      
      const loadedConfig = await eventPromise;
      expect(loadedConfig.childCommand).toBe('node');
    });
  });

  describe('validateConfig', () => {
    it('should validate required fields', () => {
      const result = config.validateConfig({});
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('childCommand is required');
    });

    it('should validate log levels', () => {
      const result = config.validateConfig({
        childCommand: 'node',
        logLevel: 'invalid' as any
      });
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(error => error.includes('Invalid log level'))).toBe(true);
    });

    it('should validate numeric ranges', () => {
      const result = config.validateConfig({
        childCommand: 'node',
        restartLimit: -1,
        operationTimeout: 500,
        restartDelay: -100
      });
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('restartLimit must be between 0 and 10');
      expect(result.errors).toContain('operationTimeout must be between 1000ms and 300000ms');
      expect(result.errors).toContain('restartDelay must be between 0ms and 60000ms');
    });

    it('should validate childArgs array', () => {
      const result = config.validateConfig({
        childCommand: 'node',
        childArgs: 'not-an-array' as any
      });
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('childArgs must be an array of strings');
    });

    it('should validate environment object', () => {
      const result = config.validateConfig({
        childCommand: 'node',
        environment: {
          VALID_VAR: 'string',
          INVALID_VAR: 123 as any
        }
      });
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(error => error.includes('Environment variable INVALID_VAR must be a string'))).toBe(true);
    });

    it('should return valid config for correct input', () => {
      const inputConfig = {
        childCommand: 'node',
        childArgs: ['--version'],
        logLevel: 'info' as const,
        restartLimit: 2
      };
      
      const result = config.validateConfig(inputConfig);
      
      expect(result.valid).toBe(true);
      expect(result.config).toBeDefined();
      expect(result.config?.childCommand).toBe('node');
      expect(result.config?.childArgs).toEqual(['--version']);
      expect(result.config?.restartLimit).toBe(2);
    });
  });

  describe('mergeConfigs', () => {
    it('should merge configurations with proper precedence', () => {
      // Set environment config
      process.env.MCPDEV_PROXY_CHILD_CMD = 'node';
      process.env.MCPDEV_PROXY_LOG_LEVEL = 'debug';
      config.loadConfig();
      
      // Update runtime config
      config.updateConfig({
        environment: { NODE_ENV: 'test' },
        childArgs: ['--test']
      });
      
      const merged = config.getCurrentConfig();
      
      expect(merged?.childCommand).toBe('node'); // From environment
      expect(merged?.logLevel).toBe('debug'); // From environment
      expect(merged?.childArgs).toEqual(['--test']); // From runtime
      expect(merged?.environment?.NODE_ENV).toBe('test'); // From runtime
    });

    it('should merge environment variables correctly', () => {
      process.env.MCPDEV_PROXY_CHILD_CMD = 'node';
      process.env.TEST_VAR = 'original';
      config.loadConfig();
      
      config.updateConfig({
        environment: { TEST_VAR: 'updated', NEW_VAR: 'new' }
      });
      
      const merged = config.getCurrentConfig();
      expect(merged?.environment?.TEST_VAR).toBe('updated');
      expect(merged?.environment?.NEW_VAR).toBe('new');
    });
  });

  describe('updateConfig', () => {
    beforeEach(() => {
      process.env.MCPDEV_PROXY_CHILD_CMD = 'node';
      config.loadConfig();
    });

    it('should update configuration at runtime', () => {
      const result = config.updateConfig({
        childArgs: ['--runtime-update'],
        environment: { RUNTIME_VAR: 'test' }
      });
      
      expect(result.valid).toBe(true);
      
      const updated = config.getCurrentConfig();
      expect(updated?.childArgs).toEqual(['--runtime-update']);
      expect(updated?.environment?.RUNTIME_VAR).toBe('test');
    });

    it('should emit configChanged event on successful update', async () => {
      const eventPromise = new Promise<any>((resolve) => {
        config.on('configChanged', resolve);
      });
      
      config.updateConfig({ childArgs: ['--updated'] });
      
      const event = await eventPromise;
      expect(event.source).toBe('runtime');
      expect(event.changes.childArgs).toEqual(['--updated']);
      expect(event.newConfig.childArgs).toEqual(['--updated']);
    });

    it('should fail if no base config is loaded', () => {
      const freshConfig = new Config();
      const result = freshConfig.updateConfig({ childArgs: ['--test'] });
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('No base configuration loaded. Call loadConfig() first.');
    });

    it('should increment change count on successful updates', () => {
      const initialSummary = config.getConfigSummary();
      expect(initialSummary.changeCount).toBe(0);
      
      config.updateConfig({ childArgs: ['--test1'] });
      expect(config.getConfigSummary().changeCount).toBe(1);
      
      config.updateConfig({ childArgs: ['--test2'] });
      expect(config.getConfigSummary().changeCount).toBe(2);
    });
  });

  describe('getConfigSummary', () => {
    it('should return comprehensive configuration summary', () => {
      process.env.MCPDEV_PROXY_CHILD_CMD = 'node';
      config.loadConfig();
      config.updateConfig({ childArgs: ['--test'] });
      
      const summary = config.getConfigSummary();
      
      expect(summary.sources).toBeDefined();
      expect(summary.sources.default).toBeDefined();
      expect(summary.sources.environment).toBeDefined();
      expect(summary.sources.runtime).toBeDefined();
      expect(summary.merged).toBeDefined();
      expect(summary.validation).toBeDefined();
      expect(summary.changeCount).toBe(1);
    });
  });

  describe('toJSON', () => {
    it('should serialize configuration with sensitive data redacted', () => {
      process.env.MCPDEV_PROXY_CHILD_CMD = 'node';
      config.loadConfig();
      config.updateConfig({
        environment: {
          NORMAL_VAR: 'visible',
          PASSWORD: 'secret123',
          API_SECRET: 'hidden456'
        }
      });
      
      const json = config.toJSON() as any;
      
      expect(json.sanitized.environment.NORMAL_VAR).toBe('visible');
      expect(json.sanitized.environment.PASSWORD).toBe('[REDACTED]');
      expect(json.sanitized.environment.API_SECRET).toBe('[REDACTED]');
    });
  });

  describe('reset', () => {
    it('should reset configuration to defaults', () => {
      process.env.MCPDEV_PROXY_CHILD_CMD = 'node';
      config.loadConfig();
      config.updateConfig({ childArgs: ['--test'] });
      
      expect(config.getCurrentConfig()).toBeDefined();
      expect(config.getConfigSummary().changeCount).toBe(1);
      
      config.reset();
      
      expect(config.getCurrentConfig()).toBeNull();
      expect(config.getConfigSummary().changeCount).toBe(0);
      expect(config.isValid()).toBe(false);
    });

    it('should emit configReset event', async () => {
      const eventPromise = new Promise<void>((resolve) => {
        config.on('configReset', resolve);
      });
      
      config.reset();
      
      await eventPromise;
    });
  });
});

describe('Convenience Functions', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('MCPDEV_PROXY_')) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('createConfig', () => {
    it('should create and load configuration in one step', () => {
      process.env.MCPDEV_PROXY_CHILD_CMD = 'node';
      
      const { config, result } = createConfig();
      
      expect(config).toBeInstanceOf(Config);
      expect(result.valid).toBe(true);
      expect(config.getCurrentConfig()?.childCommand).toBe('node');
    });
  });

  describe('validateConfigObject', () => {
    it('should validate configuration without creating instance', () => {
      const result = validateConfigObject({
        childCommand: 'node',
        logLevel: 'invalid' as any
      });
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(error => error.includes('Invalid log level'))).toBe(true);
    });
  });

  describe('validateCommand', () => {
    it('should validate existing commands', () => {
      const result = validateCommand('node');
      
      expect(result.valid).toBe(true);
      expect(result.path).toBeDefined();
      expect(result.error).toBeUndefined();
    });

    it('should fail for non-existent commands', () => {
      const result = validateCommand('nonexistent-command-12345');
      
      expect(result.valid).toBe(false);
      expect(result.path).toBeUndefined();
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Command not found');
    });

    it('should handle absolute paths', () => {
      const nodePath = process.execPath; // Path to current node executable
      const result = validateCommand(nodePath);
      
      expect(result.valid).toBe(true);
      expect(result.path).toBe(nodePath);
    });
  });
});