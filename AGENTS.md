# CircuitForge

> AI-powered conversational circuit designer. Natural language → manufacturable PCB.

## Repository Map

| Path | What |
|------|------|
| `README.md` | Setup, local runbook, and optional Convex persistence guide |
| `docs/architecture.md` | System overview, tech stack, data flow |
| `docs/core-beliefs.md` | Agent operating principles |
| `docs/quality.md` | Living quality scorecard |
| `docs/plans/active/` | In-progress execution plans |
| `docs/plans/completed/` | Archived execution plans and retrospectives |
| `specs/` | System specifications (see `specs/README.md`) |
| `.agents/workflows/` | Task-specific workflows |
| `app/` | Next.js App Router (pages + API routes) |
| `components/` | React UI components |
| `convex/` | Convex schema + HTTP actions for persistent self-learning memory |
| `lib/agent/` | Agent SDK config, prompts, tools, models |
| `lib/stream/` | SSE event parsing + React hook |
| `__tests__/` | Integration tests, fixtures, helpers |
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
