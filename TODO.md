# CircuitForge TODO

## Phase 1: Foundation (done)
- [x] Project scaffold (docs, specs, workflows)
- [x] Environment setup (.env.local, .env.example)
- [x] Next.js app initialization (App Router, Tailwind, TypeScript)
- [x] Model constants and agent configuration
- [x] Agent SDK route with SSE streaming
- [x] Custom jlcsearch MCP tool
- [x] Subagent definitions (parts-scout, code-writer, validator)
- [x] Hooks for UI event emission

## Phase 2: Frontend (done)
- [x] 4-panel layout with resizable splits
- [x] SSE stream parser and state management
- [x] Chat panel with message rendering
- [x] Thinking panel → merged into InfoPanel (Activity tab)
- [x] Tool activity timeline → merged into InfoPanel (Tools tab)
- [x] Circuit panel — code tab removed, always shows preview
- [x] tscircuit RunFrame integration (live preview, mainComponentPath fix)
- [x] Blueprint-noir visual design
- [x] Strip code blocks from chat (show placeholder instead)
- [x] Activity log surfaces thinking + tool calls + subagent events

## Phase 3: Export (done)
- [x] Export route (Circuit JSON → BOM/Gerbers/PNP → zip)
- [x] Export button in UI with download

## Phase 4: Testing (done)
- [x] Vitest config with path aliases and env loading
- [x] Unit tests: SSE parser, model config, prompt construction, tool config (26 tests)
- [x] Integration tests: route validation, export zip, jlcsearch API (20 tests)
- [x] Live SDK tests: connectivity, MCP tools, subagents, code gen (9 tests)
- [x] Fix env bug (SDK env option replaces process.env)
- [x] Document SDK/vitest incompatibility and workaround

## Phase 4b: Prompt Engineering (done)
- [x] Parts-scout: MPN-first strategy, strict search budget (max 5 calls)
- [x] Code-writer: full tscircuit element catalog, valid footprint list
- [x] Code-writer: dynamic board sizing (pos + largestHalf pattern)
- [x] Code-writer: explicit pcbX/pcbY + schX/schY layout rules
- [x] Code-writer: schematic conventions (all MCU pins, power top/ground bottom)
- [x] Orchestrator: concise output, no code in chat, known MPN hints
- [x] Adaptive thinking enabled on orchestrator
- [x] Deslop: removed dead files, dead code, as-casts

## Phase 5: Polish (next)
- [x] AI SDK Elements migration (Conversation/PromptInput/Reasoning/Tool/Artifact/Canvas/Node/Edge)
- [x] Error handling and boundaries
- [x] Agent self-correction loop (compile + diagnostics + retry/stagnation policy)
- [x] Retry telemetry surfaced in InfoPanel activity tab
- [x] Preventive routing guardrails for recurring trace/via DRC failures
- [x] Adaptive error memory for recurring failure classes (rolling prompt guardrails)
- [x] Convex-backed persistent error memory (with in-memory fallback)
- [x] Parallelized validation pipeline (speculative compile, parallel KiCad analyses)
- [x] Self-hosted tscircuit compiler (`@tscircuit/eval` CircuitRunner, no external 90s timeout)
- [x] SSE heartbeat + abort signal propagation for reliability
- [x] SDK lifecycle cleanup (AbortController + explicit `close?.()`)
- [x] Fetch timeouts on compile API calls
- [x] Session persistence policy (file-backed + TTL/LRU) and per-session single-flight guard
- [x] Evidence stream contract (`iteration_diff`, `final_summary`, `timing_metric`)
- [x] Review UX upgrades (severity filters, bulk decisions, fix-critical rerun action)
- [x] Export readiness checklist with explicit risky-export override
- [x] Convergence tuning: blocker-first retries + advisory warning tolerance + abort/timeout-like error-to-retry behavior
- [x] Live smoke quality bar enforced (`readiness >= 70`, zero blocking diagnostics)
- [x] Deterministic diagnostic family routing (`auto_fixable` / `should_demote` / `must_repair`) with repair evidence SSE events
- [x] Tightened active-pin classification for `kicad_unconnected_pin` routing
- [x] Added live smoke `PIN_CONFLICT_WARNING` probe coverage
- [x] Added fixture-backed live smoke prompt sets (`__tests__/fixtures/live-smoke-prompts.json`) with strict prompt-set validation
- [x] Post-validation summary appended to agent final text (`buildPostValidationSummary`)
- [x] Agent todo queue UI (TodoQueue component + Queue primitives in `components/ai-elements/queue.tsx`)
- [x] Stream-side `TodoItem` state derived from `TodoWrite` tool_start events
- [x] Export readiness check uses `blockingDiagnosticsCount` (advisory warnings no longer block export)
- [x] Device-specific architecture synthesis using Haiku JSON output with heuristic fallback
- [x] Review findings emitted after deterministic fixes (auto-fixed issues excluded)
- [x] Review findings lifecycle sync: emit auto-closure decisions for resolved findings and preserve accepted/dismissed status on stream upserts
- [x] Chat progress narration: stream concise state/next-step updates into the conversation during retries/validation
- [x] End-of-run chat recap: always append assistant summary with current state, fixes made, and suggested follow-up prompts
- [x] Mid-run chat status pinning: keep live status message at the conversation bottom during tool/retry activity
- [x] Chat formatting polish: markdown sectioned status/recap text and styled system status cards
- [x] Remove duplicate deterministic revalidation compile pass in retry loop
- [x] Lazy-load adaptive guardrails only when retry prompt is needed
- [x] Phase-scope allowed tools/subagents in `/api/agent`
- [x] Add `callId` correlation for `tool_start`/`tool_result` SSE events
- [x] Tighten speculative compile trigger to complete TSX fence extraction
- [x] Detect autorouter exhaustion compile failures and route targeted retry guidance
- [x] Add per-attempt compile/validation timeout guard (`CIRCUITFORGE_COMPILE_VALIDATE_TIMEOUT_MS`)
- [x] Default code-writer to Opus with env-based Sonnet override (`CIRCUITFORGE_CODEGEN_MODEL`)
- [x] Add preflight structural diagnostics for missing footprints, unresolved trace selectors, and missing chip `pinLabels`
- [x] Demote low-signal KiCad pin conflicts (`unspecified connected to unspecified`) while keeping high-signal conflicts blocking
- [x] Add targeted retry hints for `source_failed_to_create_component_error`, `source_trace_not_connected_error`, `pcb_missing_footprint_error`, and `pcb_autorouting_error`
- [x] Switch export UX to single `/api/export` call using `tscircuit_code`
- [x] Parallelize independent export artifact generation tasks
- [x] Declutter InfoPanel tool section (grouped pipeline summary + raw drill-down)
- [x] Add source guardrails to normalize invalid net names and strip malformed trace statements before compile/validation
- [x] Stop retry loop early on repeated autorouter exhaustion and suppress internal `Bash`/`Explore` timeline noise
- [x] Add retrieval-augmented retry guidance from `https://docs.tscircuit.com/ai.txt` (cached + diagnostic-targeted snippets)
- [x] Add semantic connectivity preflight (`source_trace_missing_endpoint`, invalid selector, unknown component/pin)
- [x] Add stuck-loop structural repair mode (trace rebuild + layout spread) with env-tunable triggers and grouped blocker summaries
- [x] Add board-fit blocking diagnostic (`pcb_component_out_of_bounds_error`) and route it into structural layout repair
- [x] Extract repair runtime config into env-driven `RepairRuntimeConfig` (max attempts, stagnation/signature/autorouter limits, structural budget, status pulse)
- [x] Add per-attempt compile/validate timeout with non-terminal `compile_validate_timeout` diagnostics
- [x] Split advisory diagnostics into actionable vs low-signal for readiness scoring and display
- [x] Add status pulse heartbeats during long generation/validation operations
- [x] Stabilize volatile diagnostic IDs (UUID normalization for duplicate references)
- [x] Enrich ArchitecturePanel with role/criticality pills and I/O summaries
- [x] Widen InfoPanel fix action to repair all open findings (not just critical)
- [x] Add `targeted_congestion_relief` intermediate repair strategy with escalation ladder (minor relief → structural spread)
- [x] Add `CIRCUITFORGE_MINOR_RELIEF_PASSES` / `CIRCUITFORGE_MINOR_BOARD_GROWTH_CAP_PCT` / `CIRCUITFORGE_MINOR_COMPONENT_SHIFT_MM` env vars for congestion relief tuning
- [x] Gate autorouter exhaustion fast-cutoff behind at least one minor relief pass
- [ ] Loading states and animations
- [x] Mobile-responsive considerations
- [ ] React component tests (Testing Library)
- [ ] E2E browser tests (Playwright)
- [ ] Refine board sizing heuristic (components still escape bounds sometimes)

## Phase 6: Deploy
- [x] CI pipeline (GitHub Actions — run `pnpm test` + `pnpm test:integration`)
- [ ] Vercel deployment configuration
- [x] Vercel Sandbox SDK scaffold + smoke test endpoint (`/api/sandbox/quickstart`)
- [x] README with setup instructions
- [ ] Demo recording prep

## Phase 7: Competitive-First V2 Execution
- [x] Add phase state/event types for `requirements | architecture | implementation | review | export`
- [x] Add phase-aware agent orchestration and review findings stream events
- [x] Add KiCad validation route and conversion/review helpers
- [x] Wire optional KiCad artifacts into export bundle (`kicad_sch`, `kicad_report.json`, `connectivity.json`)
- [x] Add manufacturing payload stub route (`/api/manufacturing/jlcpcb-link`)
- [x] Add docs/specs for five-phase workflow and KiCad integration
- [x] Add CI workflow at `.github/workflows/ci.yml`
- [x] Add integration tests for kicad validation/export/phase checkpoints
