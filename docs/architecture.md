# Architecture

## Overview

CircuitForge is a conversational AI agent that designs electronic circuits from natural language. Users describe what they want, and the agent reasons like a senior electronics engineer — selecting real parts, generating tscircuit code, and producing manufacturable outputs.

## System Diagram

```
Browser (Next.js)
├── Chat Panel          → streams assistant text
├── Thinking Panel      → streams reasoning / thinking blocks
├── Tool Activity Panel → streams tool calls + subagent events
└── Circuit Panel       → Code tab + Live Preview (RunFrame)
         │
    POST /api/agent (SSE)
         │
    Next.js Route Handler (Node runtime)
         │
    Claude Agent SDK
    ├── Main Agent (Orchestrator) — claude-opus-4-6
    │   ├── Subagent: Parts Scout — claude-haiku-4-5
    │   ├── Subagent: Code Writer — claude-sonnet-4-5
    │   └── Subagent: Validator — claude-opus-4-6
    ├── MCP Tool: jlcsearch (in-process)
    ├── Hooks: PreToolUse, PostToolUse, SubagentStart/Stop
    └── Built-in Tools: WebFetch, WebSearch
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router) |
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
| `app/api/agent/` | SSE streaming endpoint for Agent SDK |
| `app/api/export/` | Manufacturing export (BOM/Gerbers/PNP → zip) |
| `components/` | React UI components |
| `lib/agent/` | Agent configuration, prompts, tools, models |
| `lib/export/` | Circuit JSON conversion utilities |
| `lib/stream/` | SSE event parsing and state management |
| `public/` | Static assets |

## Data Flow

1. User sends prompt → POST /api/agent
2. Agent SDK streams SSE events (text, tool calls, subagent activity)
3. Frontend parses SSE into 4 panels (chat, thinking, tools, code)
4. When code is emitted, RunFrame renders live schematic/PCB/3D preview
5. Export: client compiles via compile.tscircuit.com → server converts to zip

## Conventions

- All server-side code uses Node runtime (not Edge) for Agent SDK compatibility
- SSE events use newline-delimited JSON: `data: {"type": "...", ...}\n\n`
- Model aliases centralized in `lib/agent/models.ts`
- No database — sessions are ephemeral per request
