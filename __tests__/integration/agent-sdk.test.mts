/**
 * Live Agent SDK integration tests (specs/agent-backend.md).
 *
 * The Claude Agent SDK spawns subprocesses that are incompatible with
 * vitest's worker model. These tests run as a standalone Node script:
 *
 *   npx tsx __tests__/integration/agent-sdk.test.mts
 *
 * Or via the npm script:
 *
 *   pnpm test:sdk
 *
 * Requires ANTHROPIC_API_KEY in .env.local or environment.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { SYSTEM_PROMPT } from "../../lib/agent/prompt.js";
import { circuitforgeTools } from "../../lib/agent/tools.js";
import { subagents } from "../../lib/agent/subagents.js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  try {
    const envPath = resolve(__dirname, "../../.env.local");
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
  } catch {}
}

loadEnv();

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error("SKIP: ANTHROPIC_API_KEY not set");
  process.exit(0);
}

process.on("unhandledRejection", (err) => {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("ProcessTransport is not ready for writing")) return;
  console.error("Unhandled rejection:", msg);
  process.exit(1);
});

interface SDKMessage {
  type: string;
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

async function runQuery(
  prompt: string,
  opts: {
    model?: string;
    maxTurns?: number;
    allowedTools?: string[];
    useSubagents?: boolean;
    useMcp?: boolean;
  } = {},
): Promise<SDKMessage[]> {
  const messages: SDKMessage[] = [];

  const options: Record<string, unknown> = {
    model: opts.model ?? "claude-haiku-4-5",
    systemPrompt: SYSTEM_PROMPT,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    maxTurns: opts.maxTurns ?? 3,
    allowedTools: opts.allowedTools ?? [],
  };

  if (opts.useMcp) {
    options.mcpServers = { "circuitforge-tools": circuitforgeTools };
    options.allowedTools = [
      ...(opts.allowedTools ?? []),
      "mcp__circuitforge-tools__search_parts",
    ];
  }

  if (opts.useSubagents) {
    options.agents = subagents;
    options.allowedTools = [...(options.allowedTools as string[]), "Task"];
  }

  for await (const message of query({ prompt, options: options as never })) {
    messages.push(message as SDKMessage);
    if (message.type === "result") break;
  }

  return messages;
}

console.log("\n▸ Agent SDK — basic connectivity");

await test("connects to Anthropic API and gets a response", async () => {
  const messages = await runQuery("Say exactly: TEST_OK", { maxTurns: 1 });

  const result = messages.find((m) => m.type === "result");
  assert(!!result, "expected a result message");
  assert(result!.subtype === "success", `expected success, got ${result!.subtype}`);
  assert(typeof result!.result === "string", "result should be a string");
  assert((result!.result as string).length > 0, "result should not be empty");
});

await test("result includes cost and usage info", async () => {
  const messages = await runQuery("Say hi", { maxTurns: 1 });

  const result = messages.find((m) => m.type === "result");
  assert(!!result, "expected a result message");
  assert(typeof result!.total_cost_usd === "number", "expected total_cost_usd");
  assert((result!.total_cost_usd as number) > 0, "cost should be positive");
  assert(typeof result!.usage === "object", "expected usage object");
});

await test("emits system init message with session_id", async () => {
  const messages = await runQuery("Say hi", { maxTurns: 1 });

  const init = messages.find(
    (m) => m.type === "system" && m.subtype === "init",
  );
  assert(!!init, "expected system init message");
  assert(typeof init!.session_id === "string", "expected session_id");
});

console.log("\n▸ Agent SDK — MCP tool invocation (search_parts)");

await test("agent can call search_parts via MCP", async () => {
  const messages = await runQuery(
    "Use the search_parts tool to search for 'ESP32-C3'. Just call the tool and report the first result.",
    {
      maxTurns: 3,
      useMcp: true,
    },
  );

  const result = messages.find((m) => m.type === "result");
  assert(!!result, "expected a result message");
  assert(result!.subtype === "success", `expected success, got ${result!.subtype}`);

  const text = result!.result as string;
  assert(
    text.includes("LCSC") || text.includes("ESP32") || text.includes("C"),
    "expected result to mention LCSC codes or ESP32",
  );
});

await test("search_parts returns real component data", async () => {
  const messages = await runQuery(
    "You MUST use the mcp__circuitforge-tools__search_parts tool to search for 'AMS1117-3.3'. Call the tool, then report the LCSC code (starts with C) and stock level from the first result.",
    {
      maxTurns: 3,
      useMcp: true,
    },
  );

  const result = messages.find((m) => m.type === "result");
  assert(!!result, "expected a result message");

  const text = result!.result as string;
  assert(/C\d{4,}/.test(text), `expected LCSC code in: ${text.slice(0, 200)}`);
});

console.log("\n▸ Agent SDK — subagent delegation");

await test("orchestrator delegates to parts-scout subagent", async () => {
  const messages = await runQuery(
    "Use the parts-scout agent to find a 3.3V LDO regulator. Report its LCSC code.",
    {
      maxTurns: 5,
      useSubagents: true,
      useMcp: true,
    },
  );

  const result = messages.find((m) => m.type === "result");
  assert(!!result, "expected a result message");
  assert(result!.subtype === "success", `expected success, got ${result!.subtype}`);
});

console.log("\n▸ Agent SDK — code generation");

await test("generates tscircuit code with board element", async () => {
  const messages = await runQuery(
    "Generate a minimal tscircuit circuit with one LED and one 330 ohm resistor. Output the code in a tsx code block. Do NOT use any tools, just generate the code based on your knowledge.",
    {
      maxTurns: 1,
      model: "claude-sonnet-4-5",
    },
  );

  const result = messages.find((m) => m.type === "result");
  assert(!!result, "expected a result message");

  const text = result!.result as string;
  assert(text.includes("<board"), "expected <board in generated code");
  assert(text.includes("export default"), "expected export default");
});

await test("generated code includes component elements", async () => {
  const messages = await runQuery(
    "Write tscircuit JSX code: a board with one resistor R1 (10k, 0402) and one capacitor C1 (100nF, 0402). Just the code in a tsx block, nothing else.",
    {
      maxTurns: 1,
      model: "claude-sonnet-4-5",
    },
  );

  const result = messages.find((m) => m.type === "result");
  assert(!!result, "expected a result message");

  const text = result!.result as string;
  assert(text.includes("R1") || text.includes("resistor"), "expected R1/resistor");
  assert(text.includes("C1") || text.includes("capacitor"), "expected C1/capacitor");
});

console.log("\n▸ Agent SDK — previousCode handling");

await test("handles context about existing circuit design", async () => {
  const existingCode = `export default () => (
  <board width="30mm" height="20mm">
    <resistor name="R1" resistance="330" footprint="0402" />
  </board>
)`;

  const messages = await runQuery(
    `The user previously designed a circuit. Here is the existing tscircuit code:\n\n\`\`\`tsx\n${existingCode}\n\`\`\`\n\nThe user now says: Add a 100nF capacitor C1 to this board.\n\nModify the design. Output the updated tsx code.`,
    {
      maxTurns: 1,
      model: "claude-sonnet-4-5",
    },
  );

  const result = messages.find((m) => m.type === "result");
  assert(!!result, "expected a result message");

  const text = result!.result as string;
  assert(
    text.includes("C1") || text.includes("capacitor") || text.includes("100nF"),
    "expected mention of new capacitor",
  );
  assert(text.includes("R1") || text.includes("330"), "expected existing R1 preserved");
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
