# Testing Strategy

## Approach
Three-tier testing pyramid. Unit tests are fast and free. Integration tests hit live external APIs. SDK tests exercise the real Anthropic Agent SDK with live API calls.

## Test Architecture

### Tier 1: Unit Tests (Vitest) — `pnpm test`
Fast, free, no network. Runs in <1s.

| File | Tests | Covers |
|------|-------|--------|
| `lib/stream/__tests__/parseSSE.test.ts` | 9 | SSE chunk parsing, code extraction from markdown |
| `lib/agent/__tests__/models.test.ts` | 3 | Model config constants, claude-* prefix, tier assignment |
| `lib/agent/__tests__/prompt.test.ts` | 12 | System prompt keywords per spec, previousCode construction |
| `lib/agent/__tests__/tools.test.ts` | 2 | MCP server export, tool wiring |

### Tier 2: Integration Tests (Vitest) — `pnpm test:integration`
Hit live external APIs and route handlers. Runs in ~3s.

| File | Tests | Covers |
|------|-------|--------|
| `__tests__/integration/agent-route.test.ts` | 5 | Route validation (400/500), SSE headers, API key check |
| `__tests__/integration/export-route.test.ts` | 9 | Zip generation, gerber/BOM/PNP files, error cases |
| `__tests__/integration/search-parts.test.ts` | 6 | Live jlcsearch API, response shape, package filter |

### Tier 3: Live SDK Tests (standalone) — `pnpm test:sdk`
Real Anthropic API calls. Costs ~$0.10-0.30 per run. Runs in ~3-4 min.

| Suite | Tests | Covers |
|-------|-------|--------|
| Basic connectivity | 3 | API connection, cost/usage info, session init |
| MCP tool invocation | 2 | search_parts via MCP, real LCSC data |
| Subagent delegation | 1 | Orchestrator → parts-scout lifecycle |
| Code generation | 2 | tscircuit board output, component elements |
| previousCode handling | 1 | Iterative design modifications |

## Tools
- **Vitest**: Unit and integration tests (tiers 1 & 2)
- **tsx**: Standalone SDK tests (tier 3) — required because the Agent SDK spawns subprocesses incompatible with vitest's worker thread model

## Key Technical Findings

### Agent SDK + Vitest Incompatibility
The Agent SDK's `query()` spawns a Claude Code subprocess via `child_process.spawn()`. Vitest runs tests in worker threads, which cannot properly manage grandchild processes. SDK tests must run as standalone Node scripts via `tsx`.

### env Option Replaces process.env
The SDK's `env` option in `query()` **replaces** the entire subprocess environment, it does not merge. Passing `env: { ANTHROPIC_API_KEY: key }` strips PATH, causing `spawn node ENOENT`. Fix: `env: { ...process.env, ANTHROPIC_API_KEY: key }`.

### jlcsearch API Is Part-Name Search
The jlcsearch API works with part names/numbers (e.g., "AMS1117-3.3", "ESP32-C3"), not generic keywords (e.g., "resistor" returns empty). Tests must use specific part identifiers.

### SDK Cleanup Race Condition
The Agent SDK has a benign race condition where `ProcessTransport.write()` fires after the subprocess exits. SDK tests suppress this via an `unhandledRejection` handler.

## What We Don't Test
- AI output quality (non-deterministic — we test structure, not content)
- tscircuit rendering (tested by tscircuit team)
- React component rendering (future: Testing Library)
- E2E browser flow (future: Playwright)

## Running Tests
```bash
pnpm test              # unit tests only (<1s)
pnpm test:integration  # integration tests (~3s)
pnpm test:sdk          # live SDK tests (~3-4 min, costs money)
pnpm test:all          # everything
pnpm test:watch        # vitest watch mode
```
