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
- [ ] Error handling and boundaries
- [x] Agent self-correction loop (compile + diagnostics + retry/stagnation policy)
- [x] Retry telemetry surfaced in InfoPanel activity tab
- [x] Preventive routing guardrails for recurring trace/via DRC failures
- [x] Adaptive error memory for recurring failure classes (rolling prompt guardrails)
- [x] Convex-backed persistent error memory (with in-memory fallback)
- [ ] Loading states and animations
- [ ] Mobile-responsive considerations
- [ ] React component tests (Testing Library)
- [ ] E2E browser tests (Playwright)
- [ ] Refine board sizing heuristic (components still escape bounds sometimes)

## Phase 6: Deploy
- [ ] CI pipeline (GitHub Actions — run `pnpm test` + `pnpm test:integration`)
- [ ] Vercel deployment configuration
- [x] Vercel Sandbox SDK scaffold + smoke test endpoint (`/api/sandbox/quickstart`)
- [x] README with setup instructions
- [ ] Demo recording prep
