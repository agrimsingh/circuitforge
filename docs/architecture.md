# Architecture

## Overview

CircuitForge is a conversational AI agent that designs electronic circuits from natural language. Users describe what they want, and the agent reasons like a senior electronics engineer — selecting real parts, generating tscircuit code, and producing manufacturable outputs.

## System Diagram

```
Browser (Next.js)
├── Chat Panel           → streams assistant text (code blocks stripped)
├── Circuit Panel        → Live Preview only (RunFrame iframe)
└── Info Panel (tabbed)  → Activity log + Tool call details + retry telemetry summary
         │
    POST /api/agent (SSE) + POST /api/sandbox/quickstart
         │
    Next.js Route Handler (Node runtime)
         │
    Claude Agent SDK (adaptive thinking enabled)
    ├── Main Agent (Orchestrator) — claude-opus-4-6
    │   ├── Subagent: Parts Scout — claude-haiku-4-5
    │   ├── Subagent: Code Writer — claude-sonnet-4-5
    │   └── Subagent: Validator — claude-opus-4-6
    ├── MCP Tool: jlcsearch (in-process)
    ├── Hooks: PreToolUse, PostToolUse, SubagentStart/Stop
    └── Built-in Tools: WebFetch, WebSearch

    Self-correction loop
    ├── Preventive routing guardrails (trace/via spacing hints)
    ├── Rolling error memory (in-memory fallback + Convex persistence)
    ├── Attempt orchestration (max retries + stagnation stop)
    ├── Compile validation (compile.tscircuit.com)
    ├── PCB diagnostic extraction (`*_error` entries)
    └── Retry prompt injection with structured diagnostics

    Optional Isolated Execution
    └── Vercel Sandbox SDK (@vercel/sandbox)
        └── Ephemeral microVM for compile validation fallback
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| LLM | Anthropic Claude Agent SDK |
| Circuit Engine | tscircuit (RunFrame, @tscircuit/eval) |
| Parts Search | jlcsearch.tscircuit.com API |
| Export | circuit-json-to-gerber, circuit-json-to-bom-csv, circuit-json-to-pnp-csv |
| Deployment | Vercel |

## Key Directories

| Path | Purpose |
|------|---------|
| `app/` | Next.js App Router pages and API routes |
| `app/api/agent/` | SSE streaming endpoint + self-correction retry loop |
| `app/api/export/` | Manufacturing export (BOM/Gerbers/PNP → zip) |
| `app/api/sandbox/quickstart/` | Sandbox smoke-test endpoint (create VM, run command, teardown) |
| `components/` | React UI components |
| `convex/` | Convex schema + HTTP actions for persistent error memory |
| `lib/agent/` | Agent config, prompts, code extraction, repair loop utilities |
| `lib/export/` | Circuit JSON conversion utilities |
| `lib/sandbox/` | Vercel Sandbox helpers for isolated execution |
| `lib/stream/` | SSE event parsing and state management |
| `public/` | Static assets |

## Data Flow

1. User sends prompt → POST /api/agent
2. Backend runs agent attempt #N, captures generated `tsx` code
3. Backend validates generated code via compile API (sandbox-first, inline fallback)
4. Backend normalizes diagnostics from `circuit_json` error entries and decides retry/stop
5. Failed attempts are recorded in rolling error memory (in-memory and optional Convex persistence)
6. On retries, backend injects structured diagnostics + adaptive guardrails into the next repair prompt
7. SSE emits telemetry (`retry_start`, `validation_errors`, `retry_result`) and final assistant text
8. Frontend derives retry summary stats (attempt count, first error type, category counts, final status) from SSE events
9. Frontend parses SSE into 3 panels: chat (code blocks replaced with placeholder), preview (RunFrame), activity+tools (tabbed)
10. RunFrame renders live schematic/PCB/3D preview in iframe
11. Export: client compiles via compile.tscircuit.com → server converts to zip
12. Sandbox setup validation: `/api/sandbox/quickstart` creates a microVM, executes a command, then tears down

## Conventions

- All server-side code uses Node runtime (not Edge) for Agent SDK compatibility
- SSE events use newline-delimited JSON: `data: {"type": "...", ...}\n\n`
- Model aliases centralized in `lib/agent/models.ts`
- Primary app flow remains stateless per request; optional Convex persistence stores retry error-memory aggregates
