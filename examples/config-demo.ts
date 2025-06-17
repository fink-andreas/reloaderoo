#!/usr/bin/env tsx
/**
 * Configuration System Demonstration
 * 
 * This script demonstrates the key features of the mcpdev-proxy configuration system.
 * Run with: npx tsx examples/config-demo.ts
 */

import { Config, createConfig, validateCommand } from '../src/config.js';
import type { ProxyConfig } from '../src/types.js';

async function main() {
  console.log('🔧 MCP Development Proxy - Configuration System Demo\n');

  // 1. Create and load configuration
  console.log('📋 1. Creating and loading configuration...');
  const { config, result } = createConfig();
  
  if (!result.valid) {
    console.log('❌ Initial configuration invalid (expected - no childCommand):');
    result.errors.forEach(error => console.log(`   • ${error}`));
  }

  // 2. Set environment variables and reload
  console.log('\n🌍 2. Setting environment variables and reloading...');
  process.env.MCPDEV_PROXY_CHILD_CMD = 'node';
  process.env.MCPDEV_PROXY_LOG_LEVEL = 'debug';
  process.env.MCPDEV_PROXY_RESTART_LIMIT = '5';
  process.env.MCPDEV_PROXY_AUTO_RESTART = 'true';
  process.env.MCPDEV_PROXY_CHILD_ARGS = '--version, --help';
  
  const reloadResult = config.loadConfig();
  if (reloadResult.valid) {
    console.log('✅ Configuration loaded successfully from environment variables');
    const currentConfig = config.getCurrentConfig()!;
    console.log(`   • Child command: ${currentConfig.childCommand}`);
    console.log(`   • Log level: ${currentConfig.logLevel}`);
    console.log(`   • Restart limit: ${currentConfig.restartLimit}`);
    console.log(`   • Auto restart: ${currentConfig.autoRestart}`);
    console.log(`   • Child args: [${currentConfig.childArgs.join(', ')}]`);
  }

  // 3. Runtime configuration updates
  console.log('\n🔄 3. Demonstrating runtime configuration updates...');
  
  // Listen for configuration changes
  config.on('configChanged', (event) => {
    console.log(`   📢 Configuration changed from ${event.source}:`);
    Object.entries(event.changes).forEach(([key, value]) => {
      console.log(`      • ${key}: ${JSON.stringify(value)}`);
    });
  });

  const updateResult = config.updateConfig({
    childArgs: ['--runtime-update', '--debug'],
    environment: { NODE_ENV: 'development', DEBUG: 'true' }
  });

  if (updateResult.valid) {
    console.log('✅ Runtime update successful');
  }

  // 4. Configuration validation
  console.log('\n✅ 4. Testing configuration validation...');
  
  const validationTests = [
    {
      name: 'Invalid log level',
      config: { childCommand: 'node', logLevel: 'invalid' as any }
    },
    {
      name: 'Negative restart limit',
      config: { childCommand: 'node', restartLimit: -1 }
    },
    {
      name: 'Invalid child args',
      config: { childCommand: 'node', childArgs: 'not-an-array' as any }
    },
    {
      name: 'Valid configuration',
      config: { 
        childCommand: 'node', 
        logLevel: 'info' as const,
        restartLimit: 3,
        childArgs: ['--version']
      }
    }
  ];

  validationTests.forEach(test => {
    const validation = config.validateConfig(test.config);
    console.log(`   ${validation.valid ? '✅' : '❌'} ${test.name}`);
    if (!validation.valid) {
      validation.errors.slice(0, 2).forEach(error => 
        console.log(`      • ${error}`)
      );
    }
  });

  // 5. Command validation
  console.log('\n🔍 5. Testing command validation...');
  
  const commands = ['node', 'nonexistent-command-12345', '/bin/sh'];
  
  for (const cmd of commands) {
    const validation = validateCommand(cmd);
    console.log(`   ${validation.valid ? '✅' : '❌'} ${cmd}`);
    if (validation.valid && validation.path) {
      console.log(`      📍 Found at: ${validation.path}`);
    } else if (validation.error) {
      console.log(`      ⚠️  ${validation.error}`);
    }
  }

  // 6. Configuration summary
  console.log('\n📊 6. Configuration summary:');
  const summary = config.getConfigSummary();
  console.log(`   • Sources configured: ${Object.keys(summary.sources).length}`);
  console.log(`   • Changes made: ${summary.changeCount}`);
  console.log(`   • Currently valid: ${config.isValid()}`);
  console.log(`   • Has warnings: ${summary.validation?.warnings.length || 0 > 0}`);

  // 7. JSON serialization (with sensitive data redaction)
  console.log('\n🔒 7. JSON serialization with sensitive data redaction:');
  config.updateConfig({
    environment: { 
      NORMAL_VAR: 'visible-value',
      API_PASSWORD: 'secret123',
      DB_SECRET: 'hidden456'
    }
  });
  
  const json = config.toJSON() as any;
  console.log('   Environment variables:');
  Object.entries(json.sanitized.environment).forEach(([key, value]) => {
    console.log(`      • ${key}: ${value}`);
  });

  // 8. Event system demonstration
  console.log('\n📡 8. Event system demonstration...');
  
  let eventCount = 0;
  config.on('configChanged', () => eventCount++);
  
  config.updateConfig({ restartLimit: 7 });
  config.updateConfig({ operationTimeout: 45000 });
  config.reset();
  
  console.log(`   📈 Events emitted: ${eventCount + 1} (including reset)`);
  
  console.log('\n🎉 Configuration system demonstration complete!');
}

// Error handling
main().catch(error => {
  console.error('❌ Demo failed:', error);
  process.exit(1);
});