# KiCad Integration Specification

## Purpose

Use `circuit-json-to-kicad` for reliable circuit-json→`kicad_sch` conversion, then run KiCad-level review and MCP operations with `kicad-sch-ts`.

## Runtime modules

- `lib/kicad/bridge.ts`
  - lazy-load and cache `circuit-json-to-kicad` first
  - retain last load error for diagnostics
  - use `kicad-sch-ts` as fallback/editing layer

- `lib/kicad/convert.ts`
  - convert circuit JSON to KiCad schema text via `circuit-json-to-kicad`
  - fallback to `kicad-sch-ts` conversion APIs when needed
  - retain deterministic conversion metadata and diagnostics

- `lib/kicad/review.ts`
  - parse `.kicad_sch` output and run `ConnectivityAnalyzer`, `ElectricalRulesChecker`, `BOMPropertyAuditor`
  - convert findings into canonical `ValidationDiagnostic` form
  - return connectivity/traceability metadata from KiCad analysis

## API routes

- `POST /api/kicad/validate`
  - input: `{ tscircuit_code? , circuit_json? }`
  - output: KiCad schema + findings + connectivity + traceability
  - compile from tscircuit code when needed

- `POST /api/kicad/edit`
  - input: `{ kicad_sch: string, edits: Array<{ tool: 'manage_component'|'manage_wire', args: Record<string, unknown> }> }`
  - output: updated `kicad_sch` and MCP operation result log

- `POST /api/export`
  - optional `formatSet` with `kicad` and `reviewBundle`
  - include `kicad_sch` file when `kicad === true`
  - include `kicad_report.json` + `connectivity.json` when `reviewBundle === true`

## Failure handling

- If conversion APIs are missing/unsupported, generate deterministic fallback schematic and report clear reason.
- Preserve export success when diagnostics cannot be fully resolved by attaching structured warning findings.

## Fallback acceptance criteria

- `kicad-sch-ts` import failure returns non-crashing export path.
- `kicadSchema` placeholder always included when conversion fails.
- Conversion failures are reflected in `kicad_report.json` metadata and returned findings.
