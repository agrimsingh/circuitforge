# Assumptions and Risks

## Current assumptions

1. **API stack assumptions**
   - `ANTHROPIC_API_KEY` remains the primary auth for agent orchestration.
   - `compile.tscircuit.com` remains the fast compile/validation source for tscircuit loop iterations.
   - Node runtime is required for all server-side KiCad and export paths.

2. **Scope assumptions for V2 Phase 0/1**
   - The first implementation validates and emits review findings across all phases where compile is meaningful (`implementation`, `review`, `export`).
   - Requirements and architecture phases are checkpoint-first and do not block progress with compile errors.

3. **KiCad conversion integration assumptions**
   - `circuit-json-to-kicad` is the primary server-side conversion layer.
   - `kicad-sch-ts` is retained as an optional fallback if `circuit-json-to-kicad` is unavailable or missing
     expected API behavior.
   - We still rely on defensive feature detection and runtime fallback because package shapes can vary.

## Conversion module uncertainty risk

**Risk:** public entrypoints can vary by release, and direct conversion calls may fail or degrade.

**Mitigation plan:**

1. Lazy-load and cache the package module (`lib/kicad/bridge.ts`), preferring `circuit-json-to-kicad`.
2. Probe known entrypoint candidates at runtime (`CircuitJsonToKicadSchConverter`, then legacy
   `fromCircuitJson` / `convertCircuitJsonToSchematic` paths).
3. Fall back to a valid, deterministic placeholder `kicad_sch` when conversion fails.
4. Always emit explicit connectivity/traceability metadata and fallback reason in `kicadResult.metadata`.
5. Include all findings and conversion limits in `kicad_report.json`.

## Top risks

- **Prompt drift vs enforced phase behavior**: model can drift from requested phase constraints.
  - Mitigation: phase-specific prompts and explicit checkpoint requirements in stream contracts.
- **Review noise**: too many low-value findings reduce operator trust.
  - Mitigation: severity gating, dedupe, open-state retention.
- **Export drift**: KiCad schema may be generated even with unresolved critical issues.
  - Mitigation: `reviewBundle` + gate event signals and explicit unresolved notes in final response.
- **Flow mismatch with existing v0 artifacts**: existing routes and UI may expect old behavior.
  - Mitigation: preserve existing request/response shape while adding optional fields.

## Review strategy risk (new)

- **Schema-level checker mismatch**: `ElectricalRulesChecker` and `ConnectivityAnalyzer` are strict and may surface additional warnings compared to existing tscircuit-only validation.
  - Mitigation: classify warnings by severity and expose only actionable findings in UX.
- **MCP edit determinism**: tool-based incremental edits rely on shared in-memory MCP state inside `kicad-sch-ts`.
  - Mitigation: execute MCP edits in single request scope, immediately serialize output, and do not persist tool session state across requests.

## Fallback strategy for unresolved conversion

- Provide guaranteed `kicad_sch` placeholder text and include `kicad_schema_missing` / `kicad_converter_*` findings.
- Keep pipeline alive by still shipping a deterministic ZIP with report files and diagnostic traceability.
- Defer strict enforcement of full parity to later phases while preserving user ability to export valid partial artifacts.
