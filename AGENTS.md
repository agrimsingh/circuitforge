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
| `lib/export/` | Circuit JSON → manufacturing file conversion |
| `lib/stream/` | SSE event parsing |

## Commands

| Task | Command |
|------|---------|
| Install | `npm install` |
| Dev | `npm run dev` |
| Build | `npm run build` |
| Test | `npm test` |
| Lint | `npm run lint` |

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
5. Run `npm test` and `npm run lint`.
6. Update `TODO.md` and `docs/quality.md`.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key (server-side only) |
| `BLOB_READ_WRITE_TOKEN` | No | Vercel Blob for export artifacts |
