# CircuitForge V2 Feature Notes

## Core Product Shape

CircuitForge V2 is a **browser-first AI engineering environment** for PCB design where humans stay in control at each phase and every phase must be explainable and reviewable.

## Five Phases (Execution Model)

### 1) Requirements
- **Goal**: turn a loose prompt into structured, testable constraints.
- **Outputs**:
  - Confirmed requirement rows (`requirements_item`)
  - Phase checkpoint emitted as `phase_entered` / `phase_progress`
- **Proof surface**: checklist in `InfoPanel` and accumulated requirement stream.

### 2) Architecture
- **Goal**: derive a block graph before emitting final board-level implementation.
- **Outputs**:
  - `architecture_block` events with status
  - Mermaid diagram + block metadata in `ArchitecturePanel`
- **Proof surface**: architecture timeline and block-level status.

### 3) Implementation
- **Goal**: generate complete tscircuit code and keep it iteratively validated.
- **Outputs**:
  - code stream (`text`), tool traces, retry telemetry
  - `validation_errors`, `retry_start`, `retry_result`
  - `phase_block_done` and gate events after compile checks
- **Proof surface**: runframe output + stream logs + telemetry.

### 4) Review
- **Goal**: elevate review quality with explicit KiCad-backed signals.
- **Outputs**:
  - `review_finding` cards with severity and phase
  - accept/dismiss decisions persisted via `review_decision`
- **Validation layer**: parse generated `.kicad_sch` and run `ConnectivityAnalyzer`, `ElectricalRulesChecker`, and `BOMPropertyAuditor` on the KiCad output (not just tscircuit source errors).
- **Proof surface**: per-finding action panel and updated finding statuses.
- **Targeted edits**: use kicad-sch-ts MCP tools for surgical operations (e.g., `manage_component`, `manage_wire`) so revisions can be incremental instead of full regenerations.

### 5) Export
- **Goal**: export stable manufacturing artifacts.
- **Outputs**:
  - Gerbers/BOM/PNP from existing stack
  - optional KiCad path via `kicad_sch`
  - optional review bundle: `kicad_report.json`, `connectivity.json`
- **Proof surface**: `/api/export` formatSet flags and generated ZIP contents.

## Public differentiators vs competitors

1. **Not just generation — it’s orchestration**
   - phase events, checkpoints, and explicit handoffs.
2. **Web-native preview + KiCad-backed realism**
   - tscircuit for speed, kicad-sch-ts for fidelity.
3. **Human-critical decisions are first-class**
   - decisions are structured and transmitted back to the orchestrator.
4. **Manufacturing-oriented review**
   - review bundle and KiCad outputs are bundled by default in export path.

## Demo narrative (5-10 minutes)

- Start with a novice prompt and show requirement extraction.
- Move into architecture and show Mermaid/architecture state.
- Implement with a visible retry on first DRC/compile issues.
- Enter review and accept/dismiss at least one finding.
- Export with `formatSet={kicad: true, reviewBundle: true}` and show included artifacts.

## Acceptance criteria for Phase 1 milestone

- Stable phase stream in UI (`phase_entered`, `phase_progress`, `phase_block_done`).
- Requirements + architecture events captured and rendered.
- Validation loop returns gate decisions and retry telemetry.
- Export succeeds with KiCad schema + review bundle when requested.
- CI runs `pnpm test` and `pnpm test:integration` on pull requests.
