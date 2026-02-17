# CircuitForge

A circuit design agent that catches its own mistakes, fixes them before you see them, and never makes the same one twice.

## The Problem

AI-generated circuits don't work on the first try. Nets are miswired, footprints are wrong, vias violate clearance rules, BOM fields are missing. Every existing tool leaves you to debug this yourself. The workflow becomes: generate, export, open in KiCad, find 30 errors, go back, re-prompt, repeat. You're the error-correction loop.

## What CircuitForge Does Differently

CircuitForge is a self-correcting, self-improving circuit design agent. You describe what you want in plain language. It designs, validates, and fixes the circuit autonomously -- then exports manufacturing-ready files.

**The core loop:**

1. **Generate** -- A multi-model agent pipeline (Claude Opus orchestrates; Sonnet writes tscircuit code; Haiku scouts real JLCPCB parts) produces a circuit from your description.

2. **Validate** -- tscircuit compilation and KiCad analysis (connectivity, ERC, BOM audit) run in parallel against every generation. Not after you export. Every time.

3. **Classify & Repair** -- Every diagnostic is bucketed as `auto_fixable`, `should_demote`, or `must_repair`. The agent makes deterministic decisions about what to retry, what to degrade gracefully, and what needs a fundamentally different approach. Up to 3 bounded attempts with stagnation detection.

4. **Remember** -- Failure patterns are scored with exponential weighted moving averages and promoted into pre-generation guardrails. The next time you (or anyone on your deployment) designs a circuit, the agent already knows "don't place different-net vias within 0.2mm" because it learned that the hard way last Tuesday.

The result: you get a validated, manufacturable circuit -- not a first draft you have to babysit.

### Auto-Healing in Action (Demo Snapshot)

In a live hackathon demo, the first generated nRF52832 design failed validation because the QFN48 pin map was incomplete (missing pin labels 38-48 and referencing `VDD3` without a matching mapping).

On the next repair pass, CircuitForge:

1. Added missing `pinLabels` for pins 38-48 (including explicit `NC` placeholders where appropriate).
2. Removed invalid `VDD3` references from `schPinArrangement` and kept only mapped rails.
3. Rebalanced placement to reduce dense routing congestion before rerunning checks.

Result of the autonomous retry loop:

- Blocking diagnostics: `0`
- Actionable advisories: `1`
- Low-signal advisories auto-tolerated: `17`
- Auto-fixed issues in run: `322`
- Manufacturing readiness: `90/100`

This is the default behavior: fail, diagnose, patch, and re-validate until the design is export-safe or a clear stopping condition is reached.

### How Self-Learning Works

Every validation failure is decomposed into error categories (`pcb_trace_error`, `via_clearance`, etc.). Each category is tracked with an exponentially weighted moving average (7-day half-life) so recent failures rank higher than old ones. Before each generation attempt, the top recurring categories are pulled back as guardrails injected into the agent's retry prompt — with actionable hints like "spread different-net vias apart" or "increase spacing and reduce routing density."

Works in-memory out of the box. Add [Convex persistence](#convex-persistence-setup-optional) to carry learnings across deploys.

### Built on the Claude Agent SDK

The orchestration layer runs on the [Anthropic Agent SDK](https://docs.anthropic.com/en/docs/agents/agent-sdk) -- not as a thin wrapper, but using the full primitives:

- **Multi-model sub-agents** -- Four specialist agents are defined as SDK `AgentDefinition` objects, each pinned to the right model for its job. Opus orchestrates and reviews. Sonnet writes tscircuit code. Haiku scouts parts from JLCPCB inventory. The orchestrator delegates to them by context, not hardcoded sequence.
- **MCP tool servers** -- External capabilities (JLCPCB parts search, web fetch) are exposed through `createSdkMcpServer()` so the agent invokes them as native tool calls with Zod-validated schemas.
- **Streaming hooks** -- `PreToolUse`, `PostToolUse`, `SubagentStart`, `SubagentStop` hooks emit SSE events in real time (with per-call correlation IDs), powering the chain-of-thought UI, tool timeline, and sub-agent activity indicators without polling.
- **Adaptive thinking** -- The orchestrator runs with `thinking: { type: "adaptive" }`, so reasoning depth scales with problem complexity. Simple tweaks get fast responses; tricky electrical issues get deep deliberation.
- **Speculative compilation** -- Code blocks are detected mid-stream and compiled locally via `@tscircuit/eval` before the agent finishes its turn, overlapping validation with generation. No external API timeout limits.

The retry loop sits outside the SDK query boundary: each attempt is a fresh `query()` call with an augmented prompt containing the previous code, diagnostics, and adaptive guardrails. Compilation runs locally via `@tscircuit/eval` with no external timeout — the 90-second hard limit from the remote compile API is eliminated. Abort propagation flows through the SDK's `AbortController` so cancelling a session tears down the active agent turn, any running sub-agents, and in-flight compilations cleanly.

**What ships with it:**

- Five-phase conversational workflow: requirements → architecture → implementation → review → export
- Live schematic/PCB/3D preview in the browser as the agent works
- AI-native UI with chain-of-thought reasoning, todo queue, and review findings you can accept or dismiss
- Manufacturing export: Gerber, Excellon drill, BOM CSV, Pick & Place CSV, optional KiCad bundle
- Real parts from JLCPCB inventory, not placeholder values
- Adaptive error memory (in-memory by default, optional Convex persistence across deploys)

## Tech Stack

- Next.js (App Router, Node runtime routes)
- TypeScript strict mode
- Anthropic Claude Agent SDK
- tscircuit + `@tscircuit/eval` (local compilation, no external timeout)
- circuit-json-to-kicad + kicad-sch-ts
- Vercel Sandbox (optional isolated execution for KiCad validation)
- Convex (optional persistent self-learning memory)

## Quick Start

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Configure environment:
   ```bash
   cp .env.example .env.local
   ```

3. Required env:
   - `ANTHROPIC_API_KEY`

4. Optional env:
   - `VERCEL_OIDC_TOKEN` (for sandbox auth in local/dev)
   - `CONVEX_SITE_URL` or `NEXT_PUBLIC_CONVEX_SITE_URL`
   - `CIRCUITFORGE_CONVEX_SHARED_SECRET`
   - `CIRCUITFORGE_COMPILE_VALIDATE_TIMEOUT_MS` (per-attempt compile/validation timeout, default `240000`)
   - `CIRCUITFORGE_CODEGEN_MODEL` (`opus` default, set `sonnet` for faster/cheaper code-writer runs)
   - `CIRCUITFORGE_ENABLE_CONNECTIVITY_PREFLIGHT` (`true` default)
   - `CIRCUITFORGE_ENABLE_STRUCTURAL_REPAIR_MODE` (`true` default)
   - `CIRCUITFORGE_MAX_REPAIR_ATTEMPTS` (`6` default in non-test runtime)
   - `CIRCUITFORGE_RETRY_STAGNATION_LIMIT` (`4` default in non-test runtime)
   - `CIRCUITFORGE_SIGNATURE_REPEAT_LIMIT` (`3` default in non-test runtime)
   - `CIRCUITFORGE_AUTOROUTER_STALL_LIMIT` (consecutive autorouter-exhaustion attempts before stop, `4` default in non-test runtime)
   - `CIRCUITFORGE_STRUCTURAL_REPAIR_TRIGGER` (`2` default)
   - `CIRCUITFORGE_MAX_STRUCTURAL_REPAIR_ATTEMPTS` (`3` default in non-test runtime)
   - `CIRCUITFORGE_MINOR_BOARD_GROWTH_CAP_PCT` (max board-growth cap for targeted congestion relief, default `20`)
   - `CIRCUITFORGE_MINOR_COMPONENT_SHIFT_MM` (max per-pass component shift cap for targeted congestion relief, default `3`)
   - `CIRCUITFORGE_MINOR_RELIEF_PASSES` (number of minor congestion-relief passes before escalating to structural spread, default `2`)
   - `CIRCUITFORGE_STATUS_PULSE_MS` (live status heartbeat interval during long repair/validation steps, default `8000`)
   - `CIRCUITFORGE_USE_TSCIRCUIT_AI_REFERENCE` (`true` default; set `false` to disable retrieval-augmented retry hints)
   - `CIRCUITFORGE_STRICT_BOM_AUDIT` (`false` default; set `true` to enforce BOM properties on all designators including passives)

5. Start app:
   ```bash
   pnpm dev
   ```

Open `http://localhost:3000`.

## Convex Persistence Setup (Optional)

If you want adaptive self-learning memory to persist across restarts/deploys:

1. Initialize/start Convex dev:
   ```bash
   pnpm convex:dev
   ```

2. Set shared secret in Convex env:
   ```bash
   pnpm convex env set CIRCUITFORGE_CONVEX_SHARED_SECRET "<your-secret>"
   ```

3. Set same secret in `.env.local`:
   ```env
   CIRCUITFORGE_CONVEX_SHARED_SECRET=<same-secret>
   ```

4. Ensure site URL exists in `.env.local`:
   ```env
   NEXT_PUBLIC_CONVEX_SITE_URL=https://<deployment>.convex.site
   ```

5. Deploy Convex (when needed):
   ```bash
   pnpm convex:deploy
   ```

Without these vars, the app automatically falls back to in-memory error memory.

## Commands

- `pnpm dev` - start app
- `pnpm build` - production build
- `pnpm lint` - lint
- `pnpm test` - unit tests
- `pnpm test:integration` - integration tests
- `pnpm test:all` - full non-interactive test pass
- `pnpm convex:dev` - Convex dev deployment/watch
- `pnpm convex:deploy` - deploy Convex functions
- `pnpm test:sdk` - run SDK smoke test (optional, requires SDK creds)
- `pnpm test:agent:live` - run live `/api/agent` SSE test with real key
- `pnpm test:live:smoke` - hit live local endpoints (`/api/agent`, KiCad, export) end-to-end

### Live Smoke Controls

`pnpm test:live:smoke` supports deterministic prompt fixtures and probe toggles:

- `CIRCUITFORGE_BASE_URL` (default `http://localhost:3000`)
- `CIRCUITFORGE_AGENT_TIMEOUT_MS` (default `360000`)
- `CIRCUITFORGE_SMOKE_IMPLEMENTATION=0` to skip implementation probe
- `CIRCUITFORGE_SMOKE_PIN_CONFLICT=0` to skip pin-conflict probe
- `CIRCUITFORGE_SMOKE_PROMPT_SET=<set-id>` to select a prompt set from `__tests__/fixtures/live-smoke-prompts.json`

The smoke run now fails fast if the selected prompt set is missing or invalid.

## Project Docs

- `AGENTS.md` - project map and working conventions
- `docs/README.md` - docs index and discovery map
- `docs/architecture.md` - architecture/data flow
- `docs/quality.md` - quality scorecard and known gaps
- `docs/plans/active/mvp.md` - active execution plan
- `specs/README.md` - spec index and verification status

## API Surface

- `POST /api/agent` - streaming phase-aware orchestration endpoint
- `POST /api/compile` - local tscircuit compilation (`@tscircuit/eval`, remote fallback)
- `POST /api/kicad/validate` - compile/convert + KiCad validation + report artifacts
- `POST /api/kicad/edit` - apply MCP-style KiCad operations to a schematic
- `POST /api/export` - manufacturing zip export (accepts `circuit_json` or `tscircuit_code`) with optional KiCad review bundle
- `POST /api/manufacturing/jlcpcb-link` - v1 export payload stub for manufacturing payload
