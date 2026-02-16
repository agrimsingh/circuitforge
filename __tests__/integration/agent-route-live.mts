/**
 * Live /api/agent SSE integration test.
 *
 * Runs the actual route handler + real Anthropic API.
 * Execute with:
 *   pnpm test:agent:live
 *
 * Requires ANTHROPIC_API_KEY in .env.local or environment.
 *
 * By default this file is NOT picked up by vitest (no *.test.* suffix).
 */

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  if (msg.includes("ProcessTransport is not ready")) return;
  console.error("Unhandled rejection:", reason);
  process.exit(1);
});

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { POST } from "../../app/api/agent/route.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const envPath = resolve(__dirname, "../../.env.local");
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    if (!process.env[key]) {
      process.env[key] = trimmed.slice(eqIdx + 1);
    }
  }
}

loadEnv();

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error("SKIP: ANTHROPIC_API_KEY not set");
  process.exit(0);
}

interface SSEEventLike {
  type?: string;
  [key: string]: unknown;
}

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<void>) {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, passed: true, duration: Date.now() - start });
    console.log(`  ✓ ${name} (${Date.now() - start}ms)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ name, passed: false, error: msg, duration: Date.now() - start });
    console.log(`  ✗ ${name} (${Date.now() - start}ms)`);
    console.log(`    ${msg}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function summarize(events: SSEEventLike[]) {
  const counts: Record<string, number> = {};
  for (const ev of events) {
    const t = typeof ev?.type === "string" ? ev.type : "unknown";
    counts[t] = (counts[t] ?? 0) + 1;
  }
  return counts;
}

function accumulateText(events: SSEEventLike[]) {
  return events
    .filter((e) => e?.type === "text")
    .map((e) => (typeof e.content === "string" ? e.content : ""))
    .join("");
}

function extractLastTsxCodeBlock(text: string): string | null {
  const re = /```tsx\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null = null;
  let last: string | null = null;
  while ((match = re.exec(text)) !== null) {
    last = (match[1] ?? "").trim();
  }
  return last;
}

async function consumeSSEUntilDone(
  response: Response,
  opts: { timeoutMs: number; maxEvents: number }
): Promise<SSEEventLike[]> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body reader");

  const decoder = new TextDecoder();
  const events: SSEEventLike[] = [];
  let buffer = "";
  const start = Date.now();

  const deadline = start + opts.timeoutMs;

  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const jsonStr = line.slice(6);
      if (!jsonStr) continue;

      const ev = JSON.parse(jsonStr) as SSEEventLike;
      events.push(ev);
      if (events.length > opts.maxEvents) {
        throw new Error(
          `Too many SSE events (> ${opts.maxEvents}). Last event type: ${String(ev.type)}`
        );
      }
      if (ev.type === "done" || ev.type === "error") {
        await reader.cancel().catch(() => {});
        return events;
      }
    }
  }

  await reader.cancel().catch(() => {});
  throw new Error(`Timed out waiting for done/error after ${opts.timeoutMs}ms`);
}

console.log("\n▸ /api/agent — live SSE");

await test("emits non-empty text and done for implementation run (real Anthropic)", async () => {
  const res = await POST(
    makeRequest({
      phase: "implementation",
      prompt:
        "Design a tiny 5V→3.3V regulator board using AMS1117-3.3 (SOT-223) with input/output caps. " +
        "You MUST source AMS1117-3.3 from JLCPCB inventory using the search_parts tool (include LCSC in a code comment). " +
        "Then generate tscircuit code in a single ```tsx block.",
    })
  );

  assert(res.status === 200, `expected status 200, got ${res.status}`);
  assert(res.headers.get("Content-Type") === "text/event-stream", "expected text/event-stream");

  const events = await consumeSSEUntilDone(res, { timeoutMs: 240_000, maxEvents: 10_000 });
  const counts = summarize(events);
  const text = accumulateText(events);
  const code = extractLastTsxCodeBlock(text);
  const dump = process.env.CF_LIVE_DUMP === "1";

  console.log(
    `    events=${events.length} tool_start=${counts.tool_start ?? 0} subagent_start=${counts.subagent_start ?? 0} text=${counts.text ?? 0} code=${counts.code ?? 0}`
  );

  if (dump) {
    console.log("\n--- assistant_text_start ---\n");
    console.log(text.trim());
    console.log("\n--- assistant_text_end ---\n");

    if (code) {
      console.log("\n--- extracted_tsx_start ---\n");
      console.log(code);
      console.log("\n--- extracted_tsx_end ---\n");
    }
  }

  assert(typeof text === "string" && text.trim().length > 40, "expected non-empty assistant text");
  assert(text.includes("```tsx"), "expected a tsx code fence in assistant text");
  assert(!!code && code.length > 40, "expected extractable tsx code block");
  assert(events.some((e) => e.type === "done"), "expected done event");
});

console.log("\n─────────────────────────────────");

const passed = results.filter((r) => r.passed).length;
const failed = results.filter((r) => !r.passed).length;
const totalTime = results.reduce((sum, r) => sum + r.duration, 0);

console.log(`\n  ${passed} passed, ${failed} failed (${(totalTime / 1000).toFixed(1)}s)\n`);

if (failed > 0) {
  console.log("  Failed tests:");
  for (const r of results.filter((r) => !r.passed)) {
    console.log(`    ✗ ${r.name}: ${r.error}`);
  }
  process.exit(1);
}

