/**
 * Live endpoint smoke test against a running local CircuitForge server.
 *
 * Usage:
 *   pnpm test:live:smoke
 *
 * Optional env vars:
 *   CIRCUITFORGE_BASE_URL=http://localhost:3000
 *   CIRCUITFORGE_AGENT_TIMEOUT_MS=360000
 *   CIRCUITFORGE_SMOKE_IMPLEMENTATION=0   (skip implementation-phase agent probe)
 *   CIRCUITFORGE_SMOKE_PROMPT_SET=default (prompt fixture set id)
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

const BASE_URL = process.env.CIRCUITFORGE_BASE_URL?.trim() || "http://localhost:3000";
const AGENT_TIMEOUT_MS = Math.max(
  30_000,
  Number.parseInt(process.env.CIRCUITFORGE_AGENT_TIMEOUT_MS ?? "360000", 10) || 360_000,
);
const RUN_IMPLEMENTATION = process.env.CIRCUITFORGE_SMOKE_IMPLEMENTATION !== "0";
const RUN_PIN_CONFLICT = process.env.CIRCUITFORGE_SMOKE_PIN_CONFLICT !== "0";
const SMOKE_PROMPT_SET = process.env.CIRCUITFORGE_SMOKE_PROMPT_SET?.trim() || "default";

interface SmokePromptSet {
  requirements: string;
  implementation: string;
  pinConflict: string;
}

function isSmokePromptSet(value: unknown): value is SmokePromptSet {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.requirements === "string" &&
    typeof candidate.implementation === "string" &&
    typeof candidate.pinConflict === "string"
  );
}

async function loadSmokePrompts(): Promise<SmokePromptSet> {
  const promptFixturePath = resolve(
    process.cwd(),
    "__tests__/fixtures/live-smoke-prompts.json",
  );
  const raw = JSON.parse(await readFile(promptFixturePath, "utf8")) as Record<string, unknown>;
  const sets = raw.sets;
  if (!sets || typeof sets !== "object") {
    throw new Error("live-smoke-prompts.json is missing a valid 'sets' object");
  }
  const selected = (sets as Record<string, unknown>)[SMOKE_PROMPT_SET];
  if (!isSmokePromptSet(selected)) {
    throw new Error(`Prompt set '${SMOKE_PROMPT_SET}' is missing or invalid in live-smoke-prompts.json`);
  }
  return selected;
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function postJson(path: string, body: unknown): Promise<{
  status: number;
  ok: boolean;
  headers: Headers;
  json: JsonRecord;
}> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await res.json().catch(() => ({}))) as JsonRecord;
  return { status: res.status, ok: res.ok, headers: res.headers, json: payload };
}

async function postZip(path: string, body: unknown): Promise<{
  status: number;
  ok: boolean;
  headers: Headers;
  bytes: number;
}> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const buf = await res.arrayBuffer();
  return { status: res.status, ok: res.ok, headers: res.headers, bytes: buf.byteLength };
}

async function consumeAgentSse(
  label: string,
  body: unknown,
): Promise<{
  status: number;
  terminal: "done" | "error";
  totalEvents: number;
  counts: Record<string, number>;
  finalSummary: JsonRecord | null;
  errorMessage: string | null;
  repairResults: Array<{
    attempt: number;
    blockingBefore: number;
    blockingAfter: number;
    autoFixedCount: number;
    demotedCount: number;
    revalidated: boolean;
  }>;
  validationCategories: string[];
}> {
  const res = await fetch(`${BASE_URL}/api/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  assert(res.ok, `${label}: /api/agent HTTP ${res.status}`);

  const contentType = res.headers.get("content-type") || "";
  assert(contentType.includes("text/event-stream"), `${label}: expected SSE content-type`);

  const reader = res.body?.getReader();
  assert(Boolean(reader), `${label}: missing response body reader`);
  const decoder = new TextDecoder();
  const events: Array<Record<string, unknown>> = [];
  let buffer = "";
  const deadline = Date.now() + AGENT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const { done, value } = await reader!.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6);
      if (!raw) continue;
      const event = JSON.parse(raw) as Record<string, unknown>;
      events.push(event);
      const type = typeof event.type === "string" ? event.type : "";
      if (type === "done" || type === "error") {
        await reader!.cancel().catch(() => {});
        const counts: Record<string, number> = {};
        for (const item of events) {
          const itemType = typeof item.type === "string" ? item.type : "unknown";
          counts[itemType] = (counts[itemType] ?? 0) + 1;
        }
        const finalSummaryEvent = events.find((item) => item.type === "final_summary");
        const errorEvent = events.find((item) => item.type === "error");
        return {
          status: res.status,
          terminal: type as "done" | "error",
          totalEvents: events.length,
          counts,
          finalSummary:
            finalSummaryEvent && typeof finalSummaryEvent.summary === "object"
              ? (finalSummaryEvent.summary as JsonRecord)
              : null,
          errorMessage:
            errorEvent && typeof errorEvent.message === "string"
              ? (errorEvent.message as string)
              : null,
          repairResults: events
            .filter(
              (item) =>
                item.type === "repair_result" &&
                item.result &&
                typeof item.result === "object",
            )
            .map((item) => {
              const result = item.result as Record<string, unknown>;
              return {
                attempt: Number(result.attempt ?? 0),
                blockingBefore: Number(result.blockingBefore ?? 0),
                blockingAfter: Number(result.blockingAfter ?? 0),
                autoFixedCount: Number(result.autoFixedCount ?? 0),
                demotedCount: Number(result.demotedCount ?? 0),
                revalidated: Boolean(result.revalidated),
              };
            }),
          validationCategories: events
            .filter(
              (item) =>
                item.type === "validation_errors" &&
                Array.isArray(item.diagnostics),
            )
            .flatMap((item) =>
              (item.diagnostics as Array<Record<string, unknown>>)
                .map((diagnostic) =>
                  typeof diagnostic.category === "string"
                    ? diagnostic.category
                    : null,
                )
                .filter((category): category is string => Boolean(category)),
            ),
        };
      }
    }
  }

  await reader!.cancel().catch(() => {});
  throw new Error(`${label}: timed out waiting for done/error (${AGENT_TIMEOUT_MS}ms)`);
}

async function main() {
  console.log(`\n▸ Live smoke against ${BASE_URL}`);
  const prompts = await loadSmokePrompts();
  console.log(`  using prompt set: ${SMOKE_PROMPT_SET}`);

  const fixturePath = resolve(process.cwd(), "__tests__/fixtures/simple-circuit.json");
  const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as unknown[];

  const validate = await postJson("/api/kicad/validate", { circuit_json: fixture });
  assert(validate.ok, `kicad/validate failed with ${validate.status}`);
  assert(typeof validate.json.kicadSchema === "string", "kicad/validate missing kicadSchema");
  console.log("  ✓ /api/kicad/validate");

  const edit = await postJson("/api/kicad/edit", {
    kicad_sch: validate.json.kicadSchema,
    edits: [{ tool: "manage_component", args: { action: "list" } }],
  });
  assert(edit.ok, `kicad/edit failed with ${edit.status}`);
  assert(edit.json.ok === true, "kicad/edit did not return ok:true");
  console.log("  ✓ /api/kicad/edit");

  const exportResult = await postZip("/api/export", {
    circuit_json: fixture,
    formatSet: { kicad: true, reviewBundle: true },
    readiness: { criticalFindingsCount: 0, allowRiskyExport: false },
  });
  assert(exportResult.ok, `export failed with ${exportResult.status}`);
  const exportType = exportResult.headers.get("content-type") || "";
  assert(exportType.includes("application/zip"), "export did not return zip");
  assert(exportResult.bytes > 1000, "export zip size unexpectedly small");
  console.log("  ✓ /api/export");

  const manufacturing = await postJson("/api/manufacturing/jlcpcb-link", {
    orderHints: { panelize: true },
  });
  assert(manufacturing.ok, `manufacturing route failed with ${manufacturing.status}`);
  assert(manufacturing.json.provider === "jlcpcb", "manufacturing provider mismatch");
  console.log("  ✓ /api/manufacturing/jlcpcb-link");

  const requirementsProbe = await consumeAgentSse("agent-requirements", {
    phase: "requirements",
    prompt: prompts.requirements,
  });
  assert(
    requirementsProbe.terminal === "done",
    `agent-requirements terminal=${requirementsProbe.terminal} error=${requirementsProbe.errorMessage ?? "none"}`,
  );
  assert(
    requirementsProbe.finalSummary !== null,
    "agent-requirements missing final_summary event",
  );
  console.log("  ✓ /api/agent (requirements)");

  let implementationProbe:
    | {
        status: number;
        terminal: "done" | "error";
        totalEvents: number;
        counts: Record<string, number>;
        finalSummary: JsonRecord | null;
        errorMessage: string | null;
        repairResults: Array<{
          attempt: number;
          blockingBefore: number;
          blockingAfter: number;
          autoFixedCount: number;
          demotedCount: number;
          revalidated: boolean;
        }>;
        validationCategories: string[];
      }
    | null = null;
  let pinConflictProbe:
    | {
        status: number;
        terminal: "done" | "error";
        totalEvents: number;
        counts: Record<string, number>;
        finalSummary: JsonRecord | null;
        errorMessage: string | null;
        repairResults: Array<{
          attempt: number;
          blockingBefore: number;
          blockingAfter: number;
          autoFixedCount: number;
          demotedCount: number;
          revalidated: boolean;
        }>;
        validationCategories: string[];
      }
    | null = null;

  if (RUN_IMPLEMENTATION) {
    implementationProbe = await consumeAgentSse("agent-implementation", {
      phase: "implementation",
      prompt: prompts.implementation,
    });
    assert(
      implementationProbe.terminal === "done",
      `agent-implementation terminal=${implementationProbe.terminal} error=${implementationProbe.errorMessage ?? "none"}`,
    );
    assert(
      implementationProbe.finalSummary !== null,
      "agent-implementation missing final_summary event",
    );
    assert(
      typeof implementationProbe.finalSummary.manufacturingReadinessScore === "number",
      "agent-implementation final_summary missing manufacturingReadinessScore",
    );
    assert(
      (implementationProbe.finalSummary.manufacturingReadinessScore as number) >= 70,
      `agent-implementation readiness below threshold: ${String(
        implementationProbe.finalSummary.manufacturingReadinessScore,
      )}`,
    );
    assert(
      Number(implementationProbe.finalSummary.blockingDiagnosticsCount ?? 999) === 0,
      `agent-implementation has blocking diagnostics: ${String(
        implementationProbe.finalSummary.blockingDiagnosticsCount,
      )}`,
    );
    assert(
      (implementationProbe.counts.retry_start ?? 0) >= 1,
      "agent-implementation did not emit retry_start",
    );
    assert(
      (implementationProbe.counts.timing_metric ?? 0) >= 1,
      "agent-implementation did not emit timing_metric",
    );
    assert(
      (implementationProbe.counts.repair_plan ?? 0) >= 1,
      "agent-implementation did not emit repair_plan",
    );
    assert(
      (implementationProbe.counts.repair_result ?? 0) >= 1,
      "agent-implementation did not emit repair_result",
    );
    assert(
      implementationProbe.repairResults.every(
        (result) => result.blockingAfter <= result.blockingBefore,
      ),
      "agent-implementation repair results increased blocking count",
    );
    console.log("  ✓ /api/agent (implementation)");

    if (RUN_PIN_CONFLICT) {
      pinConflictProbe = await consumeAgentSse("agent-pin-conflict", {
        phase: "implementation",
        prompt: prompts.pinConflict,
      });
      assert(
        pinConflictProbe.terminal === "done",
        `agent-pin-conflict terminal=${pinConflictProbe.terminal} error=${pinConflictProbe.errorMessage ?? "none"}`,
      );
      assert(
        (pinConflictProbe.counts.repair_plan ?? 0) >= 1,
        "agent-pin-conflict did not emit repair_plan",
      );
      assert(
        (pinConflictProbe.counts.repair_result ?? 0) >= 1,
        "agent-pin-conflict did not emit repair_result",
      );
      const sawPinConflictWarning = pinConflictProbe.validationCategories.some((category) =>
        category.toUpperCase().includes("PIN_CONFLICT_WARNING"),
      );
      assert(
        sawPinConflictWarning,
        "agent-pin-conflict did not produce PIN_CONFLICT_WARNING in validation diagnostics",
      );
      console.log("  ✓ /api/agent (pin-conflict)");
    }
  }

  console.log("\nSmoke summary:");
  console.log(
    JSON.stringify(
      {
        baseUrl: BASE_URL,
        requirementsAgent: requirementsProbe,
        implementationAgent: implementationProbe,
        pinConflictAgent: pinConflictProbe,
      },
      null,
      2,
    ),
  );
  console.log("\nAll live smoke checks passed.");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nLive smoke failed: ${message}`);
  process.exit(1);
});

