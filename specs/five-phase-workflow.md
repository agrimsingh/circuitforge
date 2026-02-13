# Five-Phase Workflow Specification

## Goal

Deliver an explicit, visible lifecycle across requirements → architecture → implementation → review → export.

## Flow and required behaviors

### 1) Requirements
- Route receives request without a trusted design yet.
- Agent may emit `requirements_item` events.
- No hard compile enforcement is required in this phase.

### 2) Architecture
- Agent emits `architecture_block` events reflecting block proposal/resolution.
- UI can show status progression via `phase_block_done`.

### 3) Implementation
- Agent returns or updates tscircuit code in stream text.
- `/api/agent` runs retry loop with compile + KiCad validation feedback.
- Retry telemetry includes `retry_start`, `validation_errors`, `retry_result`.

### 4) Review
- `review_finding` items include severity and phase.
- Client can persist user decisions via `review_decision` and send them on next request.
- Critical findings remain open unless accepted/dismissed.

### 5) Export
- `/api/export` supports `formatSet` controls and optional KiCad/review bundles.
- Export artifacts include traceability metadata when review bundle is requested.

## Event contract
- New canonical SSE events required: `phase_entered`, `phase_progress`, `phase_block_done`, `gate_passed`, `gate_blocked`, `requirements_item`, `architecture_block`, `review_finding`, `review_decision`.

## Milestones

1. Requirements checklist appears after one short prompt.
2. Architecture blocks render in Mermaid panel.
3. Implementation emits retry telemetry and gate pass/block signals.
4. Review findings can be actioned with decision events.
5. Export returns optional `kicad_sch`, `kicad_report.json`, `connectivity.json`.

