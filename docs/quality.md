# Quality Scorecard

Last updated: 2026-02-17

## Domain Grades

| Domain | Spec | Code | Tests | Review | Overall |
|--------|------|------|-------|--------|---------|
| Agent Backend | B | B | B | C | B |
| Frontend UI | B | B | F | C | B |
| Parts Search | B | B | B | C | B |
| Export Pipeline | C | C | B | F | C |
| Prompt Engineering | B | B | F | C | C |

## Architectural Layers

| Layer | Grade | Notes |
|-------|-------|-------|
| Error Handling | A | Route validation tested, SDK errors streamed, backend self-correction loop, error boundaries on all panels, SDK lifecycle cleanup (AbortController + `close?.()`), abort propagation, and abort-like message normalization |
| Security | D | API key server-side only, validated in tests |
| Observability | B+ | Reasoning stream, chain-of-thought steps, tool rows, architecture updates, review decisions, and agent todo queue surfaced via dedicated workflow UI surfaces; post-validation summary appended to final agent text |
| Performance | B+ | Self-hosted local compiler (no external timeout), parallelized compile/validation pipeline, per-attempt compile/validation timeout guard, speculative compilation, parallel KiCad analyses, phase-scoped tool access, lazy guardrail fetch, SSE heartbeat keepalive, abort signal propagation |
| CI | C | CI workflow exists (`.github/workflows/ci.yml`); needs a green run history for confidence |
| Documentation | B | Architecture, plans, quality scorecard reflect reality |
| Testing | B+ | Expanded unit/integration coverage: connectivity preflight, tscircuit reference, structural repair strategies, board-fit diagnostics, plus optional live SDK and live endpoint smoke checks |

## Grade Scale
- **A**: Production-ready, well-tested, reviewed
- **B**: Functional, has tests, minor gaps
- **C**: Works but fragile, limited tests
- **D**: Spec exists, minimal or no implementation
- **F**: Not started

## Known Gaps

| Gap | Severity | Plan |
|-----|----------|------|
| No React component tests | Medium | Future: Testing Library |
| No E2E browser tests | Medium | Future: Playwright |
| CI reliability under unstable external calls | Medium | Add guardrails for flaky integration/network tests and archive noisy regressions |
| No rate limiting | Medium | Post-MVP |
| Speculative compile only triggers on first code block | Low | Extend to handle multi-block responses |
| `.pnpmfile.cjs` forces zod@3 for tscircuit packages alongside zod@4 for claude-agent-sdk | Low | Remove when tscircuit ecosystem supports zod@4 |
| Session persistence is single-node file-backed by default | Medium | Add Redis/Convex shared session backend for multi-instance deployments |
| Convex persistence depends on secret parity across Next + Convex | Low | Keep `CIRCUITFORGE_CONVEX_SHARED_SECRET` synchronized and add health check badge |
| Board sizing still imperfect | Medium | Refine largestHalf heuristic, consider server-side validation |
| Part search noisy for unknown MPNs | Medium | Better WebSearch→MPN pipeline |
| Retry loop can still terminate with unresolved diagnostics | Medium | Add deeper validator subagent pass + longer horizon attempts in sandbox worker |
| Connectivity preflight does not cover all tscircuit element types | Low | Extend `connectivityPreflight.ts` parser as new element coverage is needed |
| tscircuit AI reference fetch adds latency on cache miss | Low | Pre-warm cache on server startup or increase TTL |

## Score History
- 2026-02-13: Initial scaffold — all F/D grades
- 2026-02-13: Comprehensive test suite added (55 tests, 3 tiers). Agent backend, parts search, export all upgraded to C. Testing layer added at C.
- 2026-02-13: Major UX overhaul — merged panels into 3-panel layout, removed code tab, added thinking/activity streaming, hardened agent prompts (layout rules, footprint catalog, dynamic board sizing, schematic conventions), deslop pass. Agent backend → B, Frontend → C, Prompt Engineering added at C.
- 2026-02-13: Vercel Sandbox SDK scaffolded with smoke-test route and unit tests. Test count now 49 across app-owned suites.
- 2026-02-13: Added backend self-correction loop (compile validation + structured diagnostic retries + stagnation stop) and shared code extraction utility. Test count now 52.
- 2026-02-13: Added preventive DRC guardrails for trace/via failures and surfaced retry telemetry summary in InfoPanel.
- 2026-02-13: Added in-memory adaptive error memory (rolling failed-attempt categories) to auto-prioritize guardrails for recurring failures. Test count now 55.
- 2026-02-13: Added Convex-backed persistent self-learning memory (HTTP actions + fallback to in-memory). Test count now 57.
- 2026-02-13: Added phase-aware event contract, KiCad-backed validation/export outputs, and GitHub Actions CI pipeline. Added `kicad-sch-ts@^1.0.3` backend adapter.
- 2026-02-13: Migrated frontend to AI SDK Elements primitives for chat, workflow, artifact, and architecture visualization surfaces.
- 2026-02-16: Parallelized compile/validation pipeline (speculative compile, sandbox pool, parallel KiCad/post-compile steps), added SSE heartbeat + abort propagation, error boundaries on all panels, fixed SDK lifecycle race (AbortController + close), lint fixes. Performance F->B, Error Handling B->A.
- 2026-02-16: Implemented workflow hardening + wow uplift: session TTL/LRU persistence, per-session single-flight orchestration, retry policy tuning, evidence events (`iteration_diff`/`final_summary`/`timing_metric`), InfoPanel bulk review controls, and export readiness checklist with override path.
- 2026-02-16: Convergence quality pass: blocker-first retry diagnostics, non-blocking warning tolerance in implementation gate, abort/timeout-like error-to-retry fallback (`attempt_timeout`) instead of terminal stream failure, ERC duplicate power-reference demotion, and live smoke quality gates (`readiness >= 70`, `blockingDiagnosticsCount === 0`).
- 2026-02-16: Dynamic repair hardening pass: deterministic family routing (`auto_fixable`/`should_demote`/`must_repair`), `repair_plan` + `repair_result` SSE evidence, stricter active-pin handling for `kicad_unconnected_pin`, and live smoke `PIN_CONFLICT_WARNING` probe coverage.
- 2026-02-16: Smoke reliability pass: fixture-backed prompt sets with fail-fast schema validation, configurable probe toggles (`CIRCUITFORGE_SMOKE_IMPLEMENTATION`, `CIRCUITFORGE_SMOKE_PIN_CONFLICT`), and higher default live-agent timeout for long pin-conflict runs.
- 2026-02-17: UX clarity pass: post-validation summary (`buildPostValidationSummary`) appended to final agent text, review findings emitted after deterministic fixes, agent todo queue (`TodoQueue` + `Queue` primitives) rendered in chat panel, export readiness check uses `blockingDiagnosticsCount` instead of total `diagnosticsCount`. Observability B→B+.
- 2026-02-17: Findings + UX follow-up: resolved review findings now emit closure decisions to keep client state in sync, stream upserts preserve accepted/dismissed decisions, auto-dismiss family matching uses normalized diagnostic family, and chat receives live progress narration (phase, retry, repair, gate, summary) instead of CoT-only updates.
- 2026-02-17: Chat completion UX fix: every completed run now appends an explicit assistant recap (where we are, what was fixed, blockers/advisories, concrete follow-up prompts), and chain-of-thought collapses at run end so recap remains the primary visible artifact.
- 2026-02-17: Mid-run chat UX polish: live status updates are now pinned to the newest chat position during tool/retry execution, with markdown-structured sections and dedicated system-card styling to prevent the stream from feeling like an unformatted wall of text.
- 2026-02-17: Self-hosted compiler: replaced external `compile.tscircuit.com` + Vercel Sandbox compile pool with local `@tscircuit/eval` `CircuitRunner`. Eliminates 90s external timeout. Simple LED circuit compiles in ~1s, complex STM32 board in ~3s. Remote API retained as fallback. New `/api/compile` route for client-side export. Performance B→B+.
- 2026-02-17: Local compiler stability fix: marked `@tscircuit/eval` as a server external package (avoids Turbopack chunk-loader crash), and added a file-URL fallback loader in `lib/compile/local.ts` so local compilation survives import-path regressions.
- 2026-02-17: One-shot optimization pass: removed duplicate deterministic revalidation compile, made adaptive guardrails lazy on retry-only path, added phase-scoped agent tool gating, added tool call correlation IDs (`callId`) to SSE, moved export to single `/api/export` call from `tscircuit_code`, parallelized export artifact generation, and decluttered InfoPanel with grouped pipeline summaries plus raw-call drill-down.
- 2026-02-16: Autorouter resilience pass: classify `capacity-autorouter` solver exhaustion into `pcb_autorouter_exhaustion`, add targeted retry hints for congestion/board-margin recovery, and cap compile/validation attempts with `CIRCUITFORGE_COMPILE_VALIDATE_TIMEOUT_MS` to prevent multi-minute stalls.
- 2026-02-17: Architecture specificity pass: replaced heuristic-only architecture scaffolding with Haiku JSON synthesis (`lib/agent/architecture.ts`) plus strict normalization/fallback, expanded `ArchitectureNode` semantics (role, criticality, interfaces, I/O, constraints, failure modes), and upgraded `ArchitecturePanel` node visuals for task-specific functional clarity.
- 2026-02-16: Convergence resilience update: switched code-writer default to Opus (with `CIRCUITFORGE_CODEGEN_MODEL=sonnet` override), added preflight structural diagnostics for source/footprint/selector failures, expanded retry hints for `source_*` and `pcb_missing_footprint_error`/`pcb_autorouting_error`, and demoted low-signal ERC pin conflicts (`unspecified connected to unspecified`) to reduce false-positive blocker spam.
- 2026-02-16: Validation hardening follow-up: added source guardrails that normalize invalid net names (e.g. `3V3 -> V3V3`) and strip malformed self-closing traces, added early-stop on repeated `pcb_autorouter_exhaustion`, improved failed-run final text to always show candidate code + blockers, and filtered internal `Bash`/`Explore` tool noise from chat timeline.
- 2026-02-16: Added retrieval-augmented retry prompts from `https://docs.tscircuit.com/ai.txt` using cached, diagnostic-targeted snippet extraction (instead of full-file prompt injection), with fast timeout and feature-flag fallback (`CIRCUITFORGE_USE_TSCIRCUIT_AI_REFERENCE=false`).
- 2026-02-16: Added semantic connectivity preflight (`source_trace_missing_endpoint`, `source_trace_invalid_selector`, `source_trace_unknown_component`, `source_trace_unknown_pin`) and deterministic structural repair strategies (`structural_trace_rebuild`, `structural_layout_spread`) with env-configurable trigger/budget controls; failed-run summaries now group repeated blockers and include explicit stop reason.
- 2026-02-16: Review-noise reduction pass: stabilized review finding IDs for volatile diagnostics (UUID-bearing duplicate refs), deduplicated repeated `<net />` declarations before compile, scoped BOM-property auditing to actionable references by default (strict override via `CIRCUITFORGE_STRICT_BOM_AUDIT`), and auto-dismissed low-signal advisory families (`kicad_bom_property`, `pin_conflict_low_signal`, power-symbol duplicate references).
- 2026-02-16: Findings UX follow-up: power-symbol `DUPLICATE_REFERENCE` diagnostics are now suppressed from emitted review findings, and InfoPanel action trigger now repairs all open findings (prioritizing blockers) instead of only `critical` severity so rerun automation is always available when findings remain.
- 2026-02-16: Connectivity/autorouter follow-up: preflight pin defaults now accept LED/diode/battery polarity aliases (`anode`, `cathode`, `pos`, `neg`) with case-insensitive pin matching to reduce false `source_trace_unknown_pin`, and `pcb_autorouting_error` now normalizes to `pcb_autorouter_exhaustion` for structural layout recovery + early-stop convergence logic.
- 2026-02-16: Autonomous repair-loop resilience pass: non-test runtime defaults now allow deeper autonomous repair budgets (`max attempts`, `signature/stagnation limits`, `structural passes`) without manual follow-up prompting, and long-running agent/compile-validate stages now emit periodic status pulses so UI does not appear stalled.
- 2026-02-17: Repair-loop convergence follow-up: autorouter exhaustion now requires a configurable repeated-stall threshold (`CIRCUITFORGE_AUTOROUTER_STALL_LIMIT`) instead of stopping immediately, and structural-strategy budget exhaustion no longer terminates retries early before max attempts.
- 2026-02-17: Advisory signal clarity pass: final summaries now split advisory diagnostics into actionable vs low-signal buckets, live status/recap/InfoPanel copy now highlights actionable advisories, and readiness scoring applies reduced weight to low-signal advisory noise.
- 2026-02-17: Small-change-first congestion recovery pass: added `targeted_congestion_relief` strategy (bounded board growth + bounded component nudges) ahead of structural spread, with configurable minor-pass caps (`CIRCUITFORGE_MINOR_BOARD_GROWTH_CAP_PCT`, `CIRCUITFORGE_MINOR_COMPONENT_SHIFT_MM`, `CIRCUITFORGE_MINOR_RELIEF_PASSES`) and explicit escalation/status telemetry.
- 2026-02-16: Added circuit-geometry board-fit validation that emits blocking `pcb_component_out_of_bounds_error` when any `pcb_component` body exceeds `pcb_board` bounds, and wired this family into must-repair/blocking classification plus structural layout-spread retry strategy.
- 2026-02-17: Configurable repair runtime pass: all retry budget knobs (max attempts, stagnation/signature/autorouter limits, structural repair budget, status pulse interval) extracted into `RepairRuntimeConfig` driven by environment variables with separate test vs runtime defaults. Per-attempt compile/validate timeout guard emits non-terminal `compile_validate_timeout` diagnostics. Testing B→B+.
- 2026-02-17: Connectivity & reference integration: added semantic connectivity preflight (`lib/agent/connectivityPreflight.ts`) with unit tests for trace endpoint/selector/component/pin validation; added retrieval-augmented retry prompts from `docs.tscircuit.com/ai.txt` (`lib/agent/tscircuitReference.ts`) with unit tests for reference filtering and feature-flag disable.
- 2026-02-17: Structural repair strategies: added `applyStructuralTraceRebuild` (net-intent-based trace reconstruction) and `applyStructuralLayoutSpread` (board dimension scaling + PCB coordinate expansion) with full unit test coverage; integrated into retry orchestration with env-configurable trigger and budget thresholds.
- 2026-02-17: Advisory signal clarity: readiness scoring now splits advisories into actionable vs low-signal buckets; final summaries and InfoPanel display actionable/low-signal breakdowns; low-signal advisories receive reduced scoring weight.
- 2026-02-17: UI hardening: ArchitecturePanel renders role/criticality pills with color-coded styles and I/O summaries; InfoPanel fix action now repairs all open findings (not just critical); ChatPanel suppresses `Bash`/`Explore` tool noise and styles system messages as cards; volatile diagnostic IDs stabilized via UUID normalization.
- 2026-02-17: Targeted congestion relief strategy: added `targeted_congestion_relief` as an intermediate repair step (constrained board growth + bounded component nudges) before escalating to full `structural_layout_spread`. Escalation ladder: normal → targeted_congestion_relief (N passes, tunable via `CIRCUITFORGE_MINOR_RELIEF_PASSES`) → structural_layout_spread. Autorouter fast cutoff now requires at least one minor relief pass. New `applyTargetedCongestionRelief` function with unit test coverage. Integration tests for strategy selection and 2-pass escalation added.
