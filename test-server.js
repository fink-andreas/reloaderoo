#!/usr/bin/env node

/**
 * Simple mock MCP server for testing the proxy
 * Implements basic MCP protocol over stdio using readline
 */

const readline = require('readline');

// Setup stdio interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

// Server state
let initialized = false;

// Log to stderr (not stdout to avoid interfering with MCP protocol)
function log(message) {
  process.stderr.write(`[MockServer] ${message}\n`);
}

// Send JSON-RPC message
function sendMessage(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

// Handle initialize request
function handleInitialize(request) {
  log('Received initialize request');
  
  const response = {
    jsonrpc: '2.0',
    id: request.id,
    result: {
      protocolVersion: '2025-03-26',
      capabilities: {
        tools: {
          listChanged: true
        }
      },
      serverInfo: {
        name: 'test-mcp-server',
        version: '1.0.0'
      },
      instructions: 'This is a test MCP server for manual testing of mcpdev-proxy'
    }
  };
  
  sendMessage(response);
  initialized = true;
  log('Sent initialize response');
}

// Handle tools/list request
function handleToolsList(request) {
  log('Received tools/list request');
  
  const response = {
    jsonrpc: '2.0',
    id: request.id,
    result: {
      tools: [
        {
          name: 'echo',
          description: 'Echo back the input message',
          inputSchema: {
            type: 'object',
            properties: {
              message: {
                type: 'string',
                description: 'Message to echo back'
              }
            },
            required: ['message']
          }
        },
        {
          name: 'add',
          description: 'Add two numbers together',
          inputSchema: {
            type: 'object',
            properties: {
              a: { type: 'number', description: 'First number' },
              b: { type: 'number', description: 'Second number' }
            },
            required: ['a', 'b']
          }
        }
      ]
    }
  };
  
  sendMessage(response);
  log('Sent tools/list response');
}

// Handle tools/call request
function handleToolsCall(request) {
  log(`Received tools/call request for: ${request.params.name}`);
  
  const { name, arguments: args } = request.params;
  let result;
  
  if (name === 'echo') {
    result = {
      content: [{
        type: 'text',
        text: `Echo: ${args.message || 'No message provided'}`
      }]
    };
  } else if (name === 'add') {
    const sum = (args.a || 0) + (args.b || 0);
    result = {
      content: [{
        type: 'text',
        text: `${args.a} + ${args.b} = ${sum}`
      }]
    };
  } else {
    result = {
      content: [{
        type: 'text',
        text: `Unknown tool: ${name}`
      }],
      isError: true
    };
  }
  
  const response = {
    jsonrpc: '2.0',
    id: request.id,
    result
  };
  
  sendMessage(response);
  log(`Sent tools/call response for: ${name}`);
}

// Handle ping request
function handlePing(request) {
  log('Received ping request');
  
  const response = {
    jsonrpc: '2.0',
    id: request.id,
    result: {}
  };
  
  sendMessage(response);
  log('Sent ping response');
}

// Handle incoming messages
rl.on('line', (line) => {
  try {
    const message = JSON.parse(line);
    log(`Received: ${message.method || 'response'}`);
    
    if (message.method === 'initialize') {
      handleInitialize(message);
    } else if (message.method === 'tools/list') {
      handleToolsList(message);
    } else if (message.method === 'tools/call') {
      handleToolsCall(message);
    } else if (message.method === 'ping') {
      handlePing(message);
    } else if (message.method === 'notifications/initialized') {
      log('Client initialized');
    } else {
      log(`Unknown method: ${message.method}`);
      
      // Send error response for unknown methods
      if (message.id) {
        const errorResponse = {
          jsonrpc: '2.0',
          id: message.id,
          error: {
            code: -32601,
            message: 'Method not found'
          }
        };
        sendMessage(errorResponse);
      }
    }
  } catch (error) {
    log(`Error parsing message: ${error.message}`);
    log(`Raw message: ${line}`);
  }
});

// Handle process signals
process.on('SIGTERM', () => {
  log('Received SIGTERM, shutting down...');
  process.exit(0);
});

process.on('SIGINT', () => {
  log('Received SIGINT, shutting down...');
  process.exit(0);
});

log('Mock MCP server started, waiting for messages...');