import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetErrorMemoryForTests,
  getAdaptiveGuardrails,
  getErrorMemoryStats,
  recordDiagnosticsSample,
} from "../errorMemory";

describe("errorMemory", () => {
  beforeEach(() => {
    __resetErrorMemoryForTests();
  });

  it("tracks category frequencies across samples", () => {
    recordDiagnosticsSample([
      {
        category: "pcb_trace_error",
        message: "trace overlap",
        signature: "a",
        severity: 5,
      },
    ]);
    recordDiagnosticsSample([
      {
        category: "pcb_trace_error",
        message: "trace overlap",
        signature: "b",
        severity: 5,
      },
      {
        category: "pcb_via_clearance_error",
        message: "via too close",
        signature: "c",
        severity: 6,
      },
    ]);

    const stats = getErrorMemoryStats();
    expect(stats.sampleCount).toBe(2);
    expect(stats.categoryCounts.pcb_trace_error).toBe(2);
    expect(stats.categoryCounts.pcb_via_clearance_error).toBe(1);
  });

  it("returns adaptive guardrails when enough samples exist", () => {
    recordDiagnosticsSample([
      {
        category: "pcb_trace_error",
        message: "trace overlap",
        signature: "a",
        severity: 5,
      },
    ]);
    recordDiagnosticsSample([
      {
        category: "pcb_trace_error",
        message: "trace overlap",
        signature: "b",
        severity: 5,
      },
    ]);

    const guardrails = getAdaptiveGuardrails();
    expect(guardrails).toContain("Adaptive guardrails from recent failed attempts");
    expect(guardrails).toContain("pcb_trace_error");
  });

  it("ignores empty diagnostics samples", () => {
    recordDiagnosticsSample([]);
    const stats = getErrorMemoryStats();
    expect(stats.sampleCount).toBe(0);
    expect(getAdaptiveGuardrails()).toBe("");
  });
});
