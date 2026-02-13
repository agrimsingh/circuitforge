# Agent Backend Spec

## Overview
The agent backend runs the Anthropic Claude Agent SDK inside a Next.js Route Handler, streaming events to the frontend via SSE.

## Architecture
- **Endpoint**: `POST /api/agent`
- **Runtime**: Node.js (not Edge — Agent SDK requires it)
- **Response**: SSE stream (`text/event-stream`)
- **Session**: Ephemeral per request
- **Learning memory**: In-memory fallback plus optional Convex persistence for recurring failure categories

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
| code-writer | claude-sonnet-4-5 | Generate tscircuit JSX code with DRC guardrails | WebFetch |
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

## Self-Correction Loop

The backend does not trust a single generation. It runs a bounded repair loop:

1. Run orchestrator attempt.
2. Extract `tsx` code block from assistant text.
3. Validate via compile API:
   - sandbox-first (`@vercel/sandbox`)
   - inline compile fallback when sandbox unavailable
4. Parse `circuit_json` diagnostics (`*_error` entries).
5. Score + signature diagnostics to detect convergence/stagnation.
6. Retry with structured diagnostics and targeted fix hints (`pcb_trace_error`, `pcb_via_clearance_error`) until:
   - clean
   - max attempts
   - stagnation/no improvement
7. Return best attempt with diagnostics note if unresolved.

## SSE Event Protocol
Each SSE event is `data: <JSON>\n\n` with the following types:

```json
{ "type": "text", "content": "..." }
{ "type": "thinking", "content": "..." }
{ "type": "tool_start", "tool": "search_parts", "input": {...} }
{ "type": "tool_result", "tool": "search_parts", "output": {...} }
{ "type": "subagent_start", "agent": "parts-scout" }
{ "type": "subagent_stop", "agent": "parts-scout" }
{ "type": "retry_start", "attempt": 1, "maxAttempts": 3 }
{ "type": "validation_errors", "attempt": 1, "diagnostics": [...] }
{ "type": "retry_result", "attempt": 1, "status": "retrying|clean|failed", "diagnosticsCount": 1, "score": 500 }
{ "type": "error", "message": "..." }
{ "type": "done", "usage": {...} }
```

## Adaptive Error Memory

The backend records failed-attempt categories and reuses them as adaptive guardrails.

- **Primary**: Convex HTTP actions (`/error-memory/record`, `/error-memory/guardrails`)
- **Fallback**: in-memory rolling samples in-process
- **Category examples**: `pcb_trace_error`, `pcb_via_clearance_error`, `compile_error`
- **Prompt impact**: common categories are promoted into pre-generation guardrail instructions

## Error Handling
- Missing ANTHROPIC_API_KEY → 500 with clear message
- Agent SDK errors → streamed as `{ "type": "error" }` events
- Request timeout → 300s max (Vercel Pro plan)
- Convex unavailable or misconfigured → non-fatal fallback to in-memory memory

## Important: Environment Variables
The SDK's `env` option **replaces** `process.env` for the spawned subprocess — it does not merge. The route must pass the full environment:
```ts
env: { ...process.env, ANTHROPIC_API_KEY: apiKey }
```
Passing only `{ ANTHROPIC_API_KEY: apiKey }` strips PATH, causing `spawn node ENOENT`.

### Optional persistence vars
- `CONVEX_SITE_URL` or `NEXT_PUBLIC_CONVEX_SITE_URL`
- `CIRCUITFORGE_CONVEX_SHARED_SECRET`

## Design Decisions
- **Why bounded retry loop**: Better deterministic repair behavior than one-shot generation.
- **Why adaptive memory by category (not raw code)**: Better privacy and lower storage/token costs.
- **Why optional Convex**: Persist learning across restarts/deploys without making main flow hard-dependent.
- **Why bypassPermissions**: Server-controlled agent with no interactive user. All tools are safe (read-only + jlcsearch).
- **Why in-process MCP**: Avoids stdio subprocess overhead on Vercel serverless.
- **Why SDK tests run outside vitest**: The Agent SDK spawns subprocesses via `child_process.spawn()`. Vitest uses worker threads which cannot manage grandchild processes. Live SDK tests run as standalone scripts via `tsx`.
