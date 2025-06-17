/**
 * Comprehensive Pino-based logging system for mcpdev-proxy
 * 
 * This logger is designed for MCP (Model Context Protocol) compliance:
 * - NO stdio output during normal operations (critical for MCP)
 * - File-based logging by default
 * - Environment variable configuration
 * - Automatic directory creation and fallback handling
 * - Graceful shutdown with log flushing
 */

import { pino, Logger, Level } from 'pino';
import { createWriteStream, WriteStream, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir, tmpdir } from 'os';
import { platform } from 'process';
import type { LoggingLevel } from './types.js';

interface LoggerConfig {
  logFile?: string;
  logLevel: LoggingLevel;
  consoleLogging: boolean;
}

/**
 * Map MCP LoggingLevel to Pino Level
 */
function mapLogLevel(mcpLevel: LoggingLevel): Level {
  const mapping: Record<LoggingLevel, Level> = {
    'debug': 'debug',
    'info': 'info', 
    'notice': 'info',    // Pino doesn't have notice, map to info
    'warning': 'warn',
    'error': 'error',
    'critical': 'fatal',
    'alert': 'fatal',    // Pino doesn't have alert, map to fatal
    'emergency': 'fatal' // Pino doesn't have emergency, map to fatal
  };
  return mapping[mcpLevel] || 'info';
}

class LoggerManager {
  private static instance: Logger | null = null;
  private static logStream: WriteStream | null = null;
  private static config: LoggerConfig | null = null;

  /**
   * Get the singleton logger instance
   */
  static getLogger(): Logger {
    if (!LoggerManager.instance) {
      LoggerManager.instance = LoggerManager.createLogger();
    }
    return LoggerManager.instance;
  }

  /**
   * Create and configure the Pino logger
   */
  private static createLogger(): Logger {
    const config = LoggerManager.getLoggerConfig();
    LoggerManager.config = config;

    const pinoLevel = mapLogLevel(config.logLevel);
    const loggerOptions: any = {
      level: pinoLevel,
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label: string) => ({ level: label }),
        log: (object: any) => {
          // Remove potential sensitive data
          const sanitized = { ...object };
          if (sanitized.message && typeof sanitized.message === 'string') {
            // Remove potential JSON-RPC content from logs
            if (sanitized.message.includes('"jsonrpc"')) {
              sanitized.message = '[JSON-RPC Message]';
            }
          }
          return sanitized;
        }
      }
    };

    // Setup destinations based on configuration
    const destinations: any[] = [];

    // Always add file destination
    try {
      const logStream = LoggerManager.createLogStream(config.logFile);
      if (logStream) {
        LoggerManager.logStream = logStream;
        destinations.push({
          stream: logStream,
          level: pinoLevel
        });
      }
    } catch (error) {
      // Fallback will be handled below
      console.error('Failed to create primary log stream:', error);
    }

    // Add console destination only if explicitly enabled
    if (config.consoleLogging) {
      destinations.push({
        stream: process.stderr,
        level: pinoLevel
      });
    }

    // If no destinations were set up, create a fallback
    if (destinations.length === 0) {
      const fallbackStream = LoggerManager.createFallbackStream();
      if (fallbackStream) {
        LoggerManager.logStream = fallbackStream;
        destinations.push({
          stream: fallbackStream,
          level: pinoLevel
        });
      }
    }

    // Create logger with multiple destinations if needed
    if (destinations.length === 1) {
      return pino(loggerOptions, destinations[0].stream);
    } else if (destinations.length > 1) {
      return pino(loggerOptions, pino.multistream(destinations));
    } else {
      // Last resort: create a no-op logger
      return pino(loggerOptions, createWriteStream('/dev/null'));
    }
  }

  /**
   * Parse configuration from environment variables
   */
  private static getLoggerConfig(): LoggerConfig {
    const logLevel = (process.env['MCPDEV_PROXY_LOG_LEVEL'] || 'info') as LoggingLevel;
    const consoleLogging = process.env['MCPDEV_PROXY_CONSOLE_LOGGING'] === 'true';
    const logFile = process.env['MCPDEV_PROXY_LOG_FILE'] || LoggerManager.getDefaultLogPath();

    // Validate log level
    const validLevels: LoggingLevel[] = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'];
    const finalLogLevel = validLevels.includes(logLevel) ? logLevel : 'info';

    return {
      logFile,
      logLevel: finalLogLevel,
      consoleLogging
    };
  }

  /**
   * Get platform-appropriate default log file path
   */
  private static getDefaultLogPath(): string {
    try {
      if (platform === 'darwin') {
        // macOS: ~/Library/Logs/mcpdev-proxy.log
        return join(homedir(), 'Library', 'Logs', 'mcpdev-proxy.log');
      } else {
        // Linux/other: ~/.cache/mcpdev-proxy/mcpdev-proxy.log
        return join(homedir(), '.cache', 'mcpdev-proxy', 'mcpdev-proxy.log');
      }
    } catch {
      // Fallback to temp directory
      return join(tmpdir(), 'mcpdev-proxy.log');
    }
  }

  /**
   * Create log stream with automatic directory creation
   */
  private static createLogStream(logPath: string | undefined): WriteStream | null {
    if (!logPath) {
      return null;
    }
    
    try {
      const logDir = dirname(logPath);
      
      // Synchronously ensure directory exists
      LoggerManager.ensureDirectorySync(logDir);
      
      // Create write stream with appropriate options
      const stream = createWriteStream(logPath, {
        flags: 'a', // append mode
        encoding: 'utf8',
        autoClose: true,
        emitClose: true
      });

      // Handle stream errors gracefully
      stream.on('error', (error) => {
        console.error(`Log stream error for ${logPath}:`, error);
      });

      return stream;
    } catch (error) {
      console.error(`Failed to create log stream for ${logPath}:`, error);
      return null;
    }
  }

  /**
   * Create fallback log stream when primary fails
   */
  private static createFallbackStream(): WriteStream | null {
    const fallbackPaths = [
      join(tmpdir(), 'mcpdev-proxy.log'),
      join(tmpdir(), `mcpdev-proxy-${Date.now()}.log`)
    ];

    for (const fallbackPath of fallbackPaths) {
      try {
        const stream = LoggerManager.createLogStream(fallbackPath);
        if (stream) {
          console.error(`Using fallback log file: ${fallbackPath}`);
          return stream;
        }
      } catch {
        continue;
      }
    }

    console.error('Failed to create any log stream, logging will be lost');
    return null;
  }

  /**
   * Synchronously ensure directory exists
   */
  private static ensureDirectorySync(dirPath: string): void {
    try {
      mkdirSync(dirPath, { recursive: true });
    } catch (error: any) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  /**
   * Flush logs and close streams gracefully
   */
  static async flush(): Promise<void> {
    if (LoggerManager.logStream) {
      return new Promise<void>((resolve) => {
        const stream = LoggerManager.logStream!;
        
        // Set up timeout to prevent hanging
        const timeout = setTimeout(() => {
          resolve();
        }, 5000);

        stream.end(() => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
  }

  /**
   * Get current logger configuration for debugging
   */
  static getCurrentConfig(): LoggerConfig | null {
    return LoggerManager.config;
  }

  /**
   * Set custom log file path at runtime
   * This will recreate the logger instance with the new path
   */
  static setLogFile(logPath: string): void {
    if (LoggerManager.config) {
      LoggerManager.config.logFile = logPath;
      // Force recreation of logger on next getLogger() call
      LoggerManager.instance = null;
      if (LoggerManager.logStream) {
        LoggerManager.logStream.end();
        LoggerManager.logStream = null;
      }
    }
  }

  /**
   * Set log level at runtime
   * This will update the existing logger's level without recreating it
   */
  static setLogLevel(level: LoggingLevel): void {
    const validLevels: LoggingLevel[] = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'];
    if (validLevels.includes(level)) {
      if (LoggerManager.config) {
        LoggerManager.config.logLevel = level;
      }
      if (LoggerManager.instance) {
        LoggerManager.instance.level = mapLogLevel(level);
      }
    }
  }

  /**
   * Internal method for exit handler to close log stream
   */
  static closeLogStream(): void {
    if (LoggerManager.logStream && !LoggerManager.logStream.destroyed) {
      LoggerManager.logStream.end();
    }
  }
}

// Setup process exit handlers for log flushing
process.on('exit', () => {
  // Synchronous flush on exit
  LoggerManager.closeLogStream();
});

process.on('SIGINT', async () => {
  await LoggerManager.flush();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await LoggerManager.flush();
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', async (error) => {
  const logger = LoggerManager.getLogger();
  logger.fatal('Uncaught exception:', error);
  await LoggerManager.flush();
  process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
  const logger = LoggerManager.getLogger();
  logger.fatal('Unhandled rejection at:', promise, 'reason:', reason);
  await LoggerManager.flush();
  process.exit(1);
});

/**
 * Get the configured logger instance
 * This is the main export that should be used throughout the application
 */
export const logger = LoggerManager.getLogger();

/**
 * Export the LoggerManager for advanced usage
 */
export { LoggerManager };

/**
 * Export types for external use
 */
export type { LoggerConfig };