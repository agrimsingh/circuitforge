import { describe, expect, it } from "vitest";
import {
  applyTargetedCongestionRelief,
  applyStructuralLayoutSpread,
  applyStructuralTraceRebuild,
  applySourceCodeGuardrails,
  collectPreValidationDiagnostics,
  computeDiagnosticsScore,
  createCompileFailureDiagnostics,
  createDiagnosticsSetSignature,
  extractValidationDiagnostics,
  formatDiagnosticsForPrompt,
} from "../repairLoop";

describe("repairLoop utilities", () => {
  it("extracts pcb error entries from circuit json", () => {
    const diagnostics = extractValidationDiagnostics([
      { type: "source_component", name: "U1" },
      {
        type: "pcb_trace_error",
        error_type: "pcb_trace_error",
        message: "Trace overlap",
        pcb_trace_id: "trace_1",
        center: { x: 10.1234, y: -2.9999 },
      },
    ]);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].category).toBe("pcb_trace_error");
    expect(diagnostics[0].message).toContain("Trace overlap");
    expect(diagnostics[0].signature).toContain("trace_1");
  });

  it("emits pcb_component_out_of_bounds_error when placed bodies exceed board limits", () => {
    const diagnostics = extractValidationDiagnostics([
      {
        type: "source_component",
        source_component_id: "source_component_1",
        name: "U1",
      },
      {
        type: "pcb_board",
        pcb_board_id: "pcb_board_1",
        center: { x: 0, y: 0 },
        width: 10,
        height: 10,
      },
      {
        type: "pcb_component",
        pcb_component_id: "pcb_component_1",
        source_component_id: "source_component_1",
        center: { x: 4.8, y: 0 },
        width: 2,
        height: 2,
      },
    ]);

    expect(diagnostics.some((d) => d.category === "pcb_component_out_of_bounds_error")).toBe(true);
  });

  it("detects missing footprint and chip pinLabels in preflight", () => {
    const diagnostics = collectPreValidationDiagnostics(
      [
        "export default () => (",
        '  <board width="60mm" height="40mm">',
        '    <chip name="U1" />',
        '    <resistor name="R1" resistance="10k" />',
        "  </board>",
        ")",
      ].join("\n"),
    );

    expect(
      diagnostics.some((entry) => entry.category === "pcb_missing_footprint_error" && entry.message.includes("R1")),
    ).toBe(true);
    expect(
      diagnostics.some(
        (entry) => entry.category === "source_failed_to_create_component_error" && entry.message.includes("U1"),
      ),
    ).toBe(true);
  });

  it("detects invalid net names in preflight", () => {
    const diagnostics = collectPreValidationDiagnostics(
      [
        "export default () => (",
        '  <board width="60mm" height="40mm">',
        '    <net name="3V3" />',
        "  </board>",
        ")",
      ].join("\n"),
    );

    expect(
      diagnostics.some((entry) => entry.category === "source_invalid_net_name_error"),
    ).toBe(true);
  });

  it("normalizes invalid net names and removes malformed traces", () => {
    const source = [
      "export default () => (",
      '  <board width="60mm" height="40mm">',
      '    <net name="3V3" />',
      '    <net name="V3V3" />',
      '    <trace from=".U1 > .VDD" to="net.3V3" />',
      '    <trace from=".U1 > .IO1" />',
      '    <trace from=".U1 .IO2" to=".R1 > .pin1" />',
      "  </board>",
      ")",
    ].join("\n");

    const result = applySourceCodeGuardrails(source);

    expect(result.code).toContain('<net name="V3V3" />');
    expect(result.code).toContain('to="net.V3V3"');
    expect(result.code.match(/<net name="V3V3" \/>/g)?.length).toBe(1);
    expect(result.code).not.toContain('<trace from=".U1 > .IO1" />');
    expect(result.code).not.toContain('<trace from=".U1 .IO2" to=".R1 > .pin1" />');
    expect(
      result.actions.includes("normalize_net_name:3V3->V3V3"),
    ).toBe(true);
    expect(
      result.actions.some((action) => action.startsWith("dedupe_net_declaration:")),
    ).toBe(true);
    expect(
      result.actions.some((action) => action.startsWith("remove_malformed_trace:")),
    ).toBe(true);
  });

  it("rebuilds traces from net intent in structural trace mode", () => {
    const source = [
      "export default () => (",
      '  <board width="60mm" height="40mm">',
      '    <chip name="U1" footprint="soic8" pinLabels={{ pin1: "VCC", pin2: "OUT" }} connections={{ OUT: "net.SIGNAL", VCC: "net.VCC" }} />',
      '    <chip name="U2" footprint="soic8" pinLabels={{ pin1: "IN", pin2: "VCC" }} connections={{ IN: "net.SIGNAL", VCC: "net.VCC" }} />',
      '    <trace from=".BROKEN > .x" to=".U2 > .IN" />',
      "  </board>",
      ")",
    ].join("\n");

    const rebuilt = applyStructuralTraceRebuild(source);
    expect(rebuilt.diagnostics).toHaveLength(0);
    expect(rebuilt.code).not.toContain('<trace from=".BROKEN > .x" to=".U2 > .IN" />');
    expect(rebuilt.code).toContain('from=".U1 > .OUT" to=".U2 > .IN"');
    expect(rebuilt.actions.some((entry) => entry.startsWith("rebuild_traces:"))).toBe(true);
  });

  it("emits insufficient-intent diagnostic when trace rebuild is not possible", () => {
    const source = [
      "export default () => (",
      '  <board width="40mm" height="30mm">',
      '    <resistor name="R1" resistance="10k" footprint="0402" />',
      "  </board>",
      ")",
    ].join("\n");

    const rebuilt = applyStructuralTraceRebuild(source);
    expect(rebuilt.diagnostics).toHaveLength(1);
    expect(rebuilt.diagnostics[0].category).toBe("source_trace_rebuild_insufficient_intent");
  });

  it("applies deterministic layout spread transform", () => {
    const source = [
      "export default () => (",
      '  <board width="50mm" height="40mm">',
      '    <resistor name="R1" resistance="10k" footprint="0402" pcbX="10mm" pcbY="-8mm" />',
      "  </board>",
      ")",
    ].join("\n");

    const transformed = applyStructuralLayoutSpread(source);
    expect(transformed.code).toContain('width="60mm"');
    expect(transformed.code).toContain('height="48mm"');
    expect(transformed.code).toContain('pcbX="12mm"');
    expect(transformed.code).toContain('pcbY="-9.6mm"');
  });

  it("applies targeted congestion relief with capped board growth and movement", () => {
    const source = [
      "export default () => (",
      '  <board width="100mm" height="80mm">',
      '    <resistor name="R1" resistance="10k" footprint="0402" pcbX="20mm" pcbY="-10mm" />',
      "  </board>",
      ")",
    ].join("\n");

    const relieved = applyTargetedCongestionRelief(source, {
      boardScale: 1.5,
      maxBoardGrowthPct: 20,
      componentShiftMm: 10,
      componentShiftCapMm: 3,
    });

    expect(relieved.code).toContain('width="120mm"');
    expect(relieved.code).toContain('height="96mm"');
    expect(relieved.code).toContain('pcbX="23mm"');
    expect(relieved.code).toContain('pcbY="-13mm"');
    expect(relieved.actions).toContain("congestion_relief:board_scale_1.2");
    expect(relieved.actions).toContain("congestion_relief:max_move_mm_3");
    expect(relieved.actions).toContain("congestion_relief:components_adjusted_1");
  });

  it("creates compile failure diagnostics", () => {
    const diagnostics = createCompileFailureDiagnostics("Syntax error at line 4");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].category).toBe("compile_error");
    expect(diagnostics[0].severity).toBe(10);
  });

  it("classifies autorouter solver exhaustion as a dedicated compile diagnostic", () => {
    const diagnostics = createCompileFailureDiagnostics(
      "AutorouterError: All solvers failed in hyper solver. Ran out of candidates on connection source_net_2_mst0 (capacity-autorouter@0.0.269)"
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].category).toBe("pcb_autorouter_exhaustion");
    expect(diagnostics[0].family).toBe("pcb_autorouter_exhaustion");
    expect(diagnostics[0].severity).toBe(10);
  });

  it("computes score and set signature deterministically", () => {
    const diagnostics = [
      { category: "a_error", message: "A", severity: 2, signature: "a" },
      { category: "b_error", message: "B", severity: 4, signature: "b" },
    ];

    const score = computeDiagnosticsScore(diagnostics, false);
    expect(score).toBe(600);
    expect(createDiagnosticsSetSignature(diagnostics)).toBe("a||b");
    expect(formatDiagnosticsForPrompt(diagnostics)).toContain("[a_error] A");
  });
});
