import { describe, expect, it } from "vitest";
import {
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

  it("creates compile failure diagnostics", () => {
    const diagnostics = createCompileFailureDiagnostics("Syntax error at line 4");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].category).toBe("compile_error");
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
