import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consumeSSE, accumulateText } from "../helpers/consumeSSE";

vi.mock("@/lib/agent/tools", () => ({
  circuitforgeTools: {},
}));

vi.mock("@/lib/agent/repairLoop", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent/repairLoop")>();
  return {
    ...actual,
    compileAndValidateWithKicad: vi.fn(async () => ({
      compileResult: {
        ok: true,
        status: 200,
        source: "inline",
        circuitJson: [],
        errorMessage: null,
      },
      kicadResult: { kicadSchema: "(kicad_sch" },
      allDiagnostics: [],
    })),
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

const ASSISTANT_RESULT = [
  "Minimal circuit:",
  "- R1 10k to demonstrate streaming output.",
  "",
  "```tsx",
  "export default () => (",
  '  <board width="50mm" height="40mm">',
  '    <resistor name="R1" resistance="10k" footprint="0402" pcbX="0mm" pcbY="0mm" schX="0mm" schY="0mm" />',
  "  </board>",
  ")",
  "```",
  "",
].join("\n");

describe("Agent route — SSE streaming contract", () => {
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-dummy-key";
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalKey) {
      process.env.ANTHROPIC_API_KEY = originalKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it("still emits text+done even if SDK only provides result.result (no stream text deltas), after many tool calls", async () => {
    queryMock.mockImplementation(({ options }: { options: Record<string, unknown> }) => {
      type HookEntry = { hooks?: Array<(input: unknown) => Promise<unknown>> };
      const hooks = options?.hooks as Record<string, HookEntry[]> | undefined;
      const preHooks: Array<(input: unknown) => Promise<unknown>> =
        hooks?.PreToolUse?.flatMap((entry: HookEntry) => entry?.hooks ?? []) ?? [];
      const postHooks: Array<(input: unknown) => Promise<unknown>> =
        hooks?.PostToolUse?.flatMap((entry: HookEntry) => entry?.hooks ?? []) ?? [];

      async function* gen() {
        // Simulate heavy tool usage emitting hundreds of hook events.
        for (let i = 0; i < 200; i++) {
          for (const hook of preHooks) {
            await hook({
              tool_name: "WebSearch",
              tool_input: { q: `query-${i}` },
            });
          }
          for (const hook of postHooks) {
            await hook({
              tool_name: "WebSearch",
              tool_response: { content: [{ type: "text", text: `ok-${i}` }] },
            });
          }
        }

        // No stream_event text deltas at all; only the final result includes text.
        yield {
          type: "result",
          subtype: "success",
          result: ASSISTANT_RESULT,
          total_cost_usd: 0.0123,
          usage: { input_tokens: 1, output_tokens: 1 },
        };
      }

      return gen();
    });

    const res = await POST(
      makeRequest({
        prompt: "Generate a minimal board with one resistor.",
        phase: "implementation",
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");

    const events = await consumeSSE(res);

    const toolStarts = events.filter((e) => e.type === "tool_start");
    const toolResults = events.filter((e) => e.type === "tool_result");
    expect(toolStarts.length).toBe(200);
    expect(toolResults.length).toBe(200);

    const text = accumulateText(events);
    expect(text.length).toBeGreaterThan(20);
    expect(text).toContain("```tsx");
    expect(text).toContain("<board");

    const done = events.filter((e) => e.type === "done");
    expect(done.length).toBe(1);
    expect(events[events.length - 1]?.type).toBe("done");
  });
});

