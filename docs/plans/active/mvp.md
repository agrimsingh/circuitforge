# ExecPlan: CircuitForge MVP

## Purpose
Build a working demo of CircuitForge: prompt → agent reasoning → parts search → code generation → live preview → export.

## Current State
- Full-stack MVP functional: prompt → agent → parts search → tscircuit code → live preview → export
- 3-panel UI: Chat | Preview | Activity+Tools (tabbed)
- 46 tests passing across unit, integration, and SDK tiers

## Plan of Work
1. ~~Initialize Next.js with TypeScript, Tailwind, App Router~~
2. ~~Set up Agent SDK backend with SSE streaming~~
3. ~~Implement jlcsearch MCP tool and subagent definitions~~
4. ~~Build frontend with streaming parser~~
5. ~~Integrate tscircuit RunFrame for live preview~~
6. ~~Build export pipeline (compile API → server conversion → zip)~~
7. ~~Polish UI with blueprint-noir aesthetic~~
8. ~~Add minimal tests~~
9. Harden agent prompt engineering (layout, part search quality)
10. Add CI pipeline (GitHub Actions)
11. E2E browser tests (Playwright)

## Milestones
1. **Agent streams text** — Can send prompt, receive streaming SSE response
2. **Tools work** — jlcsearch returns real parts, subagents execute
3. **UI renders stream** — Panels populate from SSE events
4. **Preview works** — RunFrame renders generated tscircuit code
5. **Export works** — Download zip with BOM + Gerbers

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

## Known Issues (active)
- Agent-generated circuits sometimes have components outside board bounds despite dynamic sizing prompts
- Part search can still be noisy for unfamiliar components (description-based search fallback)
- No CI — tests run locally only
- Schematic/PCB layout quality depends heavily on prompt adherence
