# CircuitForge

> AI-powered conversational circuit designer. Natural language → manufacturable PCB.

## Repository Map

| Path | What |
|------|------|
| `README.md` | Setup, local runbook, and optional Convex persistence guide |
| `docs/architecture.md` | System overview, tech stack, data flow |
| `docs/core-beliefs.md` | Agent operating principles |
| `docs/README.md` | Documentation index and navigation hub |
| `docs/notes/` | Competitive map, phase notes, and v2 assumptions |
| `docs/quality.md` | Living quality scorecard |
| `docs/plans/active/` | In-progress execution plans |
| `docs/plans/completed/` | Archived execution plans and retrospectives |
| `specs/` | System specifications (see `specs/README.md`) |
| `.agents/workflows/` | Task-specific workflows |
| `app/` | Next.js App Router (pages + API routes) |
| `app/api/compile/` | Local tscircuit compilation route (client-side export) |
| `app/api/kicad/` | KiCad validation endpoint and future export connectors |
| `app/api/manufacturing/` | Manufacturing payload helper routes |
| `components/` | React UI components |
| `components/ai-elements/` | AI-native UI primitives (Queue, Conversation, ChainOfThought, etc.) |
| `convex/` | Convex schema + HTTP actions for persistent self-learning memory |
| `lib/agent/` | Agent SDK config, prompts, tools, models |
| `lib/agent/architecture.ts` | Haiku-driven architecture synthesis + schema normalization fallback |
| `lib/agent/connectivityPreflight.ts` | Semantic trace/selector/component/pin validation before compile |
| `lib/agent/tscircuitReference.ts` | Cached diagnostic-targeted snippet extractor from `docs.tscircuit.com/ai.txt` |
| `lib/compile/` | Local tscircuit compiler (`@tscircuit/eval` wrapper + remote fallback) |
| `lib/kicad/` | KiCad conversion, bridge, and review helpers |
| `lib/stream/` | SSE event parsing + React hook |
| `__tests__/` | Integration tests, fixtures, helpers |
| `.github/workflows/` | CI/CD workflows |
| `vitest.config.mts` | Vitest config (path aliases, env loading, forks pool) |

## Commands

| Task | Command |
|------|---------|
| Install | `pnpm install` |
| Dev | `pnpm dev` |
| Build | `pnpm build` |
| Test (unit) | `pnpm test` |
| Test (integration) | `pnpm test:integration` |
| Test (live SDK) | `pnpm test:sdk` |
| Test (everything) | `pnpm test:all` |
| Lint | `pnpm lint` |
| Convex dev | `pnpm convex:dev` |
| Convex deploy | `pnpm convex:deploy` |

## Code Style

- TypeScript strict mode
- Tailwind for styling (no CSS modules)
- App Router conventions (server components by default, `"use client"` when needed)
- Imports: absolute from root (e.g., `@/lib/agent/models`)

## How to Work in This Repo

1. Read `AGENTS.md` (this file) to orient.
2. Check `TODO.md` for current phase and next task.
3. Read the relevant `specs/*.md` for design context.
4. Implement following the spec.
5. Run `pnpm test` and `pnpm lint`.
6. **Update docs before committing** (see below).

## Keeping Docs Current

After any substantive change, update the relevant docs **in the same commit**:

| What changed | Update |
|---|---|
| Task completed or new phase started | `TODO.md` — check off items, add new ones |
| Milestone completed or project status changed | `docs/plans/active/mvp.md` — check off milestones, update "Current State" |
| Architecture change (new panel, new route, data flow) | `docs/architecture.md` — system diagram + data flow |
| Bug fix, quality improvement, or new tests | `docs/quality.md` — adjust grades, update known gaps + score history |
| New file or directory | Repository Map in this file (`AGENTS.md`) |
| New spec or changed spec | `specs/README.md` |

If you're unsure whether a doc needs updating, it probably does. Stale docs are worse than no docs.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key (server-side only) |
| `BLOB_READ_WRITE_TOKEN` | No | Vercel Blob for export artifacts |
| `VERCEL_OIDC_TOKEN` | No | Vercel Sandbox auth token for local/dev |
| `CONVEX_SITE_URL` | No | Convex deployment URL for persistent error memory HTTP actions |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | No | Convex HTTP Actions URL (accepted fallback for persistence) |
| `CIRCUITFORGE_CONVEX_SHARED_SECRET` | No | Shared secret between Next route and Convex HTTP actions |
| `CIRCUITFORGE_COMPILE_VALIDATE_TIMEOUT_MS` | No | Per-attempt compile/validation timeout in milliseconds (default `240000`) |
| `CIRCUITFORGE_CODEGEN_MODEL` | No | Code-writer model selector (`opus` default, `sonnet` for faster/cheaper runs) |
| `CIRCUITFORGE_MAX_REPAIR_ATTEMPTS` | No | Max autonomous repair-loop attempts per run (`6` default in non-test runtime) |
| `CIRCUITFORGE_RETRY_STAGNATION_LIMIT` | No | Consecutive no-progress attempts before stop (`4` default in non-test runtime) |
| `CIRCUITFORGE_SIGNATURE_REPEAT_LIMIT` | No | Repeated diagnostic-signature threshold before stop (`3` default in non-test runtime) |
| `CIRCUITFORGE_AUTOROUTER_STALL_LIMIT` | No | Consecutive autorouter-exhaustion attempts before stop (`4` default in non-test runtime) |
| `CIRCUITFORGE_MAX_STRUCTURAL_REPAIR_ATTEMPTS` | No | Max structural strategy passes (`3` default in non-test runtime) |
| `CIRCUITFORGE_MINOR_BOARD_GROWTH_CAP_PCT` | No | Max board growth cap for targeted congestion relief before structural escalation (`20` default) |
| `CIRCUITFORGE_MINOR_COMPONENT_SHIFT_MM` | No | Max per-pass component movement cap (in mm) for targeted congestion relief (`3` default) |
| `CIRCUITFORGE_MINOR_RELIEF_PASSES` | No | Number of minor targeted congestion-relief passes before escalating to structural spread (`2` default) |
| `CIRCUITFORGE_STATUS_PULSE_MS` | No | Status pulse interval during long generation/validation operations (`8000` default) |
| `CIRCUITFORGE_STRUCTURAL_REPAIR_TRIGGER` | No | Consecutive same-family/no-reduction streak before structural strategy switch (`2` default) |
| `CIRCUITFORGE_ENABLE_CONNECTIVITY_PREFLIGHT` | No | Enable semantic trace/selector/component/pin preflight before compile (`true` default) |
| `CIRCUITFORGE_ENABLE_STRUCTURAL_REPAIR_MODE` | No | Enable stuck-loop structural repair strategies (`true` default) |
| `CIRCUITFORGE_USE_TSCIRCUIT_AI_REFERENCE` | No | Fetch diagnostic-targeted reference snippets from `docs.tscircuit.com/ai.txt` (`true` default; set `false` to disable) |
| `CIRCUITFORGE_STRICT_BOM_AUDIT` | No | Enforce BOM audit on all component designators including passives (`false` default) |
