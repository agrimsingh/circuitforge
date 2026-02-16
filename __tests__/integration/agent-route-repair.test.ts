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
});
