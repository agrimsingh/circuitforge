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
| code-writer | claude-opus-4-6 (default; `CIRCUITFORGE_CODEGEN_MODEL=sonnet` for Sonnet) | Generate tscircuit JSX code with DRC guardrails | WebFetch |
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

1. Run orchestrator attempt (with periodic status pulse heartbeats for long runs).
2. Extract `tsx` code block from assistant text.
3. Apply source code guardrails (normalize invalid net names like `3V3 → V3V3`, strip malformed traces, dedupe net declarations).
4. Run semantic connectivity preflight (`lib/agent/connectivityPreflight.ts`) to validate trace endpoints, selector syntax, component existence, and pin references.
5. Validate via compile (bounded by `CIRCUITFORGE_COMPILE_VALIDATE_TIMEOUT_MS`, default 240s):
   - local-first (`@tscircuit/eval` CircuitRunner, no external timeout)
   - remote `compile.tscircuit.com` API fallback on unexpected local error
   - Timeout errors become `compile_validate_timeout` diagnostics (non-terminal)
6. Parse `circuit_json` diagnostics (`*_error` entries) + board-fit validation (`pcb_component_out_of_bounds_error`).
7. Score + signature diagnostics to detect convergence/stagnation.
8. On stuck loops (same dominant family or no blocking reduction), auto-switch to structural repair strategy via escalation ladder:
   - `targeted_congestion_relief`: constrained board growth + bounded component nudges (N passes before escalation)
   - `structural_trace_rebuild`: discard legacy traces, rebuild from net-intent pairs
   - `structural_layout_spread`: expand board dimensions and scale PCB coordinates (escalation target from congestion relief)
9. Retry with structured diagnostics, targeted fix hints, and retrieval-augmented tscircuit reference snippets until:
   - clean
   - max attempts (`CIRCUITFORGE_MAX_REPAIR_ATTEMPTS`, default 6)
   - stagnation/no improvement (`CIRCUITFORGE_RETRY_STAGNATION_LIMIT`)
   - repeated signature (`CIRCUITFORGE_SIGNATURE_REPEAT_LIMIT`)
   - autorouter exhaustion (`CIRCUITFORGE_AUTOROUTER_STALL_LIMIT`)
   - structural repair budget exhausted (`CIRCUITFORGE_MAX_STRUCTURAL_REPAIR_ATTEMPTS`)
10. Review findings emitted **after** deterministic fixes so auto-fixed issues are excluded.
11. Return best attempt with `buildPostValidationSummary()` appended (blocking count, auto-fix count, actionable/low-signal advisory breakdown, readiness score).

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
{ "type": "retry_result", "attempt": 1, "status": "retrying|clean|failed", "diagnosticsCount": 1, "score": 500, "reason": "max_attempts|stagnant_signature|no_improvement|autorouter_exhaustion|structural_repair_exhausted" }
{ "type": "repair_plan", "plan": { "strategy": "normal|targeted_congestion_relief|structural_trace_rebuild|structural_layout_spread", ... } }
{ "type": "repair_result", "result": { "appliedActions": [...], "strategy": "normal", ... } }
{ "type": "error", "message": "..." }
{ "type": "final_summary", "summary": { "blockingDiagnosticsCount": 0, "warningDiagnosticsCount": 1, "actionableWarningCount": 1, "lowSignalWarningCount": 0, "manufacturingReadinessScore": 85 } }
{ "type": "done", "usage": {...} }
```

Note: The `tool_start` event for `TodoWrite` is intercepted client-side to extract `TodoItem[]` and render an in-chat task queue.

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

### Repair runtime configuration vars
- `CIRCUITFORGE_COMPILE_VALIDATE_TIMEOUT_MS` (default 240000)
- `CIRCUITFORGE_MAX_REPAIR_ATTEMPTS` (default 6 non-test, 3 test)
- `CIRCUITFORGE_RETRY_STAGNATION_LIMIT` (default 4 non-test, 3 test)
- `CIRCUITFORGE_SIGNATURE_REPEAT_LIMIT` (default 3 non-test, 2 test)
- `CIRCUITFORGE_AUTOROUTER_STALL_LIMIT` (default 4 non-test, 2 test)
- `CIRCUITFORGE_STRUCTURAL_REPAIR_TRIGGER` (default 2)
- `CIRCUITFORGE_MAX_STRUCTURAL_REPAIR_ATTEMPTS` (default 3 non-test, 1 test)
- `CIRCUITFORGE_STATUS_PULSE_MS` (default 8000)
- `CIRCUITFORGE_ENABLE_CONNECTIVITY_PREFLIGHT` (default true)
- `CIRCUITFORGE_ENABLE_STRUCTURAL_REPAIR_MODE` (default true)
- `CIRCUITFORGE_MINOR_BOARD_GROWTH_CAP_PCT` (default 20)
- `CIRCUITFORGE_MINOR_COMPONENT_SHIFT_MM` (default 3)
- `CIRCUITFORGE_MINOR_RELIEF_PASSES` (default 2)
- `CIRCUITFORGE_USE_TSCIRCUIT_AI_REFERENCE` (default true)

## Design Decisions
- **Why bounded retry loop**: Better deterministic repair behavior than one-shot generation.
- **Why adaptive memory by category (not raw code)**: Better privacy and lower storage/token costs.
- **Why optional Convex**: Persist learning across restarts/deploys without making main flow hard-dependent.
- **Why bypassPermissions**: Server-controlled agent with no interactive user. All tools are safe (read-only + jlcsearch).
- **Why in-process MCP**: Avoids stdio subprocess overhead on Vercel serverless.
- **Why SDK tests run outside vitest**: The Agent SDK spawns subprocesses via `child_process.spawn()`. Vitest uses worker threads which cannot manage grandchild processes. Live SDK tests run as standalone scripts via `tsx`.
