# Architecture

## Overview

CircuitForge is a conversational AI agent that designs electronic circuits from natural language. Users describe what they want, and the agent reasons like a senior electronics engineer — selecting real parts, generating tscircuit code, and producing manufacturable outputs.

## Milestone Update (2026-02-16)

- Parallelized compile/validation pipeline: speculative compilation overlaps with LLM stream, post-compile KiCad analyses (connectivity, ERC, BOM) run concurrently via `Promise.all`.
- Sandbox pool for warm instance reuse across compile attempts within a session.
- SSE heartbeat (15s `ping` keepalive) prevents proxy/CDN timeouts on long-running requests.
- Abort signal propagation: client disconnect triggers early exit from retry loop and compile fetches.
- Fetch timeouts (`AbortSignal.timeout(30s)`) on compile API calls to prevent indefinite hangs.
- SDK lifecycle fix: `AbortController` passed to SDK `query()`, explicit `agentQuery.close?.()` in `finally` block, and bounded enqueue checks for SSE hook events.
- Error boundaries (`ErrorBoundary` component) wrap all top-level panels to prevent white-screen crashes.
- Deterministic repair routing classifies diagnostics as `auto_fixable`, `should_demote`, or `must_repair`, then emits machine-readable repair evidence for each attempt.
- Live smoke now uses fixture-backed prompt sets and includes a dedicated `PIN_CONFLICT_WARNING` probe path.
- 15.4% latency reduction measured on live API integration test (single-attempt baseline).

## Milestone Update (2026-02-13)

- Added first-class 5-phase flow with explicit checkpoint events (`requirements`, `architecture`, `implementation`, `review`, `export`) and progress emissions.
- Integrated KiCad validation as a post-generation ground truth layer using `circuit-json-to-kicad` and `kicad-sch-ts`, including connectivity and electrical rule findings.
- Added KiCad edit pathway so targeted schematic edits (`manage_component`, `manage_wire`) can be applied after generation and re-validated through the same loop.
- Expanded export and validation contracts to support KiCad review artifacts (`kicad_sch`, `kicad_report.json`, `connectivity.json`) via `formatSet`.
- Migrated UI presentation to AI SDK Elements surfaces with a split-screen workflow:
  - `Conversation` + `PromptInput` for interactive input and suggestion strips
  - `Reasoning` + `ChainOfThought` + `Tool` surfaces for streaming reasoning and tool execution visibility
  - `Artifact` + `WebPreview` for preview and export actions
  - `Canvas` + `Node` + `Edge` architecture graph rendering (with textual fallback)

## System Diagram

```
Browser (Next.js)
├── Chat Panel (AI Elements)
│   ├── Conversation → messages + initial suggestion chips
│   ├── PromptInput → submit/stop and streaming mode
│   ├── Reasoning + ChainOfThought strips for stream phase + thought logs
│   └── Tool card stream within chat
├── Circuit Panel (Artifact)
│   ├── Artifact header actions (copy/export)
│   └── Live RunFrame preview in WebPreview wrapper
└── Info Panel (AI-native)
    ├── Workflow strip + reasoning telemetry
    ├── Tool card log
    ├── Requirements + architecture graph
    ├── Review findings with accept/dismiss actions
    └── Optional gate confirmation prompts (fallback UX)
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
    ├── Phase state machine (requirements → architecture → implementation → review → export)
    ├── Checkpoint events (`phase_entered`, `phase_progress`, `phase_block_done`)
    ├── Preventive routing guardrails (trace/via spacing hints)
    ├── Rolling error memory (in-memory fallback + Convex persistence)
    ├── Attempt orchestration (max retries + stagnation stop)
    ├── Speculative compilation (overlap with LLM stream)
    ├── Compile validation (compile.tscircuit.com)
    ├── Fetch timeouts (30s AbortSignal.timeout on compile API)
    ├── Parallel post-compile: KiCad analysis + tscircuit diagnostics via Promise.all
    ├── Parallel KiCad analyses: connectivity, ERC, BOM concurrently
    ├── PCB diagnostic extraction (`*_error` entries)
    ├── KiCad-backed review diagnostics (`lib/kicad/*`)
    ├── Review finding events (`review_finding`, `review_decision`)
    ├── Retry prompt injection with structured diagnostics
    ├── SSE heartbeat (15s ping keepalive)
    └── Abort signal propagation (client disconnect → early exit)

    KiCad validation/export path
    ├── POST /api/kicad/validate
    │   ├── accepts `tscircuit_code` or `circuit_json`
    │   └── returns kicad_sch, findings, connectivity, traceability
    ├── POST /api/export
    │   ├── `formatSet.kicad`: include kicad_sch
    │   └── `formatSet.reviewBundle`: include kicad_report.json + connectivity.json
    ├── POST /api/manufacturing/jlcpcb-link (v1 stub payload)

    Optional Isolated Execution
    └── Vercel Sandbox SDK (@vercel/sandbox)
        ├── Sandbox pool (warm instance reuse across attempts)
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
| `app/api/kicad/` | KiCad validation endpoint |
| `app/api/manufacturing/` | Manufacturing connector payload route |
| `app/api/sandbox/quickstart/` | Sandbox smoke-test endpoint (create VM, run command, teardown) |
| `components/` | React UI components |
| `convex/` | Convex schema + HTTP actions for persistent error memory |
| `lib/agent/` | Agent config, prompts, code extraction, repair loop utilities |
| `lib/kicad/` | KiCad bridge + converter + review helpers |
| `lib/sandbox/` | Vercel Sandbox helpers for isolated execution |
| `lib/stream/` | SSE event parsing and state management |
| `public/` | Static assets |

## Data Flow

1. User sends prompt → POST /api/agent
2. Backend emits phase checkpoints for `requirements/architecture/implementation/review/export`
3. Backend runs agent attempt #N, captures generated `tsx` code
4. Backend validates generated code via compile API (sandbox-first, inline fallback)
4b. Speculative compile fires as soon as first code block is detected in the LLM stream, overlapping compilation with remaining generation
5. Backend normalizes diagnostics from `circuit_json` entries and KiCad findings (run in parallel) and decides retry/stop
7. Failed attempts are recorded in rolling error memory (in-memory and optional Convex persistence)
8. On retries, backend injects structured diagnostics + adaptive guardrails into the next repair prompt
9. SSE emits telemetry (`retry_start`, `validation_errors`, `retry_result`) and final assistant text
10. Frontend derives retry summary stats (attempt count, first error type, category counts, final status) from SSE events
11. Frontend parses SSE into split panels: chat (code blocks replaced with placeholder), artifact preview (RunFrame), and workflow (phase/tool/requirements/review)
12. Frontend derives `phaseSteps` and `gateEvents` from stream events to drive chain-of-thought state and approval prompts without changing backend SSE contract
13. RunFrame renders live schematic/PCB/3D preview in iframe via Artifact/WebPreview composition
13. Export: client compiles via compile.tscircuit.com → server validates/converts to zip (+ optional KiCad bundle)
14. Optional KiCad validation: `/api/kicad/validate` returns schema, findings, and connectivity metadata
15. Sandbox setup validation: `/api/sandbox/quickstart` creates a microVM, executes a command, then tears down

## Workflow Baseline Audit (2026-02-16)

### Runtime workflow (source of truth)

1. UI sends prompt from `app/page.tsx` via `lib/stream/useAgentStream.ts`.
2. `/api/agent` (`app/api/agent/route.ts`) restores or creates session context.
3. Route emits phase/checkpoint stream events (`phase_entered`, `phase_progress`, gate/review events).
4. Agent attempt runs through Claude Agent SDK hooks (`tool_*`, `subagent_*`) and streams text/thinking.
5. Implementation/review/export phases run compile+validation loop with retries.
6. Final stream emits code/text plus machine-readable evidence (`iteration_diff`, `final_summary`, `timing_metric`, `done`).

### Event contract extensions

- Added `iteration_diff` for structural deltas between baseline and current generated code.
- Added `final_summary` for readiness evidence (intent, constraints, blockers, readiness score).
- Added `timing_metric` for stage durations (guardrails fetch, agent attempt, compile/validate).
- Added `repair_plan` and `repair_result` events for deterministic repair visibility.
- Frontend now stores and renders these in `InfoPanel` and `CircuitPanel`.

### Parallelization currently in use

- KiCad + tscircuit diagnostics run in parallel in `lib/agent/repairLoop.ts` (`Promise.all`).
- KiCad schema analyses (connectivity/ERC/BOM) run in parallel in `lib/kicad/review.ts` (`Promise.all`).
- Guardrail fetch starts early and is awaited later in `/api/agent`.
- Speculative compile starts during token streaming and can be reused if final code matches.

### Reliability controls now in place

- Session context persistence with file-backed cache + TTL/LRU eviction: `lib/agent/sessionMemory.ts`.
- Per-session single-flight orchestration in `/api/agent` (new request aborts prior run for same session).
- Abort propagation from request through agent attempts and compile path.
- Per-attempt timeout for retry loop, plus timeout-aware error emission.
- Retry stop policy tuned for meaningful improvement threshold and repeated-signature detection.
- Compile and Convex memory calls now use bounded retry/backoff.
- Convergence policy is blocker-first: implementation/review retries focus on blocking diagnostics, warnings become advisory, and gate pass can occur with advisory warnings present.
- Timeout handling is non-terminal: timed out attempts emit `attempt_timeout` diagnostics and continue through retry loop instead of immediately failing the stream.
- Abort-like SDK messages (for example, "aborted by user") are normalized into the same timeout-like retry flow.

## Conventions

- All server-side code uses Node runtime (not Edge) for Agent SDK compatibility
- SSE events use newline-delimited JSON: `data: {"type": "...", ...}\n\n`
- Model aliases centralized in `lib/agent/models.ts`
- Primary app flow remains stateless per request; optional Convex persistence stores retry error-memory aggregates
- SDK query lifecycle managed via `AbortController` + explicit `close?.()` to prevent ProcessTransport race
- Live smoke prompt selection is fixture-backed (`__tests__/fixtures/live-smoke-prompts.json`) with fail-fast validation
- `ErrorBoundary` wraps all top-level panels (`ChatPanel`, `CircuitPanel`, `InfoPanel`)
