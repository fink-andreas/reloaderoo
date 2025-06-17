Yes, absolutely. Here is the final, complete version.

This document integrates the full, comprehensive detail of your original PRD with the precise technical accuracy of the Model Context Protocol v2025-03-26 specification. It is designed to be the definitive blueprint for building the `mcpdev-proxy`.

***

# MCP Development Proxy (`mcpdev-proxy`) – PRD & Solution Design

## 1. Executive Summary

**Product Name:** *MCP Development Proxy* (`mcpdev-proxy`)

**Vision:** A transparent, stdio-based **wrapper** that launches a child MCP server and exposes all its capabilities (tools, prompts, resources) plus one additional lifecycle-management tool. It allows seamless restarting of the child server during development without disrupting the client’s session. The proxy appears identical to the child server (aside from a “-dev” suffix in its name/version) and simply adds a `restart_server` tool.

**Problem:** When developing an MCP server (e.g., for use with clients like Anthropic’s Claude), code changes typically require restarting the server process. This forces developers to terminate the entire client session, causing a loss of context and interrupting the development flow. There is **no built-in mechanism** in MCP clients to reload a server mid-session. This makes iterative development slow and cumbersome.

**Solution:** Provide a **lightweight MCP-compliant wrapper** that manages the child server’s lifecycle (spawn, restart, terminate) transparently. The proxy forwards all MCP JSON-RPC messages between the client and child process, making it effectively invisible. An extra `restart_server` tool is exposed for the developer to trigger an in-place restart of the child server. This enables hot-reloading of the server's code or configuration without losing session context.

## 2. Product Overview

### 2.1 Target Users & Use Cases

*   **Primary Users:** MCP server **developers** using stdio-based AI clients (like the Claude Code CLI) on macOS who need to frequently restart their custom MCP server during debugging and development.
*   **Secondary:** MCP developers using other stdio-based AI clients or IDE plugins on macOS with similar needs.
*   **Tertiary:** Teams managing multiple MCP servers concurrently (each wrapped with its own proxy) for complex development environments.

**Key Use Cases:**

*   *Hot Reload in Development:* A developer updates their MCP server's code and wants the client to use the new code immediately. The proxy's `restart_server` tool allows the server to be restarted behind the scenes, so the **session continues uninterrupted**.
*   *Crash Recovery:* If the child server crashes, the proxy automatically relaunches it, preventing the client session from dying.
*   *Dynamic Configuration:* A developer needs to change an environment variable mid-session. The proxy’s restart mechanism can apply those changes safely.

### 2.2 Value Proposition

*   **Seamless Dev Workflow:** Eliminates the need to restart the client or lose conversation context whenever the server code changes.
*   **Transparency:** The client sees no difference between the proxy-wrapped server and the original, except for the added restart tool and a "-dev" suffix on the server name. This means **zero code changes** are required in the MCP server itself.
*   **Generality:** Works with any MCP server that communicates via the Model Context Protocol over stdio.
*   **Resilience:** Provides automated recovery from crashes.

## 3. User Stories & Use Cases

**Epic 1: Development Workflow**

*   *US1.1:* As a developer, I want to change my MCP server code and have my client immediately use the updated version via a quick restart, without resetting my session.
*   *US1.2:* As a developer, I want my client session and conversation state to persist after the server restarts.
*   *US1.3:* As a developer, I want to trigger a server restart via an MCP `tools/call` request from my client interface.

**Epic 2: Server Management & Reliability**

*   *US2.1:* As a developer, I want to wrap any existing MCP server binary **without modifying its code**.
*   *US2.2:* As a developer, I want the proxy to detect and automatically restart my child server if it crashes.
*   *US2.3:* As a developer, I want the wrapped server to appear **identical** to the original from the client’s perspective (aside from the added restart tool).

## 4. Core Concept & Scope

The MCP Development Proxy is an **invisible intermediary** between an MCP client and the real MCP server (the child process).

*   **Starts and Stops the Child:** The proxy launches the child MCP server process on startup and ensures its termination on shutdown.
*   **Forwards All MCP Messages:** The proxy pipes all **stdio JSON-RPC messages** between the client and child. It parses each message to determine if it should be forwarded or handled internally.
*   **Capability Reflection:** On startup, the proxy intercepts the MCP `initialize` handshake. It forwards the client's `initialize` request to the child, receives the child's `InitializeResult`, and then **augments the capabilities** before forwarding the response to the client. Specifically, it adds the `restart_server` tool to the `ServerCapabilities` and appends "-dev" to the `serverInfo`.
*   **`restart_server` Tool:** The only functional addition is a special tool named `restart_server`. When the client sends a `tools/call` request for this tool, the proxy intercepts it, terminates the current child process, and starts a fresh one. After a successful restart, it sends MCP notifications (`notifications/tools/list_changed`, etc.) to the client.
*   **Out of Scope:** The proxy does *not* modify or hot-reload code in-memory (it performs a full process restart). It does not provide a debugging interface, profiling, or monitoring beyond crash detection.

## 5. Functional Requirements

### FR1: Child Server Lifecycle Management
*   **FR1.1 – Spawn on Start:** The proxy launches the child MCP server as a subprocess.
*   **FR1.2 – Clean Shutdown:** When the proxy terminates, it gracefully terminates the child process (SIGTERM, then SIGKILL if needed).
*   **FR1.3 – Restart on Command:** The proxy exposes a tool to restart the child server on demand via a `tools/call` request for `restart_server`.
*   **FR1.4 – Crash Auto-Restart:** If the child process crashes, the proxy automatically attempts to restart it.
*   **FR1.5 – Transparent JSON-RPC Forwarding:** The proxy forwards all JSON-RPC messages, only intercepting messages it must handle (`initialize` handshake, `tools/call` for `restart_server`).
*   **FR1.6 – Optional Config Updates on Restart:** The `restart_server` tool accepts arguments to apply updated environment variables or command-line arguments to the child process.

### FR2: Transparent Capability Forwarding
*   **FR2.1 – Tool Mirroring:** Exposes child server’s tools by augmenting the `ServerCapabilities` during the `initialize` handshake and forwarding subsequent `tools/list` requests.
*   **FR2.2 – Resource Mirroring:** Exposes child resources by forwarding requests like `resources/list` and `resources/read`.
*   **FR2.3 – Prompt Mirroring:** Exposes child prompts by forwarding requests like `prompts/list` and `prompts/get`.
*   **FR2.4 – Additional Restart Tool:** Adds one extra tool, `restart_server`, to the `ServerCapabilities` sent to the client.
*   **FR2.5 – Indistinguishable Behavior:** For any forwarded call, the proxy’s behavior is indistinguishable from the child’s.

### FR3: Dynamic Naming & Versioning
*   **FR3.1 – Proxy Name Suffix:** Presents itself with the child server’s name suffixed by “-dev”.
*   **FR3.2 – Auto-Detect Name/Version:** During the `initialize` handshake, the proxy parses the child server's `serverInfo` from the `InitializeResult` to get the base name and version.
*   **FR3.3 – Version Preservation:** Appends a “-dev” suffix to the child's version (e.g., `2.3.1` becomes `2.3.1-dev`).

### FR4: Configuration & Ease of Use
*   **FR4.1 – Child Command Configuration:** The developer can configure the child server's launch command, arguments, etc., via a config file or CLI parameters.
*   **FR4.2 – Working Directory & Environment:** The configuration allows specifying the child's working directory and environment variables.
*   **FR4.3 – Safe Argument Updates:** The `restart_server` tool can accept a JSON object to update specific, pre-defined placeholder values in the child's configuration for the next run.
*   **FR4.4 – Zero-Config Defaults:** Provide sensible defaults to minimize setup.
*   **FR4.5 – Documentation & Examples:** Comprehensive documentation with examples for wrapping common MCP servers.

## 6. Non-Functional Requirements

### NFR1: Performance
*   **Low Overhead:** Target **<10ms latency overhead** per request.
*   **Memory Footprint:** Target memory usage **<100 MB** for the proxy process.
*   **Restart Time:** Restarting the child server should take **<5 seconds**, plus the child's own initialization time.

### NFR2: Reliability
*   **Robust Crash Handling:** The system must automatically recover from child crashes. If a restart is in progress, the client must wait or receive a standard `JSONRPCError`.
*   **No Message Loss:** In-flight requests at the time of a crash should result in a `JSONRPCError` response to the client, not be silently dropped.
*   **Crash-Loop Protection:** After a configurable number of repeated, immediate crashes (e.g., 3), the proxy will stop auto-restarting and report a fatal error to prevent system flooding.
*   **Graceful Degradation:** If the child cannot be restarted, the proxy will surface a clear error to the client.

### NFR3: Compatibility
*   **Platform:** Primary support for **macOS**. The design should use POSIX process controls to be compatible with Linux.
*   **MCP Compliance:** The proxy must fully comply with the **Model Context Protocol specification version 2025-03-26**. All self-generated messages (tool definitions, notifications, errors) must adhere to the specified JSON-RPC format.
*   **Child Language Agnostic:** The proxy must work with any child server implementation (Node, Python, Swift, etc.), interacting with it solely through the MCP stdio transport.

### NFR4: Developer Experience
*   **Easy Setup:** A developer should be able to wrap their server in under 5 minutes.
*   **Clear Error Messages:** The proxy must output clear, informative error messages to stderr for diagnostics.
*   **Smooth Integration:** The proxy should work seamlessly with tools like the Claude Code CLI and the MCP Inspector UI.

## 7. Technical Architecture

### 7.1 System Components & Data Flow

The architecture consists of the **MCP Client**, the **Proxy Wrapper**, and the **Child MCP Server**, communicating via MCP JSON-RPC messages over stdio.

```
┌──────────────┐     ┌─────────────────────┐     ┌────────────────┐
│  MCP Client  │◄───►│    Proxy Wrapper    │◄───►│  Child Server  │
│(e.g., Claude)│     │   (childName-dev)   │     │   (childName)  │
└──────────────┘     └─────────────────────┘     └────────────────┘
```

*   **Initial Handshake:** The proxy intercepts the `initialize` request from the client. It forwards it to the child, awaits the `InitializeResult`, modifies the `serverInfo` and `capabilities` fields, and sends the modified result back to the client.
*   **Message Forwarding:** For all other messages, the proxy parses the `method`. If it is `tools/call` for `restart_server`, the proxy handles it. Otherwise, the raw JSON-RPC message is relayed to the child, and the child's response is relayed back to the client.
*   **Restart Handling:** When `restart_server` is invoked, the proxy intercepts the request. After restarting the child process, it sends `notifications/tools/list_changed` and potentially `notifications/resources/list_changed` and `notifications/prompts/list_changed` to the client to signal that its capabilities may have changed.

### 7.2 Sequence Flows

#### 7.2.1 Startup Sequence
1.  **Proxy Launch:** The client application launches `mcpdev-proxy`.
2.  **Spawn Child:** The proxy’s Process Manager spawns the child MCP server process.
3.  **Client `initialize`:** The client sends an `initialize` request to the proxy.
4.  **Forward `initialize`:** The proxy forwards the `initialize` request to the child.
5.  **Child `InitializeResult`:** The child returns an `InitializeResult` containing its `serverInfo` and `capabilities`.
6.  **Augment Capabilities:** The proxy intercepts this result. It modifies the `serverInfo` (appending "-dev") and injects the `restart_server` tool definition into the `tools` capability object within the `ServerCapabilities`.
7.  **Return Augmented Result:** The proxy sends the modified `InitializeResult` to the client. The session is now ready.

#### 7.2.2 Restart Operation (via `tools/call`)
1.  **Restart Trigger:** The client sends a `tools/call` request for the `restart_server` tool. The proxy intercepts this request.
2.  **Child Termination:** The proxy sends `SIGTERM` to the child process, waiting a few seconds before sending `SIGKILL` if necessary.
3.  **Spawn New Child:** The proxy starts a fresh child process with the configured (and optionally updated) command and environment.
4.  **Re-establish State:** The proxy performs an internal, lightweight handshake with the new child to get its fresh capabilities (though this is not strictly necessary as the client will re-query).
5.  **Notify Client:** The proxy sends notifications to the client to inform it of the state change:
    *   `{"jsonrpc": "2.0", "method": "notifications/tools/list_changed", "params": {}}`
    *   It may also send `notifications/resources/list_changed` and `notifications/prompts/list_changed` if applicable.
6.  **Respond to Tool Call:** The proxy sends a `CallToolResult` for the `restart_server` request, indicating success. The session continues with the new child process.

#### 7.2.3 Crash Detection & Auto-Restart
1.  **Child Crash:** The proxy’s Process Manager detects that the child process has terminated unexpectedly.
2.  **Automatic Restart:** The Process Manager initiates a restart sequence automatically (stop/cleanup any remnants, then spawn new child).
3.  **Crash Loop Handling:** If the child crashes immediately upon restart, the proxy will retry a configured number of times (e.g., 3). If it continues to fail, the proxy ceases retries and logs a fatal error.
4.  **Notify Client:** Upon successful restart, the proxy sends the same `...list_changed` notifications as in a manual restart, prompting the client to refresh its understanding of the server's capabilities.

### 7.3 Detailed Design

#### `restart_server` Tool Definition
The proxy will define the `restart_server` tool with a proper JSON schema for its inputs, as per the MCP specification.

```json
{
  "name": "restart_server",
  "description": "Restarts the underlying MCP server process. Can be used to apply code changes or update configuration.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "configUpdate": {
        "type": "object",
        "description": "Optional key-value pairs to update in the server's environment for the next run.",
        "additionalProperties": { "type": "string" }
      }
    },
    "required": []
  }
}
```

#### Error Handling
When the proxy must generate an error, it will construct a valid `JSONRPCError` object. For example, if a request is received while the child is crashed and before it has been restarted:

```json
{
  "jsonrpc": "2.0",
  "id": 123,
  "error": {
    "code": -32603,
    "message": "Internal error: Child process is currently unavailable. An automatic restart is in progress."
  }
}
```

## 8. Deployment and Usage Plan

### 8.1 Packaging
The proxy will be packaged as a command-line tool and published to **npm**, installable via `npm install -g mcpdev-proxy` or runnable with `npx`.

### 8.2 Usage
Developers will wrap their server by prefixing its launch command with the proxy's command.

**Example:**
If the normal server command is:
`node /path/to/my-mcp-server.js`

The wrapped command becomes:
`mcpdev-proxy --child-cmd "node /path/to/my-mcp-server.js"`

This command would then be provided to the MCP client (e.g., in the Claude Code CLI settings).