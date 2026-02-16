# Dynamic Repair + Live Endpoint Specification

## Purpose

Improve convergence quality in `POST /api/agent` by adding a deterministic diagnostic handling layer around the current Claude Agent SDK retry loop, with explicit evidence events and endpoint-level verification against live API routes.

## Implementation Status (2026-02-16)

- Implemented in backend (`app/api/agent/route.ts`, `lib/agent/repairLoop.ts`, `lib/kicad/review.ts`) and frontend stream/UI surfaces.
- Verified with integration tests (`agent-route-workflow`, `agent-route-repair`, `agent-route-streaming`) and live endpoint smoke probes.
- Live smoke includes an explicit pin-conflict scenario and fixture-backed prompt selection.

## Scope

- Add deterministic diagnostic handling categories:
  - `auto_fixable`
  - `should_demote`
  - `must_repair`
- Apply handling before retry decisions and prompts.
- Emit structured repair evidence events over SSE.
- Surface repair evidence in workflow UI.
- Validate behavior with integration tests and live endpoint smoke runs.

## Non-Goals

- Replacing Claude Agent SDK orchestration.
- Removing existing compile + KiCad validation pipeline.
- Replacing review/export gate behavior.

## Runtime Contracts

### Diagnostic Family Model

Each `ValidationDiagnostic` may include:

- `family`: normalized diagnostic family label (stable routing key).
- `handling`: deterministic handling decision for current attempt.

### Family Routing Rules

1. `kicad_unconnected_pin`
   - `auto_fixable` for passive/optional context.
   - `must_repair` for active functional pins using message-context heuristics (active ref + functional pin detection).
2. `floating_label`
   - `auto_fixable` for canonical relink patterns.
   - `must_repair` when ambiguous or missing target net.
3. `off_grid`
   - `auto_fixable` when alignment-only and non-functional.
   - `must_repair` when likely to alter connectivity semantics.
4. `kicad_bom_property`
   - `should_demote` (advisory by default).
5. `pin_conflict_warning`
   - `must_repair` always.
6. `duplicate_reference` (power-symbol duplicates)
   - `should_demote` when known non-blocking context.

All unknown families:

- follow default behavior:
  - blocking-like categories => `must_repair`
  - non-blocking categories => `should_demote`

### SSE Evidence Events

Add two events to `SSEEvent`:

1. `repair_plan`
   - payload:
     - `attempt: number`
     - `autoFixableFamilies: string[]`
     - `shouldDemoteFamilies: string[]`
     - `mustRepairFamilies: string[]`
2. `repair_result`
   - payload:
     - `attempt: number`
     - `blockingBefore: number`
     - `blockingAfter: number`
     - `demotedCount: number`
     - `autoFixedCount: number`
     - `revalidated: boolean`
     - `appliedActions: string[]`

### Attempt Loop Integration

For each implementation/review/export attempt:

1. Run existing compile + KiCad validation.
2. Classify diagnostics by family handling rules.
3. Apply deterministic adjustments:
   - demote advisory families,
   - mark auto-fixable families as resolved when safe policy applies,
   - keep must-repair untouched.
4. Emit `repair_plan` and `repair_result`.
5. Use post-handling diagnostics for:
   - gate pass/block,
   - retry scoring/signature,
   - retry prompt diagnostics.
6. Preserve timeout, abort, and max-attempt behavior.

## API Endpoints Under Verification

- `POST /api/agent`
- `POST /api/kicad/validate`
- `POST /api/kicad/edit`
- `POST /api/export`
- `POST /api/manufacturing/jlcpcb-link`

## Implementation Files

- `app/api/agent/route.ts`
  - deterministic router, handling application, evidence emission.
- `lib/kicad/review.ts`
  - normalized family inference for KiCad-derived diagnostics.
- `lib/agent/repairLoop.ts`
  - family metadata propagation for tscircuit and compile diagnostics.
- `lib/stream/types.ts`
  - SSE event and diagnostic contract extension.
- `lib/stream/useAgentStream.ts`
  - client parser/state for repair evidence.
- `components/InfoPanel.tsx`
  - compact repair evidence display.

## Test Plan

### Integration

Add/extend tests to assert:

- deterministic repair stage runs when diagnostics are present,
- `repair_plan` and `repair_result` events are emitted in stream,
- demotion/autofix reduces effective blocking diagnostics when expected,
- retry stop reasons remain valid:
  - `max_attempts`
  - `stagnant_signature`
  - `no_improvement`
- timeout path still emits retry diagnostics and exits cleanly.

### Live Endpoint Smoke

Run against a local running server with real key:

- base route smoke:
  - `/api/kicad/validate`, `/api/kicad/edit`, `/api/export`, `/api/manufacturing/jlcpcb-link`
- agent phase probes:
  - requirements probe
  - implementation probe with repair evidence assertions
  - pin-conflict probe with `PIN_CONFLICT_WARNING` assertions

Implementation probe assertions:

- terminal event is `done`,
- `final_summary` exists,
- `manufacturingReadinessScore >= 70`,
- `blockingDiagnosticsCount === 0`,
- at least one `retry_start`,
- at least one `timing_metric`,
- at least one `repair_plan` and `repair_result`,
- `repair_result.blockingAfter <= repair_result.blockingBefore` for each emitted result.
- pin-conflict probe emits at least one `PIN_CONFLICT_WARNING` category before convergence.

## Operational Inputs

Required:

- `ANTHROPIC_API_KEY`

Common optional controls:

- `CIRCUITFORGE_BASE_URL`
- `CIRCUITFORGE_AGENT_TIMEOUT_MS`
- `CIRCUITFORGE_SMOKE_IMPLEMENTATION`
- `CIRCUITFORGE_SMOKE_PIN_CONFLICT`
- `CIRCUITFORGE_SMOKE_PROMPT_SET`

Prompt sets are loaded from:

- `__tests__/fixtures/live-smoke-prompts.json`

Selection is fail-fast:

- smoke exits with error when `CIRCUITFORGE_SMOKE_PROMPT_SET` does not resolve to a valid fixture entry.

## Acceptance Criteria

1. Deterministic handling events are visible in SSE + UI.
2. Blocking diagnostics converge to zero on successful implementation probe.
3. Existing integration test suites continue to pass.
4. Export gate behavior remains unchanged for unresolved critical findings.
5. Live smoke script passes with repair evidence assertions enabled.
6. Live smoke prompt fixture selection is deterministic and validated at startup.
