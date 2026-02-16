# Quality Scorecard

Last updated: 2026-02-16

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
| Observability | B | Reasoning stream, chain-of-thought steps, tool rows, architecture updates, and review decisions are now surfaced via dedicated workflow UI surfaces |
| Performance | B | Parallelized compile/validation pipeline, speculative compilation, sandbox pooling, parallel KiCad analyses, SSE heartbeat keepalive, fetch timeouts, abort signal propagation |
| CI | C | CI workflow exists (`.github/workflows/ci.yml`); needs a green run history for confidence |
| Documentation | B | Architecture, plans, quality scorecard reflect reality |
| Testing | B | Expanded unit/integration coverage plus optional live SDK and live endpoint smoke checks |

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
| Session persistence is single-node file-backed by default | Medium | Add Redis/Convex shared session backend for multi-instance deployments |
| Convex persistence depends on secret parity across Next + Convex | Low | Keep `CIRCUITFORGE_CONVEX_SHARED_SECRET` synchronized and add health check badge |
| Board sizing still imperfect | Medium | Refine largestHalf heuristic, consider server-side validation |
| Part search noisy for unknown MPNs | Medium | Better WebSearch→MPN pipeline |
| Retry loop can still terminate with unresolved diagnostics | Medium | Add deeper validator subagent pass + longer horizon attempts in sandbox worker |

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
