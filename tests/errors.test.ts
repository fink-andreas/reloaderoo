/**
 * Tests for the error handling system
 */

import { describe, it, expect } from 'vitest';
import {
  ProxyErrorExtended,
  ProxyErrorHandler,
  createJSONRPCError,
  formatError,
  isJSONRPCError,
  isProxyError,
  sanitizeError,
  errorHandler,
  JSONRPC_ERROR_CODES,
  PROXY_SPECIFIC_ERROR_CODES
} from '../src/errors.js';
import { ProxyErrorCode } from '../src/types.js';

describe('ProxyErrorExtended', () => {
  it('should create error with all properties', () => {
    const cause = new Error('Original error');
    const error = new ProxyErrorExtended(
      ProxyErrorCode.CHILD_CRASHED,
      'Child process crashed',
      {
        cause,
        context: { pid: 1234 },
        retryable: true
      }
    );

    expect(error.code).toBe(ProxyErrorCode.CHILD_CRASHED);
    expect(error.message).toBe('Child process crashed');
    expect(error.cause).toBe(cause);
    expect(error.context).toEqual({ pid: 1234 });
    expect(error.retryable).toBe(true);
    expect(error.timestamp).toBeGreaterThan(0);
  });
});

describe('ProxyErrorHandler', () => {
  it('should create JSON-RPC error response', () => {
    const handler = new ProxyErrorHandler();
    const error = new ProxyErrorExtended(
      ProxyErrorCode.CHILD_UNAVAILABLE,
      'Child is not available'
    );

    const response = handler.createErrorResponse(error, 'test-id', {
      request: { method: 'test' }
    });

    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe('test-id');
    expect(response.error).toBeDefined();
    expect(response.error.code).toBe(PROXY_SPECIFIC_ERROR_CODES.CHILD_UNAVAILABLE);
    expect(response.error.message).toBe('Child is not available');
  });

  it('should determine retryable errors correctly', () => {
    const handler = new ProxyErrorHandler();

    const retryableError = new ProxyErrorExtended(
      ProxyErrorCode.CHILD_CRASHED,
      'Crashed',
      { retryable: true }
    );
    expect(handler.isRetryableError(retryableError)).toBe(true);

    const nonRetryableError = new ProxyErrorExtended(
      ProxyErrorCode.INVALID_CONFIG,
      'Bad config'
    );
    expect(handler.isRetryableError(nonRetryableError)).toBe(false);

    const connectionError = new Error('ECONNREFUSED');
    expect(handler.isRetryableError(connectionError)).toBe(true);
  });

  it('should calculate retry delay with exponential backoff', () => {
    const handler = new ProxyErrorHandler({ retryDelayMs: 1000 });

    const delay1 = handler.calculateRetryDelay(1);
    expect(delay1).toBeGreaterThanOrEqual(1000);
    expect(delay1).toBeLessThan(1300); // With jitter

    const delay2 = handler.calculateRetryDelay(2);
    expect(delay2).toBeGreaterThanOrEqual(2000);
    expect(delay2).toBeLessThan(2600);

    const delay5 = handler.calculateRetryDelay(5);
    expect(delay5).toBeLessThanOrEqual(30000); // Max delay
  });

  it('should implement circuit breaker pattern', () => {
    const handler = new ProxyErrorHandler({ circuitBreakerThreshold: 3 });

    // Simulate failures
    for (let i = 0; i < 3; i++) {
      handler.handleError(
        new ProxyErrorExtended(ProxyErrorCode.CHILD_CRASHED, 'Crashed')
      );
    }

    expect(handler.isCircuitBreakerOpen('proxy_error_CHILD_CRASHED')).toBe(true);
  });
});

describe('Helper functions', () => {
  it('should create JSON-RPC error object', () => {
    const error = createJSONRPCError(
      JSONRPC_ERROR_CODES.METHOD_NOT_FOUND,
      'Method not found',
      { method: 'unknown' }
    );

    expect(error.error.code).toBe(-32601);
    expect(error.error.message).toBe('Method not found');
    expect(error.error.data).toEqual({ method: 'unknown' });
    expect(error.jsonrpc).toBe('2.0');
    expect(error.id).toBe(null);
  });

  it('should format error for display', () => {
    const proxyError = new ProxyErrorExtended(
      ProxyErrorCode.CHILD_CRASHED,
      'Process crashed'
    );
    expect(formatError(proxyError)).toBe('[CHILD_CRASHED] Process crashed');

    const stdError = new Error('Standard error');
    expect(formatError(stdError)).toBe('Standard error');

    expect(formatError('String error')).toBe('String error');
  });

  it('should validate JSON-RPC errors', () => {
    expect(isJSONRPCError({ code: -32600, message: 'Invalid' })).toBe(true);
    expect(isJSONRPCError({ code: 'invalid', message: 'Invalid' })).toBe(false);
    expect(isJSONRPCError({ message: 'Invalid' })).toBe(false);
    expect(isJSONRPCError(null)).toBe(false);
  });

  it('should validate proxy errors', () => {
    const proxyError = new ProxyErrorExtended(
      ProxyErrorCode.CHILD_CRASHED,
      'Crashed'
    );
    expect(isProxyError(proxyError)).toBe(true);

    const stdError = new Error('Standard');
    expect(isProxyError(stdError)).toBe(false);
  });

  it('should sanitize error messages', () => {
    const error = new Error('Failed to connect to 192.168.1.1:5432');
    const sanitized = sanitizeError(error);
    expect(sanitized.message).toBe('Failed to connect to [IP]:[PORT]');

    const pathError = new Error('File not found: /home/user/secret/file.txt');
    const sanitizedPath = sanitizeError(pathError);
    expect(sanitizedPath.message).toBe('File not found: /file.txt');
  });
});

describe('Error integration', () => {
  it('should handle various error scenarios', () => {
    // Timeout error
    const timeoutError = new Error('Operation timeout');
    const timeoutResponse = errorHandler.handleError(timeoutError);
    expect(timeoutResponse.code).toBe(PROXY_SPECIFIC_ERROR_CODES.CHILD_TIMEOUT);

    // Parse error
    const parseError = new Error('Failed to parse JSON');
    const parseResponse = errorHandler.handleError(parseError);
    expect(parseResponse.code).toBe(JSONRPC_ERROR_CODES.PARSE_ERROR);

    // Method not found
    const methodError = new Error('Method not found');
    const methodResponse = errorHandler.handleError(methodError);
    expect(methodResponse.code).toBe(JSONRPC_ERROR_CODES.METHOD_NOT_FOUND);

    // Invalid params
    const paramsError = new Error('Invalid parameters');
    const paramsResponse = errorHandler.handleError(paramsError);
    expect(paramsResponse.code).toBe(JSONRPC_ERROR_CODES.INVALID_PARAMS);

    // Generic error
    const genericError = new Error('Something went wrong');
    const genericResponse = errorHandler.handleError(genericError);
    expect(genericResponse.code).toBe(JSONRPC_ERROR_CODES.INTERNAL_ERROR);
  });

  it('should sanitize sensitive context information', () => {
    const error = new Error('Database connection failed');
    const context = {
      password: 'secret123',
      token: 'bearer-token',
      username: 'admin',
      nested: {
        apiSecret: 'api-key'
      }
    };

    const response = errorHandler.createErrorResponse(error, null, context);
    const data = response.error.data as any;

    expect(data.context.password).toBe('[REDACTED]');
    expect(data.context.token).toBe('[REDACTED]');
    expect(data.context.username).toBe('admin');
    expect(data.context.nested.apiSecret).toBe('[REDACTED]');
  });
});