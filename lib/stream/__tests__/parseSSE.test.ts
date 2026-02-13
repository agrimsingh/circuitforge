import { describe, it, expect } from "vitest";
import type { SSEEvent } from "../types";

/**
 * Minimal SSE parser matching the logic in useAgentStream.
 * Extracted here so it's testable without React.
 */
function parseSSEChunk(raw: string): SSEEvent[] {
  const events: SSEEvent[] = [];
  const lines = raw.split("\n");
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const json = line.slice(6);
    if (!json) continue;
    try {
      events.push(JSON.parse(json));
    } catch {
      // skip malformed
    }
  }
  return events;
}

/**
 * Extract code from accumulated text — same logic as useAgentStream.
 */
function extractCodeFromText(text: string): string | null {
  const codeBlockRegex = /```tsx\n([\s\S]*?)```/g;
  let lastMatch: string | null = null;
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    lastMatch = match[1].trim();
  }
  return lastMatch;
}

describe("SSE parser", () => {
  it("parses a single text event", () => {
    const raw = `data: {"type":"text","content":"hello"}\n\n`;
    const events = parseSSEChunk(raw);
    expect(events).toEqual([{ type: "text", content: "hello" }]);
  });

  it("parses multiple events in one chunk", () => {
    const raw = [
      `data: {"type":"text","content":"A"}`,
      `data: {"type":"tool_start","tool":"search_parts","input":{"q":"ESP32"}}`,
      `data: {"type":"done","usage":{}}`,
      "",
    ].join("\n");

    const events = parseSSEChunk(raw);
    expect(events).toHaveLength(3);
    expect(events[0].type).toBe("text");
    expect(events[1].type).toBe("tool_start");
    expect(events[2].type).toBe("done");
  });

  it("skips malformed JSON lines", () => {
    const raw = `data: {not valid json}\ndata: {"type":"text","content":"ok"}\n`;
    const events = parseSSEChunk(raw);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "text", content: "ok" });
  });

  it("ignores non-data lines", () => {
    const raw = `: comment\nevent: custom\ndata: {"type":"text","content":"x"}\n`;
    const events = parseSSEChunk(raw);
    expect(events).toHaveLength(1);
  });

  it("parses error events", () => {
    const raw = `data: {"type":"error","message":"Something broke"}\n`;
    const events = parseSSEChunk(raw);
    expect(events).toEqual([{ type: "error", message: "Something broke" }]);
  });

  it("parses review and phase events", () => {
    const raw = [
      `data: {"type":"phase_entered","phase":"implementation","reason":"orchestrator-enter-implementation"}`,
      `data: {"type":"phase_progress","phase":"implementation","progress":25,"message":"Compiling"}`,
      `data: {"type":"review_finding","finding":{"id":"implementation-tscircuit|err","phase":"implementation","category":"compile_error","severity":"warning","title":"compile_error","message":"x","isBlocking":true,"status":"open","source":"tscircuit","createdAt":1700000000000}}`,
      `data: {"type":"review_decision","decision":{"findingId":"implementation-tscircuit|err","decision":"accept","reason":"ack"}}`,
    ].join("\n");

    const events = parseSSEChunk(raw);
    expect(events).toHaveLength(4);
    expect(events[0]).toEqual({
      type: "phase_entered",
      phase: "implementation",
      reason: "orchestrator-enter-implementation",
    });
    expect(events[1]).toEqual({
      type: "phase_progress",
      phase: "implementation",
      progress: 25,
      message: "Compiling",
    });
    expect(events[2]).toMatchObject({
      type: "review_finding",
      finding: expect.objectContaining({
        id: "implementation-tscircuit|err",
      }),
    });
    expect(events[3]).toMatchObject({
      type: "review_decision",
      decision: { findingId: "implementation-tscircuit|err", decision: "accept" },
    });
  });
});

describe("code extraction", () => {
  it("extracts tsx code block from text", () => {
    const text =
      "Here's the code:\n```tsx\nexport default () => <board />\n```\nDone.";
    expect(extractCodeFromText(text)).toBe("export default () => <board />");
  });

  it("returns last code block when multiple exist", () => {
    const text =
      "```tsx\nfirst\n```\nsome text\n```tsx\nsecond\n```";
    expect(extractCodeFromText(text)).toBe("second");
  });

  it("returns null when no code block exists", () => {
    expect(extractCodeFromText("just some text")).toBeNull();
  });

  it("handles multiline code blocks", () => {
    const text = `\`\`\`tsx
export default () => (
  <board width="50mm" height="40mm">
    <resistor name="R1" resistance="10k" footprint="0402" />
  </board>
)
\`\`\``;
    const code = extractCodeFromText(text);
    expect(code).toContain("<board");
    expect(code).toContain("<resistor");
  });
});
