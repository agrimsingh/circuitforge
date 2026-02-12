# CircuitForge TODO

## Phase 1: Foundation (current)
- [x] Project scaffold (docs, specs, workflows)
- [x] Environment setup (.env.local, .env.example)
- [ ] Next.js app initialization (App Router, Tailwind, TypeScript)
- [ ] Model constants and agent configuration
- [ ] Agent SDK route with SSE streaming
- [ ] Custom jlcsearch MCP tool
- [ ] Subagent definitions (parts-scout, code-writer, validator)
- [ ] Hooks for UI event emission

## Phase 2: Frontend
- [ ] 4-panel layout with resizable splits
- [ ] SSE stream parser and state management
- [ ] Chat panel with message rendering
- [ ] Thinking panel
- [ ] Tool activity timeline
- [ ] Circuit panel with code view
- [ ] tscircuit RunFrame integration (live preview)
- [ ] Blueprint-noir visual design

## Phase 3: Export
- [ ] Compile API client (compile.tscircuit.com)
- [ ] Export route (Circuit JSON → BOM/Gerbers/PNP → zip)
- [ ] Export button in UI with download

## Phase 4: Polish
- [ ] Error handling and boundaries
- [ ] Loading states and animations
- [ ] Mobile-responsive considerations
- [ ] Vitest unit tests (stream parser, export)

## Phase 5: Deploy
- [ ] Vercel deployment configuration
- [ ] README with setup instructions
- [ ] Demo recording prep
