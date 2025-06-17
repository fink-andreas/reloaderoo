/**
 * Tests for ProcessManager - Child MCP server lifecycle management
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProcessManager } from '../src/process-manager.js';
import { ProcessState, ProxyConfig, ProxyErrorCode } from '../src/types.js';

// Mock cross-spawn
vi.mock('cross-spawn', () => ({
  default: vi.fn()
}));

// Mock logger
vi.mock('../src/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn()
  }
}));

describe('ProcessManager', () => {
  let processManager: ProcessManager;
  let mockConfig: ProxyConfig;

  beforeEach(() => {
    mockConfig = {
      childCommand: 'node test-server.js',
      childArgs: ['--test'],
      workingDirectory: '/tmp',
      environment: { NODE_ENV: 'test' },
      restartLimit: 3,
      operationTimeout: 5000,
      logLevel: 'info',
      autoRestart: true,
      restartDelay: 100
    };

    processManager = new ProcessManager(mockConfig);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with correct default state', () => {
      expect(processManager.getState()).toBe(ProcessState.STOPPED);
      expect(processManager.getRestartCount()).toBe(0);
      expect(processManager.getChildProcess()).toBeNull();
    });

    it('should validate configuration', () => {
      expect(() => {
        new ProcessManager({
          ...mockConfig,
          childCommand: ''
        });
      }).toThrow();

      expect(() => {
        new ProcessManager({
          ...mockConfig,
          restartLimit: -1
        });
      }).toThrow();
    });
  });

  describe('getState', () => {
    it('should return current process state', () => {
      expect(processManager.getState()).toBe(ProcessState.STOPPED);
    });
  });

  describe('getRestartCount', () => {
    it('should return current restart count', () => {
      expect(processManager.getRestartCount()).toBe(0);
    });
  });

  describe('getChildProcess', () => {
    it('should return null when no process is running', () => {
      expect(processManager.getChildProcess()).toBeNull();
    });
  });

  describe('isHealthy', () => {
    it('should return false when process is not running', async () => {
      const healthy = await processManager.isHealthy();
      expect(healthy).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should emit error events', (done) => {
      processManager.on('error', (error) => {
        expect(error.code).toBeDefined();
        expect(error.message).toBeDefined();
        done();
      });

      // Trigger an error by trying to spawn with invalid state
      processManager.spawn().catch(() => {
        // Expected to fail in test environment
      });
    });
  });

  describe('configuration validation', () => {
    it('should reject invalid child command', () => {
      expect(() => {
        new ProcessManager({
          ...mockConfig,
          childCommand: ''
        });
      }).toThrow('childCommand is required');
    });

    it('should reject negative restart limit', () => {
      expect(() => {
        new ProcessManager({
          ...mockConfig,
          restartLimit: -1
        });
      }).toThrow('restartLimit must be >= 0');
    });

    it('should reject too short operation timeout', () => {
      expect(() => {
        new ProcessManager({
          ...mockConfig,
          operationTimeout: 500
        });
      }).toThrow('operationTimeout must be >= 1000ms');
    });
  });

  describe('event emission', () => {
    it('should be an EventEmitter', () => {
      expect(processManager.on).toBeDefined();
      expect(processManager.emit).toBeDefined();
      expect(processManager.removeListener).toBeDefined();
    });

    it('should support event listeners', () => {
      const listener = vi.fn();
      processManager.on('error', listener);
      processManager.removeListener('error', listener);
      expect(listener).not.toHaveBeenCalled();
    });
  });
});