# Agent Backend Spec

## Overview
The agent backend runs the Anthropic Claude Agent SDK inside a Next.js Route Handler, streaming events to the frontend via SSE.

## Architecture
- **Endpoint**: `POST /api/agent`
- **Runtime**: Node.js (not Edge — Agent SDK requires it)
- **Response**: SSE stream (`text/event-stream`)
- **Session**: Ephemeral per request (no persistence)

## Agent Configuration

### Main Agent (Orchestrator)
- **Model**: claude-opus-4-6
- **System prompt**: Electronics engineer persona with tscircuit expertise
- **Tools**: WebFetch, WebSearch, Task (for subagents), custom jlcsearch MCP tool
- **Permission mode**: `bypassPermissions` (server-controlled, no interactive prompts)

### Subagents
| Name | Model | Role | Tools |
|------|-------|------|-------|
| parts-scout | claude-haiku-4-5 | Search jlcsearch for components | jlcsearch MCP tool |
| code-writer | claude-sonnet-4-5 | Generate tscircuit JSX code | None (returns text) |
| validator | claude-opus-4-6 | Check electrical constraints | None (returns text) |

### Custom MCP Tool: jlcsearch
- In-process MCP server via `createSdkMcpServer`
- Tool: `search_parts` — wraps `GET https://jlcsearch.tscircuit.com/api/search`
- Parameters: `q` (query string), `limit` (max results, default 10), `package` (optional filter)
- Returns: Array of `{ lcsc, mfr, package, description, stock, price }`

### Hooks
| Hook | Event | Purpose |
|------|-------|---------|
| PreToolUse | Before any tool | Emit tool-start event to SSE |
| PostToolUse | After any tool | Emit tool-result event to SSE |
| SubagentStart | Subagent spawned | Emit subagent-start event |
| SubagentStop | Subagent finished | Emit subagent-stop event |

## SSE Event Protocol
Each SSE event is `data: <JSON>\n\n` with the following types:

```json
{ "type": "text", "content": "..." }
{ "type": "thinking", "content": "..." }
{ "type": "code", "file": "main.tsx", "content": "..." }
{ "type": "tool_start", "tool": "search_parts", "input": {...} }
{ "type": "tool_result", "tool": "search_parts", "output": {...} }
{ "type": "subagent_start", "agent": "parts-scout" }
{ "type": "subagent_stop", "agent": "parts-scout" }
{ "type": "error", "message": "..." }
{ "type": "done", "usage": {...} }
```

## Error Handling
- Missing ANTHROPIC_API_KEY → 500 with clear message
- Agent SDK errors → streamed as `{ "type": "error" }` events
- Request timeout → 300s max (Vercel Pro plan)

## Important: Environment Variables
The SDK's `env` option **replaces** `process.env` for the spawned subprocess — it does not merge. The route must pass the full environment:
```ts
env: { ...process.env, ANTHROPIC_API_KEY: apiKey }
```
Passing only `{ ANTHROPIC_API_KEY: apiKey }` strips PATH, causing `spawn node ENOENT`.

## Design Decisions
- **Why ephemeral sessions**: Simplicity for MVP. Multi-turn is handled by sending previous code as context.
- **Why bypassPermissions**: Server-controlled agent with no interactive user. All tools are safe (read-only + jlcsearch).
- **Why in-process MCP**: Avoids stdio subprocess overhead on Vercel serverless.
- **Why SDK tests run outside vitest**: The Agent SDK spawns subprocesses via `child_process.spawn()`. Vitest uses worker threads which cannot manage grandchild processes. Live SDK tests run as standalone scripts via `tsx`.
