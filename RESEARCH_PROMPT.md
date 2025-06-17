# MCP Protocol Implementation Research Request

## Project Context

We are building an **MCP Development Proxy** - a tool that sits between MCP clients (like Claude Desktop) and MCP servers to enable hot-reloading during development without losing client session state.

## What is MCP (Model Context Protocol)?

MCP is a protocol that allows AI applications to connect to external tools and data sources. It works like this:

```
MCP Client (e.g., Claude Desktop) ↔ MCP Server (provides tools/resources)
```

- **MCP Clients**: AI applications that want to use tools
- **MCP Servers**: Programs that provide tools, resources, or prompts to AI
- **Transport**: Communication layer (usually stdio - JSON-RPC over stdin/stdout)
- **Protocol**: JSON-RPC 2.0 with MCP-specific methods like `tools/list`, `tools/call`

## What We're Trying to Build

Our proxy creates this flow:
```
MCP Client ↔ MCP Development Proxy ↔ Child MCP Server
```

**Goals:**
1. **Transparent forwarding**: All MCP messages pass through unchanged
2. **Capability augmentation**: Add a `restart_server` tool to restart the child server
3. **Session persistence**: Client doesn't lose connection when child server restarts
4. **Hot-reloading**: Developers can restart their MCP server without restarting the client

## Our Current Implementation Approach

We're using the official `@modelcontextprotocol/sdk` TypeScript library:

1. **Proxy as MCP Server**: Our proxy acts as an MCP Server using `Server` class
2. **Child as subprocess**: We spawn the child MCP server as a subprocess using Node's `spawn()`
3. **Message forwarding**: We forward JSON-RPC requests to child via stdin/stdout
4. **Tool augmentation**: We intercept `tools/list` to add our `restart_server` tool

**Key Code Pattern:**
```typescript
// Proxy acts as MCP Server
this.server = new Server({ name: 'proxy-dev', version: '1.0.0-dev' }, capabilities);

// Forward tools/list requests
this.server.setRequestHandler(ListToolsRequestSchema, async (request) => {
  // Get tools from child via JSON-RPC over stdin/stdout
  const childResult = await this.callChild('tools/list', request.params);
  // Add our restart_server tool
  return { tools: [...childResult.tools, RESTART_SERVER_TOOL] };
});

// Forward tools/call requests  
this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'restart_server') {
    // Handle restart locally
    this.spawnChild();
    return { content: [{ type: 'text', text: 'Restarted successfully' }] };
  } else {
    // Forward to child
    return this.callChild('tools/call', request.params);
  }
});
```

## The Problem We're Experiencing

**Symptom**: MCP clients (including Inspector and other clients) connect to our proxy but don't receive any tools.

**Evidence:**
1. **CLI Testing Works**: When we test via command line, our proxy correctly returns all tools:
   ```bash
   echo '{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}' | node proxy.js --child-cmd "node test-server.js"
   # Returns: {"result": {"tools": [echo, add, greet, restart_server]}}
   ```

2. **MCP Inspector Fails**: Connection timeouts, crashes, no tools visible
3. **Other Clients Fail**: User reports other MCP clients also don't see tools

**Current Logs Show:**
- ✅ Proxy starts successfully
- ✅ Child server spawns and connects
- ✅ Proxy reports "got tools from child" with correct count
- ✅ Proxy reports "returning augmented tools list" with 4 tools
- ❌ But clients don't receive the tools

## Technical Investigation Needed

We suspect our fundamental approach might be wrong. **Key questions for research:**

### 1. **MCP Proxy Architecture Patterns**
- How should MCP proxies be implemented correctly?
- Should a proxy be an MCP Server that forwards requests, or something else?
- Are there reference implementations of MCP proxies we can study?

### 2. **Transport Layer Issues**
- Is our stdio transport implementation correct?
- Do we need to handle MCP handshake/initialization differently for proxies?
- Are there specific transport requirements for forwarding scenarios?

### 3. **Protocol Implementation**
- Are we missing required MCP protocol steps?
- Do we need to handle `initialize` requests differently?
- Should we be using `Client` class to connect to child instead of subprocess JSON-RPC?

### 4. **Reference Implementations**
Please study these existing MCP proxy/wrapper implementations:
- **mcp-agentify**: https://github.com/steipete/mcp-agentify
- **superargs**: https://github.com/supercorp-ai/superargs

**Questions about these:**
- How do they handle the client-proxy-server communication flow?
- Do they use different architectural patterns than ours?
- How do they handle transport and protocol forwarding?

### 5. **SDK Usage Patterns**
- Are we using `@modelcontextprotocol/sdk` correctly for proxy scenarios?
- Should we be using both `Server` and `Client` classes?
- Are there SDK examples showing proxy/forwarding patterns?

## Specific Output Needed

Please provide:

1. **Architecture Analysis**: What's wrong with our current approach?
2. **Correct Implementation Pattern**: How should MCP proxies be built?
3. **Reference Code**: Point to working examples we can study
4. **SDK Best Practices**: Correct usage patterns for our use case
5. **Protocol Deep Dive**: Any MCP protocol nuances we're missing

## Current Codebase Structure

```
src/
├── proxy.ts           # Main proxy implementation using Server class
├── mcp-logger.ts      # MCP-compliant logging (stderr only)
├── types.ts           # Type definitions
└── bin/mcpdev-proxy.ts # CLI entry point

test-server-sdk.js     # Test MCP server (works standalone)
```

**Key Files to Review:**
- `src/proxy.ts` - Our main implementation
- Official MCP TypeScript SDK documentation
- Reference proxy implementations mentioned above

The goal is to understand why our proxy works in CLI testing but fails with real MCP clients, and how to fix our architecture to work correctly.