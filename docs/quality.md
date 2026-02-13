# Quality Scorecard

Last updated: 2026-02-13

## Domain Grades

| Domain | Spec | Code | Tests | Review | Overall |
|--------|------|------|-------|--------|---------|
| Agent Backend | B | B | B | C | B |
| Frontend UI | C | B | F | C | C |
| Parts Search | B | B | B | C | B |
| Export Pipeline | C | C | B | F | C |
| Prompt Engineering | B | B | F | C | C |

## Architectural Layers

| Layer | Grade | Notes |
|-------|-------|-------|
| Error Handling | B | Route validation tested, SDK errors streamed, backend self-correction loop with compile diagnostics |
| Security | D | API key server-side only, validated in tests |
| Observability | C | Activity log includes retry telemetry and InfoPanel now shows retry summary (attempts, first error, category counts, final status) |
| Performance | F | Not started |
| CI | C | CI workflow exists (`.github/workflows/ci.yml`); needs a green run history for confidence |
| Documentation | B | Architecture, plans, quality scorecard reflect reality |
| Testing | C | 57 tests across 3 tiers (unit/integration/SDK) |

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
| No error boundaries in UI | Medium | Next iteration |
| No rate limiting | Medium | Post-MVP |
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
