/**
 * reloaderoo CLI entry point
 * 
 * A transparent MCP development wrapper that enables hot-reloading of MCP servers
 * without losing client session state. Acts as a proxy between MCP clients and servers.
 * 
 * Usage:
 *   reloaderoo --child-cmd "node server.js" [options]
 *   reloaderoo info
 * 
 * Example:
 *   reloaderoo --child-cmd "node /path/to/my-mcp-server.js" --log-level debug
 *   reloaderoo --child-cmd "python server.py" --child-args "--port" "8080" --working-dir ./src
 */

import { Command } from 'commander';
import { existsSync, accessSync, constants, readFileSync } from 'fs';
import { resolve, isAbsolute, dirname } from 'path';
import { MCPProxy } from '../mcp-proxy.js';
import { Config, validateCommand, getEnvironmentConfig } from '../config.js';
import { logger } from '../mcp-logger.js';
import type { ProxyConfig, LoggingLevel } from '../types.js';

/**
 * Load version from package.json dynamically
 */
function getVersion(): string {
  try {
    // Use __dirname if available (CommonJS), otherwise construct path
    const baseDir = typeof __dirname !== 'undefined' ? __dirname : dirname(__filename);
    const packagePath = resolve(baseDir, '../../package.json');
    const packageData = JSON.parse(readFileSync(packagePath, 'utf8'));
    return packageData.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Validate directory path and check accessibility
 */
function validateDirectory(path: string, name: string): { valid: boolean; error?: string } {
  const absPath = isAbsolute(path) ? path : resolve(path);
  
  if (!existsSync(absPath)) {
    return { valid: false, error: `${name} does not exist: ${absPath}` };
  }
  
  try {
    accessSync(absPath, constants.R_OK | constants.W_OK);
    return { valid: true };
  } catch {
    return { valid: false, error: `${name} is not readable/writable: ${absPath}` };
  }
}

/**
 * Parse child command and arguments from a single string
 * Handles quoted arguments properly
 */
function parseChildCommand(cmdString: string): { command: string; args: string[] } {
  const args: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';
  
  for (let i = 0; i < cmdString.length; i++) {
    const char = cmdString[i];
    
    if (!inQuote && (char === '"' || char === "'")) {
      inQuote = true;
      quoteChar = char;
    } else if (inQuote && char === quoteChar) {
      inQuote = false;
      quoteChar = '';
    } else if (!inQuote && char === ' ') {
      if (current) {
        args.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  
  if (current) {
    args.push(current);
  }
  
  return {
    command: args[0] || '',
    args: args.slice(1)
  };
}

/**
 * Format duration for human-readable output
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

// Create the main CLI program
const program = new Command();

program
  .name('reloaderoo')
  .description('A transparent MCP development wrapper for hot-reloading servers')
  .version(getVersion())
  .usage('[options] | info')
  .addHelpText('after', `
Examples:
  $ reloaderoo --child-cmd "node server.js"
  $ reloaderoo --child-cmd "python mcp_server.py" --log-level debug
  $ reloaderoo --child-cmd "npm run serve" --working-dir ./src --max-restarts 5
  $ reloaderoo info

Environment Variables:
  RELOADEROO_LOG_LEVEL      Set default log level
  RELOADEROO_LOG_FILE       Custom log file path
  RELOADEROO_RESTART_LIMIT  Default restart limit
  RELOADEROO_AUTO_RESTART   Enable/disable auto-restart (true/false)
  RELOADEROO_TIMEOUT        Operation timeout in milliseconds
  RELOADEROO_CHILD_CMD      Default child command
  RELOADEROO_CWD            Default working directory`);

// Main proxy command with options
program
  .option(
    '-c, --child-cmd <command>',
    'Command to run the child MCP server (required)'
  )
  .option(
    '-a, --child-args <args...>',
    'Arguments to pass to the child server'
  )
  .option(
    '-w, --working-dir <directory>',
    'Working directory for the child process',
    process.cwd()
  )
  .option(
    '-l, --log-level <level>',
    'Log level (debug, info, notice, warning, error, critical)',
    'info'
  )
  .option(
    '-f, --log-file <path>',
    'Custom log file path (logs to stderr by default)'
  )
  .option(
    '-t, --restart-timeout <ms>',
    'Timeout for restart operations in milliseconds',
    '30000'
  )
  .option(
    '-m, --max-restarts <number>',
    'Maximum number of restart attempts (0-10)',
    '3'
  )
  .option(
    '-d, --restart-delay <ms>',
    'Delay between restart attempts in milliseconds',
    '1000'
  )
  .option(
    '-q, --quiet',
    'Suppress non-essential output'
  )
  .option(
    '--no-auto-restart',
    'Disable automatic restart on crashes'
  )
  .option(
    '--debug',
    'Enable debug mode with verbose logging'
  )
  .option(
    '--dry-run',
    'Validate configuration without starting proxy'
  )
  .action(async (options) => {
    try {
      // Handle debug mode
      if (options.debug) {
        options.logLevel = 'debug';
      }
      
      // Create configuration
      const config = new Config();
      
      // Load environment configuration first
      const envConfig = getEnvironmentConfig();
      if (Object.keys(envConfig).length > 0 && !options.quiet) {
        process.stderr.write('Loaded configuration from environment variables\n');
      }
      
      // Check if child-cmd is provided (either via CLI or environment)
      const childCmd = options.childCmd || envConfig.childCommand;
      if (!childCmd) {
        process.stderr.write('Error: --child-cmd is required\n');
        process.stderr.write('Try: reloaderoo --help\n');
        process.exit(1);
      }
      
      // Parse child command if needed
      let childCommand = childCmd;
      let childArgs = options.childArgs || [];
      
      if (!options.childArgs && childCmd.includes(' ')) {
        const parsed = parseChildCommand(childCmd);
        childCommand = parsed.command;
        childArgs = parsed.args;
      }
      
      // Validate child command
      const cmdValidation = validateCommand(childCommand);
      if (!cmdValidation.valid) {
        process.stderr.write(`Error: ${cmdValidation.error}\n`);
        process.exit(1);
      }
      
      // Validate working directory
      const dirValidation = validateDirectory(options.workingDir, 'Working directory');
      if (!dirValidation.valid) {
        process.stderr.write(`Error: ${dirValidation.error}\n`);
        process.exit(1);
      }
      
      // Validate numeric options
      const restartTimeout = parseInt(options.restartTimeout);
      if (isNaN(restartTimeout) || restartTimeout < 1000 || restartTimeout > 300000) {
        process.stderr.write('Error: --restart-timeout must be between 1000 and 300000\n');
        process.exit(1);
      }
      
      const maxRestarts = parseInt(options.maxRestarts);
      if (isNaN(maxRestarts) || maxRestarts < 0 || maxRestarts > 10) {
        process.stderr.write('Error: --max-restarts must be between 0 and 10\n');
        process.exit(1);
      }
      
      const restartDelay = parseInt(options.restartDelay);
      if (isNaN(restartDelay) || restartDelay < 0 || restartDelay > 60000) {
        process.stderr.write('Error: --restart-delay must be between 0 and 60000\n');
        process.exit(1);
      }
      
      // Validate log level
      const validLogLevels: LoggingLevel[] = ['debug', 'info', 'notice', 'warning', 'error', 'critical'];
      if (!validLogLevels.includes(options.logLevel as LoggingLevel)) {
        process.stderr.write(`Error: Invalid log level '${options.logLevel}'\n`);
        process.stderr.write(`Valid levels: ${validLogLevels.join(', ')}\n`);
        process.exit(1);
      }
      
      // Build proxy configuration
      const proxyConfig: ProxyConfig = {
        childCommand: cmdValidation.path || childCommand,
        childArgs,
        workingDirectory: resolve(options.workingDir),
        environment: process.env as Record<string, string>,
        restartLimit: maxRestarts,
        operationTimeout: restartTimeout,
        logLevel: options.logLevel as LoggingLevel,
        autoRestart: options.autoRestart !== false,
        restartDelay
      };
      
      // Configure logging
      logger.setLevel(proxyConfig.logLevel as any);
      
      // Dry run mode - validate and exit
      if (options.dryRun) {
        const validation = config.validateConfig(proxyConfig);
        
        if (!options.quiet) {
          process.stderr.write('\n=== Configuration Validation ===\n');
          process.stderr.write(`Valid: ${validation.valid ? 'Yes' : 'No'}\n`);
          
          if (validation.errors.length > 0) {
            process.stderr.write('\nErrors:\n');
            validation.errors.forEach(err => process.stderr.write(`  - ${err}\n`));
          }
          
          if (validation.warnings.length > 0) {
            process.stderr.write('\nWarnings:\n');
            validation.warnings.forEach(warn => process.stderr.write(`  - ${warn}\n`));
          }
          
          if (validation.valid) {
            process.stderr.write('\nConfiguration:\n');
            process.stderr.write(`  Child Command: ${proxyConfig.childCommand}\n`);
            process.stderr.write(`  Child Args: ${proxyConfig.childArgs.join(' ') || '(none)'}\n`);
            process.stderr.write(`  Working Dir: ${proxyConfig.workingDirectory}\n`);
            process.stderr.write(`  Log Level: ${proxyConfig.logLevel}\n`);
            process.stderr.write(`  Auto Restart: ${proxyConfig.autoRestart}\n`);
            process.stderr.write(`  Max Restarts: ${proxyConfig.restartLimit}\n`);
            process.stderr.write(`  Restart Delay: ${formatDuration(proxyConfig.restartDelay)}\n`);
            process.stderr.write(`  Operation Timeout: ${formatDuration(proxyConfig.operationTimeout)}\n`);
          }
        }
        
        process.exit(validation.valid ? 0 : 1);
      }
      
      // Start the proxy
      if (!options.quiet) {
        process.stderr.write('Starting reloaderoo...\n');
        process.stderr.write(`Child: ${childCommand} ${childArgs.join(' ')}\n`);
        process.stderr.write(`Working Directory: ${proxyConfig.workingDirectory}\n`);
      }
      
      const proxy = new MCPProxy(proxyConfig);
      
      // Handle graceful shutdown
      const shutdown = async (signal: string) => {
        if (!options.quiet) {
          process.stderr.write(`\nReceived ${signal}, shutting down gracefully...\n`);
        }
        await proxy.stop();
        process.exit(0);
      };
      
      process.on('SIGINT', () => shutdown('SIGINT'));
      process.on('SIGTERM', () => shutdown('SIGTERM'));
      
      // Start proxy
      await proxy.start();
      
    } catch (error) {
      process.stderr.write(`Error: ${error instanceof Error ? error.message : 'Unknown error'}\n`);
      process.exit(1);
    }
  });

// Info subcommand for diagnostics
program
  .command('info')
  .description('Display version and configuration information')
  .option('-v, --verbose', 'Show detailed information')
  .action((options) => {
    const version = getVersion();
    
    process.stdout.write(`reloaderoo v${version}\n`);
    process.stdout.write('\n');
    
    // Basic info
    process.stdout.write('System Information:\n');
    process.stdout.write(`  Node Version: ${process.version}\n`);
    process.stdout.write(`  Platform: ${process.platform}\n`);
    process.stdout.write(`  Architecture: ${process.arch}\n`);
    process.stdout.write(`  Working Directory: ${process.cwd()}\n`);
    process.stdout.write('\n');
    
    // Environment configuration
    const envConfig = getEnvironmentConfig();
    if (Object.keys(envConfig).length > 0) {
      process.stdout.write('Environment Configuration:\n');
      Object.entries(envConfig).forEach(([key, value]) => {
        if (key === 'environment') return; // Skip child env vars
        process.stdout.write(`  ${key}: ${JSON.stringify(value)}\n`);
      });
      process.stdout.write('\n');
    }
    
    // Verbose mode - check common MCP servers
    if (options.verbose) {
      process.stdout.write('Common MCP Server Checks:\n');
      
      const commonCommands = ['node', 'python', 'python3', 'npm', 'npx', 'deno', 'bun'];
      commonCommands.forEach(cmd => {
        const validation = validateCommand(cmd);
        const status = validation.valid ? `✓ Found at ${validation.path}` : '✗ Not found';
        process.stdout.write(`  ${cmd}: ${status}\n`);
      });
      process.stdout.write('\n');
      
      // Environment variables
      process.stdout.write('MCP-related Environment Variables:\n');
      Object.entries(process.env)
        .filter(([key]) => key.startsWith('MCP') || key.startsWith('MCPDEV'))
        .forEach(([key, value]) => {
          process.stdout.write(`  ${key}=${value}\n`);
        });
    }
    
    process.stdout.write('\nFor more information: https://github.com/your-org/reloaderoo\n');
  });

/**
 * Main CLI function - exported for use by index.ts
 */
export async function runCLI(): Promise<void> {
  try {
    program.parse(process.argv);
    
    // If no command was provided, show help
    if (process.argv.length === 2) {
      program.help();
    }
  } catch (error) {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : 'Unknown error'}\n`);
    process.exit(1);
  }
}

// If this file is run directly (not imported), execute CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  runCLI();
}