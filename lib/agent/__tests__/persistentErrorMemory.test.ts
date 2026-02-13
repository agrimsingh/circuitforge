import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetErrorMemoryForTests } from "../errorMemory";
import {
  getAdaptiveGuardrailsPersistent,
  recordDiagnosticsSamplePersistent,
} from "../persistentErrorMemory";

const originalEnv = {
  CONVEX_SITE_URL: process.env.CONVEX_SITE_URL,
  CIRCUITFORGE_CONVEX_SHARED_SECRET: process.env.CIRCUITFORGE_CONVEX_SHARED_SECRET,
};

describe("persistentErrorMemory", () => {
  beforeEach(() => {
    __resetErrorMemoryForTests();
    delete process.env.CONVEX_SITE_URL;
    delete process.env.CIRCUITFORGE_CONVEX_SHARED_SECRET;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env.CONVEX_SITE_URL = originalEnv.CONVEX_SITE_URL;
    process.env.CIRCUITFORGE_CONVEX_SHARED_SECRET =
      originalEnv.CIRCUITFORGE_CONVEX_SHARED_SECRET;
  });

  it("falls back to in-memory guardrails when Convex is not configured", async () => {
    await recordDiagnosticsSamplePersistent([
      { category: "pcb_trace_error", message: "m1", signature: "s1", severity: 5 },
    ]);
    await recordDiagnosticsSamplePersistent([
      { category: "pcb_trace_error", message: "m2", signature: "s2", severity: 5 },
    ]);

    const guardrails = await getAdaptiveGuardrailsPersistent();
    expect(guardrails).toContain("Adaptive guardrails");
    expect(guardrails).toContain("pcb_trace_error");
  });

  it("uses Convex response when configured and available", async () => {
    process.env.CONVEX_SITE_URL = "https://example.convex.site";
    process.env.CIRCUITFORGE_CONVEX_SHARED_SECRET = "secret";

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true, guardrails: "from-convex" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

    const guardrails = await getAdaptiveGuardrailsPersistent();
    expect(guardrails).toBe("from-convex");
    expect(fetchMock).toHaveBeenCalled();
  });
});
