# ExecPlan: CircuitForge MVP

## Purpose
Build a working demo of CircuitForge: prompt → agent reasoning → parts search → code generation → live preview → export.

## Current State
- Empty repo with project scaffold and specs
- No code yet

## Plan of Work
1. Initialize Next.js with TypeScript, Tailwind, App Router
2. Set up Agent SDK backend with SSE streaming
3. Implement jlcsearch MCP tool and subagent definitions
4. Build 4-panel frontend with streaming parser
5. Integrate tscircuit RunFrame for live preview
6. Build export pipeline (compile API → server conversion → zip)
7. Polish UI with blueprint-noir aesthetic
8. Add minimal tests

## Milestones
1. **Agent streams text** — Can send prompt, receive streaming SSE response
2. **Tools work** — jlcsearch returns real parts, subagents execute
3. **UI renders stream** — 4 panels populate from SSE events
4. **Preview works** — RunFrame renders generated tscircuit code
5. **Export works** — Download zip with BOM + Gerbers

## Validation
- Send "design a WiFi temperature sensor" → get real ESP32 + DHT22 parts from jlcsearch
- Generated code renders in RunFrame without errors
- Export zip contains valid Gerber files and BOM CSV

## Progress
- [ ] Milestone 1: Agent streams text
- [ ] Milestone 2: Tools work
- [ ] Milestone 3: UI renders stream
- [ ] Milestone 4: Preview works
- [ ] Milestone 5: Export works
