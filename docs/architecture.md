# Architecture

## Overview

CircuitForge is a conversational AI agent that designs electronic circuits from natural language. Users describe what they want, and the agent reasons like a senior electronics engineer — selecting real parts, generating tscircuit code, and producing manufacturable outputs.

## Milestone Update (2026-02-17)

- **Device-specific architecture synthesis**: Added low-cost Haiku architecture pass (`lib/agent/architecture.ts`) that emits structured block semantics (role, criticality, inputs/outputs/interfaces, constraints, failure modes) and explicit inter-block connections. If JSON parse/validation fails, backend falls back to deterministic heuristic scaffolding in `architectureFromRequirements()`.
- **Self-hosted tscircuit compiler**: Replaced external `compile.tscircuit.com` API and Vercel Sandbox compile pool with local `@tscircuit/eval` `CircuitRunner`. No more 90-second external timeout. Compilation runs in-process with no hard limit. Remote API retained as automatic fallback. `lib/compile/local.ts` now powers both `/api/compile` and direct `/api/export` `tscircuit_code` requests.
- `.pnpmfile.cjs` hook ensures tscircuit ecosystem packages receive `zod@3` while `@anthropic-ai/claude-agent-sdk` keeps `zod@4`.
- Post-validation summary: `buildPostValidationSummary()` appends a human-readable text block to the final agent message with blocking count, auto-fix count, warnings, readiness score, and next-step guidance.
- Review findings now emitted **after** deterministic fixes so auto-fixed issues are excluded from the findings stream.
- Review finding lifecycle sync: server now emits `review_decision` dismissal events when previously-open findings disappear in later attempts, and client upserts preserve prior accepted/dismissed state.
- Chat now includes a rolling in-thread progress narration message (phase/retry/repair/gate/summary) so users see state + next steps without relying only on chain-of-thought UI.
- Stream completion now appends a deterministic assistant recap message (phase/readiness/diagnostics/auto-fix totals/next prompts), and chain-of-thought auto-collapses once streaming ends.
- Live status narration now stays pinned to the bottom of chat during a run (it is re-appended on each update), and status/recap copy uses markdown sections for scan-friendly formatting.
- Agent todo queue: frontend intercepts `TodoWrite` tool_start events, merges todo items into stream state (`TodoItem[]`), and renders a collapsible `TodoQueue` component in chat with spinning/done indicators.
- New `components/ai-elements/queue.tsx` Queue primitive library (Queue, QueueItem, QueueList, QueueSection, etc.) built on Radix Collapsible + ScrollArea.
- Export readiness check uses `blockingDiagnosticsCount === 0` instead of `diagnosticsCount === 0` (advisory warnings no longer gate export).
- Code-writer now defaults to Opus quality tier with env override (`CIRCUITFORGE_CODEGEN_MODEL=sonnet`) for speed/cost. Model roster: `CODEGEN` (Opus), `CODEGEN_FAST` (Sonnet), `CODEGEN_STRONG` (Opus).
- Added pre-compile structural preflight diagnostics (invalid/missing footprint, unresolved trace selectors, missing chip pin labels) to fail fast before expensive compile/autoroute loops.
- Added source guardrail normalization before compile/validation: invalid net names are normalized (e.g. `3V3 -> V3V3`) and malformed self-closing `<trace />` statements without valid endpoints are stripped.
- Added low-signal pin-conflict demotion path for noisy ERC strings like `unspecified connected to unspecified`, while keeping high-signal pin conflicts as must-repair.
- Retry loop now early-stops on repeated `pcb_autorouter_exhaustion` instead of consuming all remaining attempts/time budget.
- Chat timeline now suppresses internal `Bash` tool rows and SDK `Explore` subagent noise to keep repair telemetry readable.
- Retry prompt generation now uses retrieval-augmented guidance from `https://docs.tscircuit.com/ai.txt` via a cached, diagnostic-targeted snippet extractor (`lib/agent/tscircuitReference.ts`) so large reference text is not injected wholesale.
- Added semantic connectivity preflight (`lib/agent/connectivityPreflight.ts`) that validates trace endpoint presence/selector shape/component/pin references and emits canonical `source_trace_*` diagnostics before compile.
- Added deterministic stuck-loop breaker in retry orchestration: strategy state (`normal`, `targeted_congestion_relief`, `structural_trace_rebuild`, `structural_layout_spread`) auto-switches after repeated dominant-family/no-reduction streaks using env-driven thresholds.
- Structural trace mode removes legacy traces and rebuilds from safe net-intent pairs; structural layout mode expands board dimensions and scales PCB coordinates to reduce routing congestion.
- **Targeted congestion relief**: New intermediate repair strategy (`targeted_congestion_relief`) applies constrained board growth and bounded component nudges before escalating to full structural layout spread. Tunable via `CIRCUITFORGE_MINOR_BOARD_GROWTH_CAP_PCT` (default 20%), `CIRCUITFORGE_MINOR_COMPONENT_SHIFT_MM` (default 3mm), and `CIRCUITFORGE_MINOR_RELIEF_PASSES` (default 2). Escalation ladder: normal → targeted_congestion_relief (N passes) → structural_layout_spread.
- Final failed-run text now groups repeated diagnostics by category/message (`[category] xN`) and includes explicit stop reason (`max_attempts`, `stagnant_signature`, `no_improvement`, `autorouter_exhaustion`, `structural_repair_exhausted`).
- **Configurable repair runtime**: All retry budget knobs (max attempts, stagnation limit, signature repeat limit, autorouter stall limit, structural repair budget, status pulse interval) are now extracted into `RepairRuntimeConfig` driven by environment variables, with separate test vs runtime defaults.
- **Per-attempt compile/validate timeout**: Each compile+validation pass is bounded by `CIRCUITFORGE_COMPILE_VALIDATE_TIMEOUT_MS` (default 240s). Timeout errors are non-terminal — they become `compile_validate_timeout` diagnostics and the retry loop continues.
- **Advisory signal splitting**: Readiness scoring and final summaries now split advisory diagnostics into actionable vs low-signal buckets; low-signal advisories (BOM metadata, power-symbol duplicate refs, `unspecified connected to unspecified` pin conflicts) receive reduced scoring weight.
- **Status pulse heartbeats**: Long-running agent generation and compile/validation steps now emit periodic `phase_progress` pulses so the UI does not appear stalled during multi-minute operations.
- **Board-fit blocking diagnostic**: `pcb_component_out_of_bounds_error` emitted when any `pcb_component` body exceeds `pcb_board` bounds; wired into must-repair classification and structural layout-spread recovery.
- **ArchitecturePanel enhancements**: Nodes now render role/criticality pills with color-coded styles, and display I/O and interface summaries from enriched `ArchitectureNode` semantics.
- **InfoPanel fix-all action**: Review trigger repairs all open findings (prioritizing blockers) instead of only critical severity, so rerun automation is always available.
- **Volatile diagnostic stability**: Review finding IDs for UUID-bearing diagnostics (e.g. duplicate references) are normalized to stable keys, preventing ghost finding churn across attempts.

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
│   ├── Tool card stream within chat
│   └── TodoQueue → collapsible task list from agent TodoWrite events
├── Circuit Panel (Artifact)
│   ├── Artifact header actions (copy/export)
│   └── Live RunFrame preview in WebPreview wrapper
└── Info Panel (AI-native)
    ├── Workflow strip + reasoning telemetry
    ├── Collapsed pipeline activity summary + raw-call drill-down
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
    │   ├── Subagent: Code Writer — claude-opus-4-6 (default, env-toggle to sonnet)
    │   └── Subagent: Validator — claude-opus-4-6
    ├── MCP Tool: jlcsearch (in-process)
    ├── Hooks: PreToolUse, PostToolUse, SubagentStart/Stop
    └── Built-in Tools (phase-scoped): WebFetch, WebSearch, Task

    Self-correction loop
    ├── Phase state machine (requirements → architecture → implementation → review → export)
    ├── Checkpoint events (`phase_entered`, `phase_progress`, `phase_block_done`)
    ├── Architecture synthesis via claude-haiku-4-5 (structured JSON blocks + connections)
    ├── Architecture fallback via deterministic requirement heuristics when model output is invalid
    ├── Preventive routing guardrails (trace/via spacing hints)
    ├── Rolling error memory (in-memory fallback + Convex persistence)
    ├── Configurable repair runtime (env-driven max attempts, stagnation, signature, autorouter limits)
    ├── Speculative compilation after stable TSX fence detection (overlap with LLM stream)
    ├── Local compile via @tscircuit/eval CircuitRunner (no external timeout)
    ├── Remote compile.tscircuit.com fallback (30s fetch timeout)
    ├── Per-attempt compile/validate timeout guard (CIRCUITFORGE_COMPILE_VALIDATE_TIMEOUT_MS)
    ├── Pre-compile structural lint pass for common source/footprint/selector failures
    ├── Semantic connectivity preflight (trace endpoints, selectors, component/pin refs)
    ├── Source code guardrails (normalize net names, strip malformed traces)
    ├── Parallel post-compile: KiCad analysis + tscircuit diagnostics via Promise.all
    ├── Parallel KiCad analyses: connectivity, ERC, BOM concurrently
    ├── PCB diagnostic extraction (`*_error` entries) + board-fit validation
    ├── KiCad-backed review diagnostics (`lib/kicad/*`)
    ├── Advisory signal splitting (actionable vs low-signal) for readiness scoring
    ├── Review finding events (`review_finding`, `review_decision`) — emitted after deterministic fixes
    ├── Volatile diagnostic ID stabilization (UUID normalization)
    ├── Post-validation summary appended to final agent text (with advisory breakdown)
    ├── Retry prompt injection with structured diagnostics + tscircuit reference hints
    ├── Structural repair strategies (targeted congestion relief → trace rebuild / layout spread) with escalation ladder
    ├── Status pulse heartbeats during long generation/validation operations
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

    Local Compilation (primary)
    └── @tscircuit/eval CircuitRunner (lib/compile/local.ts)
        ├── In-process tscircuit render — no external timeout
        ├── Auto-detects export-default vs circuit.add() patterns
        └── Falls back to remote compile.tscircuit.com API on error

    Optional Isolated Execution
    └── Vercel Sandbox SDK (@vercel/sandbox)
        └── Ephemeral microVM for KiCad validation sandbox
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
| `app/api/compile/` | Local tscircuit compilation route |
| `app/api/manufacturing/` | Manufacturing connector payload route |
| `app/api/sandbox/quickstart/` | Sandbox smoke-test endpoint (create VM, run command, teardown) |
| `components/` | React UI components |
| `convex/` | Convex schema + HTTP actions for persistent error memory |
| `lib/agent/` | Agent config, prompts, code extraction, repair loop utilities |
| `lib/compile/` | Local tscircuit compiler (`@tscircuit/eval` wrapper + remote fallback) |
| `lib/kicad/` | KiCad bridge + converter + review helpers |
| `lib/sandbox/` | Vercel Sandbox helpers for isolated execution |
| `lib/stream/` | SSE event parsing and state management |
| `public/` | Static assets |

## Data Flow

1. User sends prompt → POST /api/agent
2. Backend emits phase checkpoints for `requirements/architecture/implementation/review/export`
3. Backend synthesizes architecture blocks from requirements (Haiku JSON + fallback), emits `architecture_block` events
4. Backend runs agent attempt #N, captures generated `tsx` code
5. Backend validates generated code via local `@tscircuit/eval` (remote API fallback)
5b. Speculative compile fires as soon as first code block is detected in the LLM stream, overlapping compilation with remaining generation
6. Backend normalizes diagnostics from `circuit_json` entries and KiCad findings (run in parallel) and decides retry/stop
7. Failed attempts are recorded in rolling error memory (in-memory and optional Convex persistence)
8. On retries, backend injects structured diagnostics + adaptive guardrails into the next repair prompt
9. SSE emits telemetry (`retry_start`, `validation_errors`, `retry_result`) and final assistant text
10. Frontend derives retry summary stats (attempt count, first error type, category counts, final status) from SSE events
11. Frontend parses SSE into split panels: chat (code blocks replaced with placeholder), artifact preview (RunFrame), and workflow (phase/tool/requirements/review)
12. Frontend renders architecture nodes with semantic metadata (role/criticality/signal summaries) and derives `phaseSteps`/`gateEvents` from stream events
13. RunFrame renders live schematic/PCB/3D preview in iframe via Artifact/WebPreview composition
14. Export: client sends `tscircuit_code` directly to `/api/export`; server compiles once, generates artifacts in parallel, and returns zip (+ optional KiCad bundle)
15. Optional KiCad validation: `/api/kicad/validate` returns schema, findings, and connectivity metadata
16. Sandbox setup validation: `/api/sandbox/quickstart` creates a microVM, executes a command, then tears down

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
- Frontend intercepts `tool_start` for `TodoWrite` to extract and merge `TodoItem[]` into stream state.
- Frontend now stores and renders these in `InfoPanel`, `CircuitPanel`, and `ChatPanel` (todo queue).

### Parallelization currently in use

- KiCad + tscircuit diagnostics run in parallel in `lib/agent/repairLoop.ts` (`Promise.all`).
- KiCad schema analyses (connectivity/ERC/BOM) run in parallel in `lib/kicad/review.ts` (`Promise.all`).
- Guardrail fetch is lazy and only runs when a retry prompt is needed.
- Speculative compile starts during token streaming and can be reused if final code matches.

### Reliability controls now in place

- Session context persistence with file-backed cache + TTL/LRU eviction: `lib/agent/sessionMemory.ts`.
- Per-session single-flight orchestration in `/api/agent` (new request aborts prior run for same session).
- Abort propagation from request through agent attempts and compile path.
- Retry loop uses a per-attempt compile/validation timeout guard (`CIRCUITFORGE_COMPILE_VALIDATE_TIMEOUT_MS`, default 240s) in addition to request/session abort propagation.
- Retry stop policy tuned for meaningful improvement threshold, repeated-signature detection, autorouter exhaustion stall, and structural repair budget exhaustion.
- Compile and Convex memory calls now use bounded retry/backoff.
- Structural repair mode auto-switches strategy via an escalation ladder (targeted congestion relief → trace rebuild / layout spread) after repeated same-family/no-reduction streaks, with configurable trigger thresholds and per-pass caps.
- Convergence policy is blocker-first: implementation/review retries focus on blocking diagnostics, warnings become advisory, and gate pass can occur with advisory warnings present.
- Abort/timeout-like failures are non-terminal: attempts emit `attempt_timeout` diagnostics and continue through retry loop instead of immediately failing the stream.
- Compile/validation timeout failures are non-terminal: attempts emit `compile_validate_timeout` diagnostics and continue through retry loop.
- Abort-like SDK messages (for example, "aborted by user") are normalized into the same timeout-like retry flow.

## Conventions

- All server-side code uses Node runtime (not Edge) for Agent SDK compatibility
- SSE events use newline-delimited JSON: `data: {"type": "...", ...}\n\n`
- Model aliases centralized in `lib/agent/models.ts`
- Primary app flow remains stateless per request; optional Convex persistence stores retry error-memory aggregates
- SDK query lifecycle managed via `AbortController` + explicit `close?.()` to prevent ProcessTransport race
- Live smoke prompt selection is fixture-backed (`__tests__/fixtures/live-smoke-prompts.json`) with fail-fast validation
- `ErrorBoundary` wraps all top-level panels (`ChatPanel`, `CircuitPanel`, `InfoPanel`)
