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
- [x] Thinking panel
- [x] Tool activity timeline
- [x] Circuit panel with code view
- [x] tscircuit RunFrame integration (live preview)
- [x] Blueprint-noir visual design

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

## Phase 5: Polish (next)
- [ ] Error handling and boundaries
- [ ] Loading states and animations
- [ ] Mobile-responsive considerations
- [ ] React component tests (Testing Library)
- [ ] E2E browser tests (Playwright)

## Phase 6: Deploy
- [ ] CI pipeline (GitHub Actions — run `pnpm test` + `pnpm test:integration`)
- [ ] Vercel deployment configuration
- [ ] README with setup instructions
- [ ] Demo recording prep
