import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { getTscircuitReferenceHints } from "../tscircuitReference";
import type { ValidationDiagnostic } from "@/lib/stream/types";

const traceDiagnostic: ValidationDiagnostic = {
  category: "source_trace_not_connected_error",
  message: "Trace is missing from/to endpoint.",
  severity: 9,
  signature: "sig",
  source: "tscircuit",
};

describe("tscircuitReference", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalFlag = process.env.CIRCUITFORGE_USE_TSCIRCUIT_AI_REFERENCE;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.NODE_ENV = "development";
    delete process.env.CIRCUITFORGE_USE_TSCIRCUIT_AI_REFERENCE;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalFlag === undefined) {
      delete process.env.CIRCUITFORGE_USE_TSCIRCUIT_AI_REFERENCE;
    } else {
      process.env.CIRCUITFORGE_USE_TSCIRCUIT_AI_REFERENCE = originalFlag;
    }
  });

  it("returns empty string when diagnostics are not reference-relevant", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await getTscircuitReferenceHints([
      {
        category: "kicad_bom_property",
        message: "R1 missing PartNumber",
        severity: 4,
        signature: "bom",
        source: "kicad",
      },
    ]);
    expect(result).toBe("");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("extracts concise relevant snippets for trace diagnostics", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: async () =>
        [
          "Trace selectors use > syntax.",
          'Example: from=".U1 > .OUT" to=".R1 > .pin1"',
          "Net names should be explicit and stable.",
          "Footprint strings must be valid.",
        ].join("\n"),
    } as Response);

    const result = await getTscircuitReferenceHints([traceDiagnostic]);
    expect(result).toContain("Trace selectors use > syntax.");
    expect(result).toContain("from=");
  });

  it("returns empty string when feature flag disables reference retrieval", async () => {
    process.env.CIRCUITFORGE_USE_TSCIRCUIT_AI_REFERENCE = "false";
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await getTscircuitReferenceHints([traceDiagnostic]);
    expect(result).toBe("");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

