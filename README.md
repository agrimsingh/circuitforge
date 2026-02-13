# CircuitForge

AI-powered conversational circuit designer. Natural language to manufacturable PCB.

## What It Does

- Streams an agentic circuit-design workflow (`/api/agent`) from Claude Agent SDK.
- Generates `tscircuit` code and renders live preview in the browser.
- Supports a 5-phase orchestration flow:
  - requirements
  - architecture
  - implementation
  - review
  - export
- Runs KiCad-backed review with `circuit-json-to-kicad` + `kicad-sch-ts`.
- Exports manufacturing artifacts with optional KiCad bundles (`kicad_sch`, `kicad_report.json`, `connectivity.json`).
- Applies surgical schematic edits with MCP-backed KiCad operations (`manage_component`, `manage_wire`).
- Runs self-correction loop for compile/PCB diagnostics.
- Learns recurring failure patterns with in-memory + optional Convex persistence.

## Tech Stack

- Next.js (App Router, Node runtime routes)
- TypeScript strict mode
- Anthropic Claude Agent SDK
- tscircuit + compile API
- circuit-json-to-kicad + kicad-sch-ts
- Vercel Sandbox (optional isolated compile validation)
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

## Project Docs

- `AGENTS.md` - project map and working conventions
- `docs/README.md` - docs index and discovery map
- `docs/architecture.md` - architecture/data flow
- `docs/quality.md` - quality scorecard and known gaps
- `docs/plans/active/mvp.md` - active execution plan
- `specs/README.md` - spec index and verification status

## API Surface

- `POST /api/agent` - streaming phase-aware orchestration endpoint
- `POST /api/kicad/validate` - compile/convert + KiCad validation + report artifacts
- `POST /api/kicad/edit` - apply MCP-style KiCad operations to a schematic
- `POST /api/export` - manufacturing zip export with optional KiCad review bundle
- `POST /api/manufacturing/jlcpcb-link` - v1 export payload stub for manufacturing payload
