# CircuitForge

> AI-powered conversational circuit designer. Natural language → manufacturable PCB.

## Repository Map

| Path | What |
|------|------|
| `docs/architecture.md` | System overview, tech stack, data flow |
| `docs/core-beliefs.md` | Agent operating principles |
| `docs/quality.md` | Living quality scorecard |
| `docs/plans/active/` | In-progress execution plans |
| `specs/` | System specifications (see `specs/README.md`) |
| `.agents/workflows/` | Task-specific workflows |
| `app/` | Next.js App Router (pages + API routes) |
| `components/` | React UI components |
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
6. Update `TODO.md` and `docs/quality.md`.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key (server-side only) |
| `BLOB_READ_WRITE_TOKEN` | No | Vercel Blob for export artifacts |
