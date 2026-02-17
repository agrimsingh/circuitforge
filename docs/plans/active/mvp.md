# ExecPlan: CircuitForge MVP

## Purpose
Build a working demo of CircuitForge: prompt → agent reasoning → parts search → code generation → live preview → export.

## Current State
- Full-stack MVP functional: prompt → agent → parts search → tscircuit code → live preview → export
- 2/3-split UI: Conversation/chat, AI-native artifact preview, and workflow panel
- Test coverage expanded across unit, integration, live SDK, and live endpoint smoke flows
- Vercel Sandbox SDK integrated with smoke-test endpoint (`POST /api/sandbox/quickstart`)
- Agent backend now runs a self-correction loop (compile validation + structured diagnostic retries + stagnation stop)
- Preventive routing guardrails added for recurring trace/via DRC failures
- InfoPanel now surfaces CoT steps, reasoning stream, tool rows, requirements, architecture, and review findings
- Backend now persists adaptive self-learning memory via Convex HTTP actions (with in-memory fallback when unset)
- Root README now documents local setup, optional Convex persistence, and sandbox auth setup
- V2 phase orchestration now emits phase checkpoints, architecture events, and review findings in `/api/agent`
- Export route supports optional KiCad + review bundle outputs
- Frontend now uses AI SDK Elements primitives for chat, reasoning, artifact, architecture graph, and tool surfaces
- Parallelized compile/validation pipeline with speculative compilation, sandbox pooling, and concurrent KiCad analyses
- SSE heartbeat keepalive + abort signal propagation for reliability
- Error boundaries on all UI panels
- SDK lifecycle race condition fixed (AbortController + explicit `close?.()`)
- Deterministic diagnostic family router + repair evidence SSE events (`repair_plan`, `repair_result`) now integrated
- `kicad_unconnected_pin` routing tightened to treat active functional pins as `must_repair`
- Live smoke now supports fixture-selected deterministic prompt sets and a dedicated `PIN_CONFLICT_WARNING` probe
- 15.4% latency reduction measured on live API test
- Architecture phase now uses low-cost Haiku synthesis for device-specific block graphs (role/criticality/interfaces/I-O/failure modes) with deterministic fallback on invalid JSON
- Implementation loop now includes preflight structural diagnostics (source creation/trace selector/footprint), expanded targeted retry hints for `source_*` + footprint/autorouting classes, Opus-default code-writer (Sonnet override via env), and low-signal pin-conflict demotion to reduce false blocker spam
- Retry runtime is now fully env-configurable (max attempts, stagnation/signature/autorouter limits, structural repair budget, status pulse interval) with separate test vs runtime defaults
- Per-attempt compile/validate timeout guard (`CIRCUITFORGE_COMPILE_VALIDATE_TIMEOUT_MS`) emits non-terminal `compile_validate_timeout` diagnostics instead of killing the stream
- Semantic connectivity preflight validates trace endpoints, selector syntax, component existence, and pin references before compile
- Retrieval-augmented retry prompts pull diagnostic-targeted reference snippets from `docs.tscircuit.com/ai.txt`
- Structural repair strategies (trace rebuild from net intent, layout spread via board/coordinate scaling) auto-switch after stuck-loop detection
- Advisory diagnostics split into actionable vs low-signal for scoring and display
- Board-fit validation emits blocking `pcb_component_out_of_bounds_error` and routes into structural layout-spread recovery
- New `targeted_congestion_relief` intermediate strategy applies constrained board growth and bounded component nudges before escalating to full structural layout spread; escalation ladder configurable via `CIRCUITFORGE_MINOR_RELIEF_PASSES` (default 2)
- Autorouter exhaustion fast-cutoff now requires at least one minor relief pass before triggering

## Plan of Work
1. ~~Initialize Next.js with TypeScript, Tailwind, App Router~~
2. ~~Set up Agent SDK backend with SSE streaming~~
3. ~~Implement jlcsearch MCP tool and subagent definitions~~
4. ~~Build frontend with streaming parser~~
5. ~~Integrate tscircuit RunFrame for live preview~~
6. ~~Build export pipeline (compile API → server conversion → zip)~~
7. ~~Polish UI with blueprint-noir aesthetic~~
8. ~~Add minimal tests~~
9. ~~Harden agent prompt engineering (layout, part search quality)~~
10. ~~Add CI pipeline (GitHub Actions)~~
11. E2E browser tests (Playwright)
12. Improve retry loop convergence rate for complex PCB violations
13. ~~Add five-phase workflow completion criteria and docs~~
14. ~~Hardening pass for KiCad round-trip validation~~
15. ~~Complete AI SDK Elements migration for chat/info/architecture/artifact surfaces~~

## Milestones
1. **Agent streams text** — Can send prompt, receive streaming SSE response
2. **Tools work** — jlcsearch returns real parts, subagents execute
3. **UI renders stream** — Panels populate from SSE events
4. **Preview works** — RunFrame renders generated tscircuit code
5. **Export works** — Download zip with BOM + Gerbers
6. **Phase-aware orchestration** — Requirements + architecture checkpoints and review findings are streamed
7. **KiCad review path** — Export includes KiCad report artifacts where requested
8. **AI-native UI composition** — AI SDK Elements workflow surfaces, chain-of-thought, reason stream, and artifact panel

## Validation
- Send "design a WiFi temperature sensor" → get real ESP32 + DHT22 parts from jlcsearch
- Generated code renders in RunFrame without errors
- Export zip contains valid Gerber files and BOM CSV

## Progress
- [x] Milestone 1: Agent streams text
- [x] Milestone 2: Tools work
- [x] Milestone 3: UI renders stream
- [x] Milestone 4: Preview works
- [x] Milestone 5: Export works
- [x] Milestone 6: Phase-aware orchestration and review flow
- [x] Milestone 7: KiCad round-trip integration in export/review
- [x] Milestone 8: AI SDK Elements migration for UI workflow surfaces

## Known Issues (active)
- Agent-generated circuits sometimes have components outside board bounds despite dynamic sizing prompts
- Part search can still be noisy for unfamiliar components (description-based search fallback)
- Schematic/PCB layout quality depends heavily on prompt adherence
- Retry loop can still fail closed when diagnostic signatures stagnate
- SDK ProcessTransport race mitigated but depends on upstream SDK fix for full resolution
- Pin-conflict smoke probes can run close to timeout on slower local/dev environments.
