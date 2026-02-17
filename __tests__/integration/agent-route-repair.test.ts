import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SSEEvent } from "@/lib/stream/types";
import { consumeSSE } from "../helpers/consumeSSE";
import { resetSessionStoreForTests } from "@/lib/agent/sessionMemory";

vi.mock("@/lib/agent/tools", () => ({
  circuitforgeTools: {},
}));

const compileMock = vi.fn();

vi.mock("@/lib/agent/repairLoop", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent/repairLoop")>();
  return {
    ...actual,
    compileAndValidateWithKicad: (...args: Parameters<typeof compileMock>) =>
      compileMock(...args),
  };
});

vi.mock("@/lib/agent/persistentErrorMemory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent/persistentErrorMemory")>();
  return {
    ...actual,
    getAdaptiveGuardrailsPersistent: vi.fn(async () => ""),
    recordDiagnosticsSamplePersistent: vi.fn(async () => {}),
  };
});

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
}));

import { query } from "@anthropic-ai/claude-agent-sdk";
import { POST } from "@/app/api/agent/route";

const queryMock = vi.mocked(query);

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function assistantResult(name = "R1") {
  return [
    "Updated circuit.",
    "",
    "```tsx",
    "export default () => (",
    '  <board width="60mm" height="50mm">',
    `    <resistor name="${name}" resistance="10k" footprint="0402" pcbX="0mm" pcbY="0mm" schX="0mm" schY="0mm" />`,
    "  </board>",
    ")",
    "```",
    "",
  ].join("\n");
}

const CLEAN_VALIDATION = {
  compileResult: {
    ok: true,
    status: 200,
    source: "inline" as const,
    circuitJson: [],
    errorMessage: null,
  },
  kicadResult: { kicadSchema: "(kicad_sch\n)" },
  allDiagnostics: [],
};

describe("Agent route — deterministic repair loop", () => {
  let originalKey: string | undefined;

  beforeEach(async () => {
    originalKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-dummy-key";
    vi.clearAllMocks();
    await resetSessionStoreForTests();
  });

  afterEach(() => {
    if (originalKey) process.env.ANTHROPIC_API_KEY = originalKey;
    else delete process.env.ANTHROPIC_API_KEY;
  });

  it("emits repair evidence and applies deterministic handling", async () => {
    const offGrid = {
      category: "OFF_GRID_WARNING",
      message: "Wire segment is off grid by 0.25mil.",
      severity: 7,
      signature: "OFF_GRID_WARNING|wire-1",
      source: "kicad" as const,
      family: "off_grid",
    };
    const missingBom = {
      category: "kicad_bom_property",
      message: "R1 missing required BOM properties: PartNumber",
      severity: 6,
      signature: "kicad_bom_property|R1|PartNumber",
      source: "kicad" as const,
      family: "kicad_bom_property",
    };
    const pinConflict = {
      category: "PIN_CONFLICT_WARNING",
      message: "Pin conflict warning on U1 net VIN",
      severity: 9,
      signature: "PIN_CONFLICT_WARNING|U1|VIN",
      source: "kicad" as const,
      family: "pin_conflict_warning",
    };

    compileMock
      .mockResolvedValueOnce({
        ...CLEAN_VALIDATION,
        allDiagnostics: [offGrid, missingBom, pinConflict],
      })
      .mockResolvedValueOnce({
        ...CLEAN_VALIDATION,
        allDiagnostics: [pinConflict],
      })
      .mockResolvedValueOnce(CLEAN_VALIDATION);

    queryMock.mockImplementation(() => {
      async function* gen() {
        yield {
          type: "result",
          subtype: "success",
          result: assistantResult("R2"),
          total_cost_usd: 0.004,
        };
      }
      return gen();
    });

    const res = await POST(
      makeRequest({
        phase: "implementation",
        prompt: "Design a compact regulator board and fix all critical routing issues.",
      }),
    );
    const events = await consumeSSE(res);

    const repairPlans = events.filter(
      (event): event is Extract<SSEEvent, { type: "repair_plan" }> => event.type === "repair_plan",
    );
    const repairResults = events.filter(
      (event): event is Extract<SSEEvent, { type: "repair_result" }> =>
        event.type === "repair_result",
    );
    const reviewDecisions = events.filter(
      (event): event is Extract<SSEEvent, { type: "review_decision" }> =>
        event.type === "review_decision",
    );

    expect(repairPlans.length).toBeGreaterThan(0);
    expect(repairResults.length).toBeGreaterThan(0);
    expect(repairResults.some((event) => event.result.autoFixedCount > 0)).toBe(true);
    expect(repairResults.some((event) => event.result.demotedCount > 0)).toBe(true);
    expect(repairResults.every((event) => event.result.revalidated === false)).toBe(true);
    expect(repairResults.every((event) => event.result.blockingAfter <= event.result.blockingBefore)).toBe(true);
    expect(
      reviewDecisions.some(
        (event) =>
          event.decision.decision === "dismiss" &&
          event.decision.findingId.includes("PIN_CONFLICT_WARNING"),
      ),
    ).toBe(true);
    expect(events.some((event) => event.type === "final_summary")).toBe(true);
    expect(events.some((event) => event.type === "done")).toBe(true);
    expect(compileMock).toHaveBeenCalledTimes(3);
  });

  it("converts timeout-like failures into retry diagnostics and stops with valid reason", async () => {
    queryMock.mockImplementation(() => {
      async function* gen() {
        throw new DOMException("attempt timeout", "TimeoutError");
      }
      return gen();
    });

    const res = await POST(
      makeRequest({
        phase: "implementation",
        prompt: "Generate an implementation and recover from timeout faults.",
      }),
    );
    const events = await consumeSSE(res);

    const retries = events.filter((event) => event.type === "retry_start");
    const validationErrors = events.filter(
      (event): event is Extract<SSEEvent, { type: "validation_errors" }> =>
        event.type === "validation_errors",
    );
    const repairResults = events.filter(
      (event): event is Extract<SSEEvent, { type: "repair_result" }> =>
        event.type === "repair_result",
    );
    const retryResults = events.filter(
      (event): event is Extract<SSEEvent, { type: "retry_result" }> => event.type === "retry_result",
    );
    const lastRetryResult = retryResults[retryResults.length - 1];

    expect(retries.length).toBe(3);
    expect(validationErrors.length).toBeGreaterThan(0);
    expect(
      validationErrors.every((event) =>
        event.diagnostics.some((diagnostic) => diagnostic.category === "attempt_timeout"),
      ),
    ).toBe(true);
    expect(repairResults.length).toBe(3);
    expect(lastRetryResult?.status).toBe("failed");
    expect(lastRetryResult?.reason).toBe("max_attempts");
    expect(compileMock).not.toHaveBeenCalled();
    expect(events.some((event) => event.type === "done")).toBe(true);
  });

  it("converts compile/validation timeouts into retry diagnostics", async () => {
    compileMock.mockRejectedValue(new DOMException("validation timed out", "TimeoutError"));
    queryMock.mockImplementation(() => {
      async function* gen() {
        yield {
          type: "result",
          subtype: "success",
          result: assistantResult("R3"),
          total_cost_usd: 0.004,
        };
      }
      return gen();
    });

    const res = await POST(
      makeRequest({
        phase: "implementation",
        prompt: "Generate board code and recover from compile validation timeout failures.",
      }),
    );
    const events = await consumeSSE(res);

    const validationErrors = events.filter(
      (event): event is Extract<SSEEvent, { type: "validation_errors" }> =>
        event.type === "validation_errors",
    );
    const retries = events.filter((event) => event.type === "retry_start");
    const retryResults = events.filter(
      (event): event is Extract<SSEEvent, { type: "retry_result" }> => event.type === "retry_result",
    );
    const lastRetryResult = retryResults[retryResults.length - 1];

    expect(retries.length).toBe(3);
    expect(validationErrors.length).toBeGreaterThan(0);
    expect(
      validationErrors.every((event) =>
        event.diagnostics.some((diagnostic) => diagnostic.category === "compile_validate_timeout"),
      ),
    ).toBe(true);
    expect(lastRetryResult?.status).toBe("failed");
    expect(lastRetryResult?.reason).toBe("max_attempts");
    expect(compileMock).toHaveBeenCalledTimes(3);
    expect(events.some((event) => event.type === "done")).toBe(true);
  });

  it("demotes low-signal pin conflicts to non-blocking info findings", async () => {
    const lowSignalPinConflict = {
      category: "PIN_CONFLICT_WARNING",
      message: "ERC_PIN_CONFLICT_WARNING: Pin conflict on net Net12: unspecified connected to unspecified",
      severity: 9,
      signature: "PIN_CONFLICT_WARNING|Net12|unspecified",
      source: "kicad" as const,
      family: "pin_conflict_low_signal",
    };

    compileMock.mockResolvedValueOnce({
      ...CLEAN_VALIDATION,
      allDiagnostics: [lowSignalPinConflict],
    });

    queryMock.mockImplementation(() => {
      async function* gen() {
        yield {
          type: "result",
          subtype: "success",
          result: assistantResult("R4"),
          total_cost_usd: 0.004,
        };
      }
      return gen();
    });

    const res = await POST(
      makeRequest({
        phase: "implementation",
        prompt: "Repair low-signal pin conflicts without changing intended behavior.",
      }),
    );
    const events = await consumeSSE(res);
    const findings = events.filter(
      (event): event is Extract<SSEEvent, { type: "review_finding" }> => event.type === "review_finding",
    );

    expect(findings.some((event) => event.finding.category === "PIN_CONFLICT_WARNING")).toBe(true);
    expect(
      findings.some(
        (event) =>
          event.finding.category === "PIN_CONFLICT_WARNING" &&
          event.finding.severity === "info" &&
          event.finding.isBlocking === false,
      ),
    ).toBe(true);
  });

  it("dedupes volatile duplicate references and auto-dismisses advisory findings", async () => {
    const duplicatePowerRefA = {
      category: "DUPLICATE_REFERENCE",
      message:
        "ERC DUPLICATE_REFERENCE: Duplicate reference designator: V3V3 (573d1857-7e01-475a-8d69-c7442381e3dd)",
      severity: 7,
      signature:
        "DUPLICATE_REFERENCE|ERC DUPLICATE_REFERENCE: Duplicate reference designator: V3V3 (573d1857-7e01-475a-8d69-c7442381e3dd)",
      source: "kicad" as const,
      family: "duplicate_reference",
    };
    const duplicatePowerRefB = {
      category: "DUPLICATE_REFERENCE",
      message:
        "ERC DUPLICATE_REFERENCE: Duplicate reference designator: V3V3 (62da3be9-4169-4eb2-a04c-ab9073349e53)",
      severity: 7,
      signature:
        "DUPLICATE_REFERENCE|ERC DUPLICATE_REFERENCE: Duplicate reference designator: V3V3 (62da3be9-4169-4eb2-a04c-ab9073349e53)",
      source: "kicad" as const,
      family: "duplicate_reference",
    };
    const bomWarning = {
      category: "kicad_bom_property",
      message: "R1 missing required BOM properties: PartNumber, Manufacturer",
      severity: 6,
      signature: "kicad_bom_property|R1|PartNumber,Manufacturer",
      source: "kicad" as const,
      family: "kicad_bom_property",
    };
    const lowSignalPinConflict = {
      category: "PIN_CONFLICT_WARNING",
      message:
        "ERC_PIN_CONFLICT_WARNING: Pin conflict on net Net9: unspecified connected to unspecified",
      severity: 9,
      signature: "PIN_CONFLICT_WARNING|Net9|unspecified",
      source: "kicad" as const,
      family: "pin_conflict_low_signal",
    };

    compileMock.mockResolvedValueOnce({
      ...CLEAN_VALIDATION,
      allDiagnostics: [duplicatePowerRefA, duplicatePowerRefB, bomWarning, lowSignalPinConflict],
    });

    queryMock.mockImplementation(() => {
      async function* gen() {
        yield {
          type: "result",
          subtype: "success",
          result: assistantResult("R8"),
          total_cost_usd: 0.004,
        };
      }
      return gen();
    });

    const res = await POST(
      makeRequest({
        phase: "implementation",
        prompt: "Run repair and stabilize recurring advisory KiCad findings.",
      }),
    );
    const events = await consumeSSE(res);
    const findings = events.filter(
      (event): event is Extract<SSEEvent, { type: "review_finding" }> => event.type === "review_finding",
    );
    const dismissals = events.filter(
      (event): event is Extract<SSEEvent, { type: "review_decision" }> =>
        event.type === "review_decision" && event.decision.decision === "dismiss",
    );

    const duplicateReferenceFindings = findings.filter(
      (event) => event.finding.category === "DUPLICATE_REFERENCE",
    );
    expect(duplicateReferenceFindings).toHaveLength(0);
    expect(
      dismissals.some((event) => event.decision.findingId.includes("kicad_bom_property|R1")),
    ).toBe(true);
    expect(
      dismissals.some((event) => event.decision.findingId.includes("pin_conflict_low_signal")),
    ).toBe(true);
    expect(compileMock).toHaveBeenCalledTimes(1);
  });

  it("stops early when autorouter exhaustion repeats", async () => {
    const autorouterExhaustion = {
      category: "pcb_autorouter_exhaustion",
      message:
        "AutorouterError: All solvers failed in hyper solver. Ran out of candidates.",
      severity: 10,
      signature: "pcb_autorouter_exhaustion|same",
      source: "tscircuit" as const,
      family: "pcb_autorouter_exhaustion",
    };

    compileMock
      .mockResolvedValueOnce({
        ...CLEAN_VALIDATION,
        compileResult: {
          ...CLEAN_VALIDATION.compileResult,
          ok: false,
          errorMessage: autorouterExhaustion.message,
        },
        allDiagnostics: [autorouterExhaustion],
      })
      .mockResolvedValueOnce({
        ...CLEAN_VALIDATION,
        compileResult: {
          ...CLEAN_VALIDATION.compileResult,
          ok: false,
          errorMessage: autorouterExhaustion.message,
        },
        allDiagnostics: [autorouterExhaustion],
      })
      .mockResolvedValueOnce({
        ...CLEAN_VALIDATION,
        compileResult: {
          ...CLEAN_VALIDATION.compileResult,
          ok: false,
          errorMessage: autorouterExhaustion.message,
        },
        allDiagnostics: [autorouterExhaustion],
      });

    queryMock.mockImplementation(() => {
      async function* gen() {
        yield {
          type: "result",
          subtype: "success",
          result: assistantResult("R5"),
          total_cost_usd: 0.004,
        };
      }
      return gen();
    });

    const res = await POST(
      makeRequest({
        phase: "implementation",
        prompt: "Repair this dense board and resolve autorouter failures.",
      }),
    );
    const events = await consumeSSE(res);

    const retryResults = events.filter(
      (event): event is Extract<SSEEvent, { type: "retry_result" }> => event.type === "retry_result",
    );
    const repairPlans = events.filter(
      (event): event is Extract<SSEEvent, { type: "repair_plan" }> => event.type === "repair_plan",
    );
    const lastRetryResult = retryResults[retryResults.length - 1];
    const textEvents = events.filter(
      (event): event is Extract<SSEEvent, { type: "text" }> => event.type === "text",
    );
    const finalText = textEvents[textEvents.length - 1]?.content ?? "";

    expect(lastRetryResult?.status).toBe("failed");
    expect(lastRetryResult?.reason).toBe("autorouter_exhaustion");
    expect(repairPlans.some((plan) => plan.plan.strategy === "targeted_congestion_relief")).toBe(true);
    expect(finalText).toContain("Generated a candidate circuit, but validation is still blocked.");
    expect(finalText).toContain("```tsx");
    expect(compileMock).toHaveBeenCalledTimes(3);
  });

  it("treats pcb_autorouting_error as autorouter exhaustion for early stop", async () => {
    const autoroutingError = {
      category: "pcb_autorouting_error",
      message:
        "Failed to solve 1 nodes, cmn_5. err0: All solvers failed in hyper solver. Ran out of candidate nodes to explore. (capacity-autorouter@0.0.269)",
      severity: 10,
      signature: "pcb_autorouting_error|same",
      source: "tscircuit" as const,
      family: "pcb_autorouting_error",
    };

    compileMock
      .mockResolvedValueOnce({
        ...CLEAN_VALIDATION,
        compileResult: {
          ...CLEAN_VALIDATION.compileResult,
          ok: false,
          errorMessage: autoroutingError.message,
        },
        allDiagnostics: [autoroutingError],
      })
      .mockResolvedValueOnce({
        ...CLEAN_VALIDATION,
        compileResult: {
          ...CLEAN_VALIDATION.compileResult,
          ok: false,
          errorMessage: autoroutingError.message,
        },
        allDiagnostics: [autoroutingError],
      })
      .mockResolvedValueOnce({
        ...CLEAN_VALIDATION,
        compileResult: {
          ...CLEAN_VALIDATION.compileResult,
          ok: false,
          errorMessage: autoroutingError.message,
        },
        allDiagnostics: [autoroutingError],
      });

    queryMock.mockImplementation(() => {
      async function* gen() {
        yield {
          type: "result",
          subtype: "success",
          result: assistantResult("R5A"),
          total_cost_usd: 0.004,
        };
      }
      return gen();
    });

    const res = await POST(
      makeRequest({
        phase: "implementation",
        prompt: "Repair this dense board and resolve autorouter failures.",
      }),
    );
    const events = await consumeSSE(res);

    const retryResults = events.filter(
      (event): event is Extract<SSEEvent, { type: "retry_result" }> => event.type === "retry_result",
    );
    const lastRetryResult = retryResults[retryResults.length - 1];

    expect(lastRetryResult?.status).toBe("failed");
    expect(lastRetryResult?.reason).toBe("autorouter_exhaustion");
    expect(compileMock).toHaveBeenCalledTimes(3);
  });

  it("switches to structural trace rebuild strategy for repeated source_trace blockers", async () => {
    const traceMissingEndpoint = {
      category: "source_trace_missing_endpoint",
      message: "Trace is missing from/to endpoint.",
      severity: 9,
      signature: "source_trace_missing_endpoint|same",
      source: "tscircuit" as const,
      family: "source_trace_missing_endpoint",
    };

    compileMock
      .mockResolvedValueOnce({ ...CLEAN_VALIDATION, allDiagnostics: [traceMissingEndpoint] })
      .mockResolvedValueOnce({ ...CLEAN_VALIDATION, allDiagnostics: [traceMissingEndpoint] })
      .mockResolvedValueOnce({ ...CLEAN_VALIDATION, allDiagnostics: [traceMissingEndpoint] });

    queryMock.mockImplementation(() => {
      async function* gen() {
        yield {
          type: "result",
          subtype: "success",
          result: assistantResult("R6"),
          total_cost_usd: 0.004,
        };
      }
      return gen();
    });

    const res = await POST(
      makeRequest({
        phase: "implementation",
        prompt: "Repair broken traces and ensure endpoint validity.",
      }),
    );
    const events = await consumeSSE(res);

    const repairPlans = events.filter(
      (event): event is Extract<SSEEvent, { type: "repair_plan" }> => event.type === "repair_plan",
    );
    const retryResults = events.filter(
      (event): event is Extract<SSEEvent, { type: "retry_result" }> => event.type === "retry_result",
    );
    const finalRetry = retryResults[retryResults.length - 1];
    const textEvents = events.filter(
      (event): event is Extract<SSEEvent, { type: "text" }> => event.type === "text",
    );
    const finalText = textEvents[textEvents.length - 1]?.content ?? "";

    expect(repairPlans.some((plan) => plan.plan.strategy === "structural_trace_rebuild")).toBe(true);
    expect(finalRetry?.reason).toBe("structural_repair_exhausted");
    expect(finalText).toContain("Stop reason: structural_repair_exhausted.");
    expect(finalText).toContain("[source_trace_missing_endpoint] x");
  });

  it("switches to targeted congestion relief strategy for repeated DRC congestion blockers", async () => {
    const viaClearance = {
      category: "pcb_via_clearance_error",
      message: "Clearance violation between vias",
      severity: 9,
      signature: "pcb_via_clearance_error|same",
      source: "tscircuit" as const,
      family: "pcb_via_clearance_error",
    };

    compileMock
      .mockResolvedValueOnce({ ...CLEAN_VALIDATION, allDiagnostics: [viaClearance] })
      .mockResolvedValueOnce({ ...CLEAN_VALIDATION, allDiagnostics: [viaClearance] })
      .mockResolvedValueOnce({ ...CLEAN_VALIDATION, allDiagnostics: [viaClearance] });

    queryMock.mockImplementation(() => {
      async function* gen() {
        yield {
          type: "result",
          subtype: "success",
          result: assistantResult("R7"),
          total_cost_usd: 0.004,
        };
      }
      return gen();
    });

    const res = await POST(
      makeRequest({
        phase: "implementation",
        prompt: "Reduce routing congestion and clear via spacing violations.",
      }),
    );
    const events = await consumeSSE(res);
    const repairPlans = events.filter(
      (event): event is Extract<SSEEvent, { type: "repair_plan" }> => event.type === "repair_plan",
    );

    expect(repairPlans.some((plan) => plan.plan.strategy === "targeted_congestion_relief")).toBe(true);
  });

  it("treats pcb_component_out_of_bounds_error as blocking layout congestion", async () => {
    const outOfBounds = {
      category: "pcb_component_out_of_bounds_error",
      message: "U1 extends outside board boundary.",
      severity: 6,
      signature: "pcb_component_out_of_bounds_error|U1",
      source: "tscircuit" as const,
      family: "pcb_component_out_of_bounds_error",
    };

    compileMock
      .mockResolvedValueOnce({ ...CLEAN_VALIDATION, allDiagnostics: [outOfBounds] })
      .mockResolvedValueOnce({ ...CLEAN_VALIDATION, allDiagnostics: [outOfBounds] })
      .mockResolvedValueOnce({ ...CLEAN_VALIDATION, allDiagnostics: [outOfBounds] });

    queryMock.mockImplementation(() => {
      async function* gen() {
        yield {
          type: "result",
          subtype: "success",
          result: assistantResult("R8"),
          total_cost_usd: 0.004,
        };
      }
      return gen();
    });

    const res = await POST(
      makeRequest({
        phase: "implementation",
        prompt: "Fix board fit so all components are inside board edges.",
      }),
    );
    const events = await consumeSSE(res);
    const repairPlans = events.filter(
      (event): event is Extract<SSEEvent, { type: "repair_plan" }> => event.type === "repair_plan",
    );

    expect(repairPlans.some((plan) => plan.plan.strategy === "targeted_congestion_relief")).toBe(true);
  });

  it("runs two targeted congestion passes before escalating to structural layout spread", async () => {
    const viaClearance = {
      category: "pcb_via_clearance_error",
      message: "Clearance violation between vias",
      severity: 9,
      signature: "pcb_via_clearance_error|same",
      source: "tscircuit" as const,
      family: "pcb_via_clearance_error",
    };

    const previousMaxAttempts = process.env.CIRCUITFORGE_MAX_REPAIR_ATTEMPTS;
    const previousMinorPasses = process.env.CIRCUITFORGE_MINOR_RELIEF_PASSES;
    const previousAutorouterLimit = process.env.CIRCUITFORGE_AUTOROUTER_STALL_LIMIT;
    const previousStagnationLimit = process.env.CIRCUITFORGE_RETRY_STAGNATION_LIMIT;
    const previousSignatureLimit = process.env.CIRCUITFORGE_SIGNATURE_REPEAT_LIMIT;
    process.env.CIRCUITFORGE_MAX_REPAIR_ATTEMPTS = "5";
    process.env.CIRCUITFORGE_MINOR_RELIEF_PASSES = "2";
    process.env.CIRCUITFORGE_AUTOROUTER_STALL_LIMIT = "12";
    process.env.CIRCUITFORGE_RETRY_STAGNATION_LIMIT = "10";
    process.env.CIRCUITFORGE_SIGNATURE_REPEAT_LIMIT = "10";

    try {
      compileMock
        .mockResolvedValueOnce({ ...CLEAN_VALIDATION, allDiagnostics: [viaClearance] })
        .mockResolvedValueOnce({ ...CLEAN_VALIDATION, allDiagnostics: [viaClearance] })
        .mockResolvedValueOnce({ ...CLEAN_VALIDATION, allDiagnostics: [viaClearance] })
        .mockResolvedValueOnce({ ...CLEAN_VALIDATION, allDiagnostics: [viaClearance] })
        .mockResolvedValueOnce({ ...CLEAN_VALIDATION, allDiagnostics: [viaClearance] });

      queryMock.mockImplementation(() => {
        async function* gen() {
          yield {
            type: "result",
            subtype: "success",
            result: assistantResult("R9"),
            total_cost_usd: 0.004,
          };
        }
        return gen();
      });

      const res = await POST(
        makeRequest({
          phase: "implementation",
          prompt: "Resolve dense routing congestion with minimal layout changes first.",
        }),
      );
      const events = await consumeSSE(res);
      const repairPlans = events.filter(
        (event): event is Extract<SSEEvent, { type: "repair_plan" }> => event.type === "repair_plan",
      );

      const strategies = repairPlans.map((plan) => plan.plan.strategy ?? "normal");
      const targetedCount = strategies.filter(
        (strategy) => strategy === "targeted_congestion_relief",
      ).length;
      const firstStructuralIndex = strategies.findIndex(
        (strategy) => strategy === "structural_layout_spread",
      );
      const secondTargetedIndex = strategies
        .map((strategy, index) => ({ strategy, index }))
        .filter((entry) => entry.strategy === "targeted_congestion_relief")[1]?.index ?? -1;

      expect(targetedCount).toBe(2);
      expect(firstStructuralIndex).toBeGreaterThan(secondTargetedIndex);
      expect(compileMock).toHaveBeenCalledTimes(5);
    } finally {
      if (previousMaxAttempts === undefined) {
        delete process.env.CIRCUITFORGE_MAX_REPAIR_ATTEMPTS;
      } else {
        process.env.CIRCUITFORGE_MAX_REPAIR_ATTEMPTS = previousMaxAttempts;
      }
      if (previousMinorPasses === undefined) {
        delete process.env.CIRCUITFORGE_MINOR_RELIEF_PASSES;
      } else {
        process.env.CIRCUITFORGE_MINOR_RELIEF_PASSES = previousMinorPasses;
      }
      if (previousAutorouterLimit === undefined) {
        delete process.env.CIRCUITFORGE_AUTOROUTER_STALL_LIMIT;
      } else {
        process.env.CIRCUITFORGE_AUTOROUTER_STALL_LIMIT = previousAutorouterLimit;
      }
      if (previousStagnationLimit === undefined) {
        delete process.env.CIRCUITFORGE_RETRY_STAGNATION_LIMIT;
      } else {
        process.env.CIRCUITFORGE_RETRY_STAGNATION_LIMIT = previousStagnationLimit;
      }
      if (previousSignatureLimit === undefined) {
        delete process.env.CIRCUITFORGE_SIGNATURE_REPEAT_LIMIT;
      } else {
        process.env.CIRCUITFORGE_SIGNATURE_REPEAT_LIMIT = previousSignatureLimit;
      }
    }
  });
});
