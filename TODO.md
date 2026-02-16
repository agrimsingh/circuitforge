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
- [x] Parallelized validation pipeline (speculative compile, parallel KiCad analyses, sandbox pool)
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
