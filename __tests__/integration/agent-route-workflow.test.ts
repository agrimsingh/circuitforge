import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

describe("Agent route — workflow coverage", () => {
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

  it("persists session context and infers implementation phase on later turn", async () => {
    compileMock.mockResolvedValue(CLEAN_VALIDATION);
    queryMock.mockImplementation(() => {
      async function* gen() {
        yield {
          type: "result",
          subtype: "success",
          result: assistantResult(),
          total_cost_usd: 0.003,
        };
      }
      return gen();
    });

    const sessionId = "session-workflow-1";
    const first = await POST(
      makeRequest({
        sessionId,
        phase: "requirements",
        prompt: "Need a battery powered temperature monitor with BLE.",
      }),
    );
    const firstEvents = await consumeSSE(first);
    expect(firstEvents.some((event) => event.type === "requirements_item")).toBe(true);
    expect(
      firstEvents.some(
        (event) => event.type === "phase_entered" && event.phase === "requirements",
      ),
    ).toBe(true);

    const second = await POST(
      makeRequest({
        sessionId,
        prompt: "continue and generate code now",
      }),
    );
    const secondEvents = await consumeSSE(second);
    expect(
      secondEvents.some(
        (event) => event.type === "phase_entered" && event.phase === "implementation",
      ),
    ).toBe(true);
    expect(
      secondEvents.some(
        (event) => event.type === "session_started" && event.sessionId === sessionId,
      ),
    ).toBe(true);
  });

  it("stops retry loop on repeated diagnostics and emits evidence events", async () => {
    const diagnostic = {
      category: "pcb_trace_error",
      message: "Trace overlap near U1 fanout.",
      severity: 8,
      signature: "pcb_trace_error|U1|0,0",
      source: "tscircuit" as const,
    };
    compileMock.mockResolvedValue({
      ...CLEAN_VALIDATION,
      allDiagnostics: [diagnostic],
    });
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
        prompt: "Build a compact MCU board with conservative routing.",
      }),
    );
    const events = await consumeSSE(res);

    const retries = events.filter((event) => event.type === "retry_start");
    expect(retries.length).toBe(3);

    const retryResults = events.filter(
      (event) => event.type === "retry_result",
    );
    const lastRetry = retryResults[retryResults.length - 1];
    expect(lastRetry?.type).toBe("retry_result");
    if (lastRetry?.type === "retry_result") {
      expect(lastRetry.status).toBe("failed");
      expect(["stagnant_signature", "max_attempts"]).toContain(lastRetry.reason);
    }

    expect(events.some((event) => event.type === "iteration_diff")).toBe(true);
    expect(events.some((event) => event.type === "final_summary")).toBe(true);
    expect(events.some((event) => event.type === "timing_metric")).toBe(true);
    expect(events.some((event) => event.type === "done")).toBe(true);
  });
});

