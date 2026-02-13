# Completed Plan: Convex Self-Learning Setup

## Purpose
Persist adaptive error-memory across restarts and deployments so retry guardrails improve over time from real failures.

## Scope Delivered
- Added Convex-backed persistence path for error-memory categories.
- Kept in-memory memory as automatic fallback when Convex/env is unavailable.
- Added shared-secret authenticated Convex HTTP actions for:
  - recording failed-attempt categories
  - retrieving adaptive guardrails
- Updated route integration to use persistent reads/writes during retry flow.
- Updated project docs/specs/readme and environment setup guidance.

## Implementation Summary
- Added Convex schema + functions:
  - `convex/schema.ts`
  - `convex/errorMemory.ts`
  - `convex/http.ts`
  - `convex.json`
- Added app-side persistence client:
  - `lib/agent/persistentErrorMemory.ts`
- Wired route:
  - `app/api/agent/route.ts` uses persistent guardrails/recording with fallback.
- Added tests:
  - `lib/agent/__tests__/persistentErrorMemory.test.ts`

## Validation Performed
- Unit tests pass (`pnpm test`)
- Integration tests pass (`pnpm test:integration`)
- Lint passes (`pnpm lint`)
- Next build passes (`pnpm build`)
- Convex one-shot typecheck/deploy pass (`pnpm exec convex dev --once --typecheck=enable`)
- Live smoke checks:
  - `/api/sandbox/quickstart` successful with OIDC auth present
  - `/api/agent` SSE retry telemetry still emitted
  - Convex `/error-memory/record` and `/error-memory/guardrails` authenticated and functional

## Surprises & Discoveries
- Convex env bootstrap wrote `NEXT_PUBLIC_CONVEX_SITE_URL`; app now accepts that as fallback for site URL.
- TypeScript duplicate-property issue in `convex/http.ts` (`ok` key spread overwrite) blocked initial Convex typecheck and was fixed.
- Convex generated files required explicit ESLint ignores (`convex/_generated/**`, `convex/.convex/**`).

## Decisions
- **Use category-level memory, not raw prompt/code persistence**
  - Lower privacy risk and lower storage/token footprint.
- **Secret-authenticated HTTP actions**
  - Prevent unauthenticated writes/reads to learning memory endpoints.
- **Fallback-first reliability**
  - Learning memory remains available in-memory even when Convex is misconfigured or offline.

## Follow-Ups
- Add UI debug indicator: memory source (`convex` vs `in-memory`) + sample count.
- Add periodic decay/cleanup policy tuning based on production traffic.
- Add CI assertion for Convex schema/function lint/typecheck in deploy pipeline.
