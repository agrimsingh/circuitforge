import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  PreToolUseHookInput,
  PostToolUseHookInput,
  SubagentStartHookInput,
  SubagentStopHookInput,
  HookJSONOutput,
  AgentDefinition,
} from "@anthropic-ai/claude-agent-sdk";
import { MODELS } from "@/lib/agent/models";
import {
  buildOrchestratorPrompt,
  SYSTEM_PROMPT,
  requirementItemsFromPrompt,
  architectureFromRequirements,
} from "@/lib/agent/prompt";
import { circuitforgeTools } from "@/lib/agent/tools";
import {
  resolveAllowedToolsForPhase,
  resolvePhaseSubagents,
} from "@/lib/agent/subagents";
import { extractCodeFromText } from "@/lib/agent/code";
import {
  compileAndValidateWithKicad,
  computeDiagnosticsScore,
  createDiagnosticsSetSignature,
  formatDiagnosticsForPrompt,
} from "@/lib/agent/repairLoop";
import {
  getAdaptiveGuardrailsPersistent,
  recordDiagnosticsSamplePersistent,
} from "@/lib/agent/persistentErrorMemory";
import { applyKicadMcpEdits, type KicadSchemaEdit } from "@/lib/kicad/review";
import {
  getSessionContext,
  persistSessionContext,
  type SessionContextData,
} from "@/lib/agent/sessionMemory";
import type {
  SSEEvent,
  AgentRequest,
  ValidationDiagnostic,
  ReviewFinding,
  DesignPhase,
} from "@/lib/stream/types";

export const runtime = "nodejs";
export const maxDuration = 300;
const MAX_REPAIR_ATTEMPTS = 3;
const RETRY_STAGNATION_LIMIT = 3;
const SIGNATURE_REPEAT_LIMIT = 2;
const MIN_SCORE_IMPROVEMENT = 120;
const ACTIVE_RUNS_BY_SESSION = new Map<string, { runId: string; abort: AbortController }>();

const KICAD_PHASE_GATES: Record<DesignPhase, string> = {
  requirements: "Requirements phase constraints must be complete before implementation",
  architecture: "Architecture output must resolve before implementation",
  implementation: "PCB/compile validation must pass before acceptance",
  review: "Review findings must be accepted or dismissed",
  export: "Export payloads require a stable, validated design",
};

interface ParsedKicadEditPlan {
  edits: KicadSchemaEdit[];
  summary: string;
  reason: string;
}

const KICAD_EDIT_KIND = {
  capacitor: {
    prefix: "C",
    lib_id: "Device:C",
    value: "100nF",
    footprint: "0805",
  },
  resistor: {
    prefix: "R",
    lib_id: "Device:R",
    value: "10k",
    footprint: "0805",
  },
  inductor: {
    prefix: "L",
    lib_id: "Device:L",
    value: "10uH",
    footprint: "0805",
  },
  diode: {
    prefix: "D",
    lib_id: "Device:D",
    value: "1N4148",
    footprint: "sod-123",
  },
  transistor: {
    prefix: "Q",
    lib_id: "Device:Q",
    value: "Q_NMOS_GSD",
    footprint: "soic8",
  },
  default: {
    prefix: "C",
    lib_id: "Device:C",
    value: "100nF",
    footprint: "0805",
  },
} as const;

function normalizeKicadValue(raw: string): string | null {
  const compact = raw.trim().replace(/["'`]/g, "").replace(/[,;:)]/g, "").replace(/\s+/g, "");
  if (!compact || !/\d/.test(compact)) return null;
  const withoutOhms = compact.replace(/\u03a9/g, "").replace(/ohm/gi, "").replace(/Ω/g, "");
  return withoutOhms || null;
}

export function normalizeReference(raw: string): string | null {
  const normalized = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!normalized) return null;
  if (!/^[A-Z]{1,3}\d+[A-Z]?$/.test(normalized)) return null;
  return normalized;
}

function resolveEditKind(raw: string) {
  if (/(decoupling|capacitor|cap\b)/.test(raw)) return "capacitor" as const;
  if (/\bresistor\b|\bres\b/.test(raw)) return "resistor" as const;
  if (/\binductor\b|\bind\b/.test(raw)) return "inductor" as const;
  if (/\bdiode\b/.test(raw)) return "diode" as const;
  if (/\btransistor\b|\bmosfet\b|\bmossfet\b/.test(raw)) return "transistor" as const;
  return "default" as const;
}

function formatKicadEditSummary(edits: KicadSchemaEdit[]): string {
  return edits
    .map((edit) => {
      if (edit.tool === "manage_component") {
        const action = String(edit.args?.action || "modify");
        const reference = String(edit.args?.reference ?? "new component");
        const value = edit.args?.value ? ` to ${edit.args.value}` : "";
        const near = edit.args?.nearReference ? ` near ${edit.args.nearReference}` : "";
        return `${action} component ${reference}${value}${near}`;
      }

      if (edit.tool === "manage_wire") {
        const action = String(edit.args?.action || "add");
        const from = String(edit.args?.fromReference || "");
        const to = String(edit.args?.toReference || "");
        const startPoint =
          typeof edit.args?.start === "object" && edit.args?.start !== null
            ? (edit.args.start as Record<string, unknown>)
            : null;
        const endPoint =
          typeof edit.args?.end === "object" && edit.args?.end !== null
            ? (edit.args.end as Record<string, unknown>)
            : null;
        const start =
          startPoint && "x" in startPoint && "y" in startPoint
            ? ` from (${String(startPoint.x)},${String(startPoint.y)})`
            : "";
        const end =
          endPoint && "x" in endPoint && "y" in endPoint
            ? ` to (${String(endPoint.x)},${String(endPoint.y)})`
            : "";
        if (from && to) {
          return `${action} wire between ${from} and ${to}`;
        }
        return `${action} wire${start}${end}`;
      }

      return String(edit.tool);
    })
    .join(", ");
}

export function parseKicadEditPlan(prompt: string): ParsedKicadEditPlan | null {
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt) return null;

  const lower = normalizedPrompt.toLowerCase();
  const isEditIntent =
    /\b(change|set|modify|update|adjust)\s+[a-z]+\d+[a-z]?\b/i.test(prompt) ||
    /\bremove\s+[a-z]+\d+[a-z]?\b/i.test(prompt) ||
    /\b(connect|wire)\s+[a-z]+\d+[a-z]?\s+(?:to|and|with)\s+[a-z]+\d+[a-z]?\b/i.test(prompt) ||
    /\b(add|insert|place|put)\s+[^\n]{0,90}?\s+(?:near|next to|beside|by|alongside)\s+[a-z]+\d+[a-z]?\b/i.test(prompt) ||
    /\b(add|draw|route)\s+wire\b/i.test(prompt);

  if (!isEditIntent) return null;

  const valueChangeMatch = prompt.match(
    /(?:change|set|modify|update|adjust)\s+([a-z]+\d+[a-z]?)\b[^\n]{0,80}?\b(?:to|=)\s+([^\n,;)]{1,24})/i
  );
  if (valueChangeMatch) {
    const reference = valueChangeMatch[1]?.toUpperCase();
    const normalizedValue = normalizeKicadValue(valueChangeMatch[2] ?? "");
    if (reference && normalizedValue) {
      const edits: KicadSchemaEdit[] = [
        {
          tool: "manage_component",
          args: {
            action: "modify",
            reference,
            value: normalizedValue,
          },
        },
      ];

      return {
        edits,
        summary: formatKicadEditSummary(edits),
        reason: `Parsed as component value edit: ${reference} -> ${normalizedValue}`,
      };
    }
  }

  const addNearMatch = lower.match(
    /(?:add|insert|place|put)\s+([^\n]{0,90}?)\s+(?:near|next to|beside|by|alongside)\s+([a-z]+\d+[a-z]?)\b/i,
  );
  if (addNearMatch) {
    const description = addNearMatch[1] ?? "";
    const reference = normalizeReference(addNearMatch[2] ?? "");
    if (!reference) return null;

    const kind = resolveEditKind(description);
    const editKind = KICAD_EDIT_KIND[kind];
    const normalizedValue = normalizeKicadValue((description.match(/\b\d+[a-zA-Z0-9.]+\b/g) || [])[0] ?? "");
    const value = normalizedValue || editKind.value;

    const edits: KicadSchemaEdit[] = [
      {
        tool: "manage_component",
        args: {
          action: "add",
          reference: `__NEW_${editKind.prefix}`,
          lib_id: editKind.lib_id,
          value,
          footprint: editKind.footprint,
          nearReference: reference,
          relativeOffset: { x: 5, y: 5 },
        },
      },
    ];

    return {
      edits,
      summary: formatKicadEditSummary(edits),
      reason: `Parsed as nearby component add near ${reference} (${kind})`,
    };
  }

  const connectMatch = lower.match(
    /(?:connect|wire)\s+([a-z]+\d+[a-z]?)\s+(?:to|and|with)\s+([a-z]+\d+[a-z]?)\b/i,
  );
  if (connectMatch) {
    const from = normalizeReference(connectMatch[1] ?? "");
    const to = normalizeReference(connectMatch[2] ?? "");
    if (!from || !to || from === to) return null;

    const edits: KicadSchemaEdit[] = [
      {
        tool: "manage_wire",
        args: {
          action: "add",
          fromReference: from,
          toReference: to,
        },
      },
    ];

    return {
      edits,
      summary: formatKicadEditSummary(edits),
      reason: `Parsed as wire connection: ${from} to ${to}`,
    };
  }

  const explicitWireMatch = lower.match(
    /(?:add|draw|route)\s+wire\s+(?:from\s*)?(-?\d+(?:\.\d+)?)\s*,?\s*(-?\d+(?:\.\d+)?)\s*(?:to|and)\s*(-?\d+(?:\.\d+)?)\s*,?\s*(-?\d+(?:\.\d+)?)\s*$/i,
  );
  if (explicitWireMatch) {
    const startX = Number.parseFloat(explicitWireMatch[1] ?? "");
    const startY = Number.parseFloat(explicitWireMatch[2] ?? "");
    const endX = Number.parseFloat(explicitWireMatch[3] ?? "");
    const endY = Number.parseFloat(explicitWireMatch[4] ?? "");

    if (
      Number.isFinite(startX) &&
      Number.isFinite(startY) &&
      Number.isFinite(endX) &&
      Number.isFinite(endY)
    ) {
      const edits: KicadSchemaEdit[] = [
        {
          tool: "manage_wire",
          args: {
            action: "add",
            start: { x: startX, y: startY },
            end: { x: endX, y: endY },
          },
        },
      ];

      return {
        edits,
        summary: formatKicadEditSummary(edits),
        reason: `Parsed as explicit wire coordinates (${startX},${startY}) -> (${endX},${endY})`,
      };
    }
  }

  const removeMatch = lower.match(/(?:remove|delete)\s+([a-z]+\d+[a-z]?)\b/i);
  if (removeMatch?.[1]) {
    const reference = removeMatch[1].toUpperCase();
    const edits: KicadSchemaEdit[] = [
      {
        tool: "manage_component",
        args: {
          action: "remove",
          reference,
        },
      },
    ];

    return {
      edits,
      summary: formatKicadEditSummary(edits),
      reason: `Parsed as component removal: ${reference}`,
    };
  }

  return null;
}

const SESSION_ID_PREFIX = "cf-v2";

function createSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${SESSION_ID_PREFIX}-${crypto.randomUUID()}`;
  }
  return `${SESSION_ID_PREFIX}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function createRunId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `run-${crypto.randomUUID()}`;
  }
  return `run-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function sseEncode(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function createEmptySessionContext(projectId?: string): SessionContextData {
  return {
    projectId,
    requirements: [],
    architecture: [],
    reviewFindings: [],
    lastPhase: undefined,
    lastKicadSchema: undefined,
    lastGeneratedCode: undefined,
  };
}

async function getOrCreateSession(projectId?: string, sessionId?: string) {
  const resolved = sessionId?.trim() || createSessionId();
  const existing = await getSessionContext(resolved);
  if (existing) {
    if (projectId && !existing.projectId) {
      existing.projectId = projectId;
      await persistSessionContext(resolved, existing);
    }
    return { id: resolved, context: existing };
  }

  const context = createEmptySessionContext(projectId);
  await persistSessionContext(resolved, context);
  return { id: resolved, context };
}

function dedupeById<T extends { id: string }>(items: T[], incoming: T[]) {
  const map = new Map<string, T>();
  for (const item of items) map.set(item.id, item);
  for (const item of incoming) map.set(item.id, item);
  return Array.from(map.values());
}

function mergeReviewFindings(existing: ReviewFinding[], incoming: ReviewFinding[]) {
  const map = new Map<string, ReviewFinding>();
  for (const finding of existing) {
    map.set(finding.id, finding);
  }
  for (const finding of incoming) {
    const prior = map.get(finding.id);
    if (!prior || prior.status === "open") {
      map.set(finding.id, finding);
      continue;
    }
    map.set(finding.id, { ...finding, status: prior.status });
  }
  return Array.from(map.values());
}

function closeResolvedFindingsForPhase(
  existing: ReviewFinding[],
  phase: DesignPhase,
  activeFindingIds: Set<string>,
): ReviewFinding[] {
  return existing.map((finding) => {
    if (finding.phase !== phase) return finding;
    if (finding.status !== "open") return finding;
    if (activeFindingIds.has(finding.id)) return finding;
    return {
      ...finding,
      status: "dismissed",
    };
  });
}

function emitResolvedReviewDecisions(params: {
  before: ReviewFinding[];
  after: ReviewFinding[];
  emit: (event: SSEEvent) => void;
}) {
  const beforeById = new Map(params.before.map((finding) => [finding.id, finding]));
  for (const finding of params.after) {
    const prior = beforeById.get(finding.id);
    if (!prior) continue;
    if (prior.status === "open" && finding.status === "dismissed") {
      params.emit({
        type: "review_decision",
        decision: { findingId: finding.id, decision: "dismiss" },
      });
    }
  }
}

function makeReviewId(phase: DesignPhase, entry: ValidationDiagnostic) {
  const source = entry.source ?? "tscircuit";
  const signature = entry.signature ? entry.signature.replaceAll(":", "-") : entry.category;
  return `${phase}-${source}-${signature}`;
}

function severityFromDiagnostic(phase: DesignPhase, diagnostic: ValidationDiagnostic): "critical" | "warning" | "info" {
  if (diagnostic.handling === "should_demote") return "info";
  if (diagnostic.category.includes("compile") || diagnostic.category.includes("missing_code_block")) return "critical";
  if (diagnostic.severity >= 8) return "critical";
  if (diagnostic.category.includes("short") || diagnostic.severity >= 6 || phase === "review") return "warning";
  return "info";
}

function toReviewFindings(
  phase: DesignPhase,
  diagnostics: ValidationDiagnostic[]
): ReviewFinding[] {
  return diagnostics.map((diagnostic) => ({
    id: makeReviewId(phase, diagnostic),
    phase,
    category: diagnostic.category,
    severity: severityFromDiagnostic(phase, diagnostic),
    title: diagnostic.category,
    message: diagnostic.message,
    isBlocking:
      diagnostic.handling !== "should_demote" &&
      diagnostic.handling !== "auto_fixable" &&
      (diagnostic.category.includes("compile") || diagnostic.severity >= 8),
    status: "open",
    source: diagnostic.source,
    createdAt: Date.now(),
  }));
}

function resolveFindingFamily(finding: ReviewFinding): string {
  return inferDiagnosticFamily({
    category: finding.category,
    message: finding.message,
    severity: finding.severity === "critical" ? 9 : finding.severity === "warning" ? 6 : 4,
    signature: finding.id,
    source: finding.source,
  });
}

function inferDefaultPhase(prompt: string, hasHistory: boolean): DesignPhase {
  if (/export/i.test(prompt)) return "export";
  if (/review|audit|check|validate/i.test(prompt)) return "review";
  if (!hasHistory) return "requirements";
  if (/architecture|block|module|subsystem/i.test(prompt)) return "architecture";
  if (/supply|bom|dfm|erc|drc|design review/i.test(prompt)) return "review";
  return "implementation";
}

function buildRetryPrompt(params: {
  userPrompt: string;
  previousCode?: string;
  attemptedCode: string;
  diagnostics: ValidationDiagnostic[];
  attempt: number;
  maxAttempts: number;
  adaptiveGuardrails: string;
  deterministicActions?: string[];
}) {
  const categories = new Set(params.diagnostics.map((d) => d.category));
  const hints: string[] = [];

  if (categories.has("pcb_trace_error")) {
    hints.push(
      "- Trace fix: reroute colliding traces so they do not share path segments or overlap at bends."
    );
    hints.push(
      "- Trace fix: increase trace-to-trace gap and avoid parallel traces through the same narrow passage."
    );
  }

  if (categories.has("pcb_via_clearance_error")) {
    hints.push(
      "- Via fix: move conflicting vias apart and avoid placing different-net vias in the same local cluster."
    );
    hints.push(
      "- Via fix: if needed, relocate one net's via to another side of the component fanout region."
    );
  }

  const adaptiveSection = params.adaptiveGuardrails
    ? `\nRecent learned failure patterns:\n${params.adaptiveGuardrails}\n`
    : "";

  const previousCodeSection = params.previousCode
    ? `\nOriginal baseline code from context:\n\`\`\`tsx\n${params.previousCode}\n\`\`\`\n`
    : "";

  const deterministicSection =
    params.deterministicActions && params.deterministicActions.length > 0
      ? `\nDeterministic repair actions already applied in this attempt:\n${params.deterministicActions
          .map((action) => `- ${action}`)
          .join("\n")}\n`
      : "";

  return `You must repair the generated tscircuit code.

Original user request:
${params.userPrompt}
${previousCodeSection}
Previous failed attempt (${params.attempt}/${params.maxAttempts}):
\`\`\`tsx
${params.attemptedCode}
\`\`\`

Validation/compile diagnostics:
${formatDiagnosticsForPrompt(params.diagnostics, 8)}

Repair objective:
- First eliminate blocking diagnostics (compile failures, shorts, trace/via/clearance collisions).
- If diagnostics include advisory warnings, prioritize blocking fixes before cosmetic/BOM cleanup.

Targeted fix guidance:
${hints.length > 0 ? hints.join("\n") : "- No targeted guidance available; apply general PCB guardrails."}
${deterministicSection}
${adaptiveSection}

Requirements:
1. Return a complete, self-contained tscircuit file in a single \`\`\`tsx block.
2. Preserve the user's requested functionality.
3. Fix the reported issues without adding unsafe changes.
`;
}

function composeAbortSignal(...signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const valid = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (valid.length === 0) return undefined;
  if (valid.length === 1) return valid[0];
  return AbortSignal.any(valid);
}

function isAbortLikeError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; message?: unknown; cause?: unknown };
  const name = typeof candidate.name === "string" ? candidate.name.toLowerCase() : "";
  if (name === "aborterror" || name === "timeouterror" || name === "operationabortederror") {
    return true;
  }
  const message = typeof candidate.message === "string" ? candidate.message.toLowerCase() : "";
  if (
    message.includes("aborted by user") ||
    message.includes("operation aborted") ||
    message.includes("request aborted") ||
    message.includes("timed out")
  ) {
    return true;
  }
  if (candidate.cause && candidate.cause !== error) {
    return isAbortLikeError(candidate.cause);
  }
  return false;
}

function collectComponents(code: string) {
  const byName = new Map<string, { tag: string; value: string | null }>();
  const componentRegex =
    /<(chip|resistor|capacitor|inductor|diode|led|transistor|mosfet|pinheader|pushbutton|switch|battery|crystal|fuse|potentiometer)\b([^>]*)>/gi;

  let match: RegExpExecArray | null = null;
  while ((match = componentRegex.exec(code)) !== null) {
    const tag = (match[1] ?? "").toLowerCase();
    const attrs = match[2] ?? "";
    const nameMatch = /\bname="([^"]+)"/i.exec(attrs);
    const name = nameMatch?.[1]?.trim();
    if (!name) continue;
    const valueMatch =
      /\b(resistance|capacitance|inductance|value|frequency|voltage|capacity)="([^"]+)"/i.exec(attrs);
    byName.set(name, {
      tag,
      value: valueMatch?.[2]?.trim() ?? null,
    });
  }

  return byName;
}

function createIterationDiff(previousCode: string | null | undefined, nextCode: string) {
  const previous = previousCode ? collectComponents(previousCode) : new Map();
  const next = collectComponents(nextCode);
  const addedComponents = Array.from(next.keys()).filter((name) => !previous.has(name));
  const removedComponents = Array.from(previous.keys()).filter((name) => !next.has(name));
  const changedComponentValues: Array<{ name: string; from: string; to: string }> = [];

  for (const [name, nextComponent] of next.entries()) {
    const prevComponent = previous.get(name);
    if (!prevComponent) continue;
    const before = prevComponent.value;
    const after = nextComponent.value;
    if (!before || !after || before === after) continue;
    changedComponentValues.push({ name, from: before, to: after });
  }

  const prevTraceCount = previousCode ? (previousCode.match(/<trace\b/gi)?.length ?? 0) : 0;
  const nextTraceCount = nextCode.match(/<trace\b/gi)?.length ?? 0;
  const traceCountDelta = nextTraceCount - prevTraceCount;

  const summaryBits: string[] = [];
  if (addedComponents.length > 0) summaryBits.push(`+${addedComponents.length} components`);
  if (removedComponents.length > 0) summaryBits.push(`-${removedComponents.length} components`);
  if (changedComponentValues.length > 0) {
    summaryBits.push(`${changedComponentValues.length} value changes`);
  }
  if (traceCountDelta !== 0) {
    summaryBits.push(
      traceCountDelta > 0 ? `+${traceCountDelta} traces` : `${traceCountDelta} traces`,
    );
  }

  return {
    addedComponents,
    removedComponents,
    changedComponentValues,
    traceCountDelta,
    summary: summaryBits.length > 0 ? summaryBits.join(", ") : "No structural deltas detected",
  };
}

function compactIntent(prompt: string): string {
  const first = prompt
    .trim()
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)[0];
  if (!first) return "Circuit update requested";
  return first.slice(0, 180);
}

type DiagnosticHandling = "auto_fixable" | "should_demote" | "must_repair";

function inferDiagnosticFamily(entry: ValidationDiagnostic): string {
  if (entry.family && entry.family.trim()) return entry.family;
  const category = entry.category.trim().toLowerCase();
  const message = entry.message.trim().toLowerCase();
  const combined = `${category} ${message}`;

  if (combined.includes("kicad_unconnected_pin") || combined.includes("unconnected pin")) {
    return "kicad_unconnected_pin";
  }
  if (combined.includes("floating_label") || combined.includes("floating label")) {
    return "floating_label";
  }
  if (combined.includes("off_grid") || combined.includes("off-grid") || combined.includes("off grid")) {
    return "off_grid";
  }
  if (combined.includes("kicad_bom_property") || combined.includes("bom")) {
    return "kicad_bom_property";
  }
  if (
    combined.includes("pin_conflict_warning") ||
    combined.includes("pin conflict") ||
    combined.includes("pin_conflict")
  ) {
    return "pin_conflict_warning";
  }
  if (combined.includes("duplicate_reference")) {
    return "duplicate_reference";
  }
  return category || "validation";
}

function parseUnconnectedPinContext(message: string): {
  reference: string | null;
  pin: string | null;
} {
  const match = /([A-Z]{1,4}\d+[A-Z]?)\s+pin\s+([A-Z0-9+\-_/.]+)/i.exec(message);
  if (!match) return { reference: null, pin: null };
  return {
    reference: match[1]?.toUpperCase() ?? null,
    pin: match[2]?.toUpperCase() ?? null,
  };
}

function isLikelyActiveComponentReference(reference: string | null): boolean {
  if (!reference) return false;
  return /^(U|Q|IC|MCU|REG|VR)\d+/.test(reference);
}

function isLikelyFunctionalPin(pin: string | null): boolean {
  if (!pin) return false;
  if (
    /^(V\+|V-|VIN|VOUT|IN|OUT|EN|FB|ADJ|GATE|BASE|COLLECTOR|EMITTER|DRAIN|SOURCE|CLK|DATA|SDA|SCL|RX|TX)$/.test(
      pin,
    )
  ) {
    return true;
  }
  return false;
}

function isGenericNumberedPin(pin: string | null): boolean {
  if (!pin) return false;
  return /^\d+$/.test(pin);
}

function shouldTreatUnconnectedPinAsMustRepair(message: string): boolean {
  const context = parseUnconnectedPinContext(message);
  if (isLikelyFunctionalPin(context.pin)) return true;
  if (isGenericNumberedPin(context.pin)) return false;
  const normalized = message.toLowerCase();
  return /\b(opamp|regulator|mcu|driver|mosfet|transistor)\b/.test(normalized);
}

function classifyDiagnosticHandling(entry: ValidationDiagnostic): DiagnosticHandling {
  const category = entry.category.toLowerCase();
  const message = entry.message.toLowerCase();
  const family = inferDiagnosticFamily(entry);

  if (family === "kicad_bom_property") return "should_demote";
  if (family === "pin_conflict_warning") return "must_repair";

  if (family === "off_grid") {
    if (message.includes("connect") || message.includes("junction")) return "must_repair";
    return "auto_fixable";
  }

  if (family === "floating_label") {
    if (message.includes("missing net") || message.includes("ambiguous")) return "must_repair";
    return "auto_fixable";
  }

  if (family === "kicad_unconnected_pin") {
    return shouldTreatUnconnectedPinAsMustRepair(entry.message)
      ? "must_repair"
      : "auto_fixable";
  }

  if (family === "duplicate_reference") {
    const powerSymbolDuplicate = /\b(gnd|vcc|vdd|vss|3v3|5v|\+3v3|\+5v)\b/.test(message);
    return powerSymbolDuplicate ? "should_demote" : "must_repair";
  }

  if (
    category.includes("compile") ||
    category.includes("missing_code_block") ||
    category.includes("short") ||
    category.includes("collision") ||
    category.includes("trace_error") ||
    category.includes("via_clearance_error") ||
    category.includes("kicad_schema_missing") ||
    category.includes("kicad_schema_analysis_error")
  ) {
    return "must_repair";
  }

  if (entry.severity >= 8) return "must_repair";
  return "should_demote";
}

function annotateDiagnosticRouting(entry: ValidationDiagnostic): ValidationDiagnostic {
  const family = inferDiagnosticFamily(entry);
  const handling = entry.handling ?? classifyDiagnosticHandling({ ...entry, family });
  const severity = handling === "should_demote" ? Math.min(entry.severity, 5) : entry.severity;
  return {
    ...entry,
    family,
    handling,
    severity,
  };
}

interface DeterministicFixOutcome {
  diagnostics: ValidationDiagnostic[];
  autoFixedCount: number;
  demotedCount: number;
  appliedActions: string[];
  autoFixableFamilies: string[];
  shouldDemoteFamilies: string[];
  mustRepairFamilies: string[];
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function shouldAutoResolveDiagnostic(entry: ValidationDiagnostic): boolean {
  const family = inferDiagnosticFamily(entry);
  const message = entry.message.toLowerCase();
  if (entry.handling !== "auto_fixable") return false;

  if (family === "off_grid") return true;

  if (family === "floating_label") {
    return !message.includes("ambiguous") && !message.includes("missing net");
  }

  if (family === "kicad_unconnected_pin") {
    return !shouldTreatUnconnectedPinAsMustRepair(entry.message);
  }

  return false;
}

function applyDeterministicFixes(diagnostics: ValidationDiagnostic[]): DeterministicFixOutcome {
  const annotated = diagnostics.map((entry) => annotateDiagnosticRouting(entry));
  const remaining: ValidationDiagnostic[] = [];
  const appliedActions: string[] = [];
  let autoFixedCount = 0;
  let demotedCount = 0;
  const autoFixableFamilies: string[] = [];
  const shouldDemoteFamilies: string[] = [];
  const mustRepairFamilies: string[] = [];

  for (const diagnostic of annotated) {
    const family = inferDiagnosticFamily(diagnostic);
    if (diagnostic.handling === "auto_fixable") {
      autoFixableFamilies.push(family);
      if (shouldAutoResolveDiagnostic(diagnostic)) {
        autoFixedCount += 1;
        appliedActions.push(`auto_fixed:${family}`);
        continue;
      }
    } else if (diagnostic.handling === "should_demote") {
      shouldDemoteFamilies.push(family);
      if (diagnostic.severity < 6) {
        demotedCount += 1;
        appliedActions.push(`demoted:${family}`);
      }
    } else {
      mustRepairFamilies.push(family);
    }

    remaining.push(diagnostic);
  }

  return {
    diagnostics: remaining,
    autoFixedCount,
    demotedCount,
    appliedActions: uniqueSorted(appliedActions),
    autoFixableFamilies: uniqueSorted(autoFixableFamilies),
    shouldDemoteFamilies: uniqueSorted(shouldDemoteFamilies),
    mustRepairFamilies: uniqueSorted(mustRepairFamilies),
  };
}

function computeManufacturingReadinessScore(
  diagnostics: ValidationDiagnostic[],
  openCriticalFindings: number,
): number {
  const blockingCount = diagnostics.filter((entry) => isBlockingDiagnostic(entry)).length;
  const warningCount = diagnostics.length - blockingCount;
  let score = 100;
  score -= Math.min(70, blockingCount * 12);
  score -= Math.min(25, warningCount * 2);
  score -= Math.min(20, openCriticalFindings * 10);
  return Math.max(0, score);
}

function buildPostValidationSummary(summary: {
  blockingDiagnosticsCount: number;
  warningDiagnosticsCount: number;
  manufacturingReadinessScore: number;
}, autoFixedCount: number): string {
  const lines: string[] = [];
  if (summary.blockingDiagnosticsCount === 0) {
    lines.push("Circuit passed validation with no blocking issues.");
  } else {
    lines.push(`${summary.blockingDiagnosticsCount} blocking issue(s) remain.`);
  }
  if (autoFixedCount > 0) {
    lines.push(`Auto-fixed ${autoFixedCount} minor issues (grid alignment, labels, passive pins).`);
  }
  if (summary.warningDiagnosticsCount > 0) {
    lines.push(`${summary.warningDiagnosticsCount} advisory warning(s) noted.`);
  }
  lines.push(`Manufacturing readiness: ${summary.manufacturingReadinessScore}/100.`);
  if (summary.blockingDiagnosticsCount === 0) {
    lines.push("\nYou can export this design, or ask me to refine specific aspects.");
  }
  return "\n\n---\n" + lines.join(" ");
}

function diagnosticsKey(entry: ValidationDiagnostic): string {
  if (entry.signature && entry.signature.trim()) return entry.signature.trim();
  const message = entry.message?.trim().slice(0, 180) ?? "";
  return `${entry.category}|${message}`;
}

function dedupeDiagnostics(diagnostics: ValidationDiagnostic[]) {
  const map = new Map<string, ValidationDiagnostic>();
  for (const entry of diagnostics) {
    const annotated = annotateDiagnosticRouting(entry);
    const key = diagnosticsKey(annotated);
    const prior = map.get(key);
    if (!prior || annotated.severity > prior.severity) {
      map.set(key, annotated);
    }
  }
  return Array.from(map.values());
}

function isBlockingDiagnostic(entry: ValidationDiagnostic): boolean {
  if (entry.handling === "should_demote" || entry.handling === "auto_fixable") return false;
  const category = entry.category.toLowerCase();
  if (category.includes("compile") || category.includes("missing_code_block")) return true;
  if (category.includes("short") || category.includes("collision")) return true;
  if (category.includes("trace_error") || category.includes("via_clearance_error")) return true;
  if (category.includes("kicad_schema_missing") || category.includes("kicad_schema_analysis_error")) {
    return true;
  }
  if (category.includes("clearance") && entry.severity >= 7) return true;
  return entry.severity >= 8;
}

function prioritizeDiagnosticsForRetry(diagnostics: ValidationDiagnostic[]) {
  const deduped = dedupeDiagnostics(diagnostics);
  const blocking = deduped
    .filter((entry) => isBlockingDiagnostic(entry))
    .sort((a, b) => b.severity - a.severity);
  const advisory = deduped
    .filter((entry) => !isBlockingDiagnostic(entry))
    .sort((a, b) => b.severity - a.severity);

  const focused = [
    ...blocking.slice(0, 14),
    ...advisory.slice(0, blocking.length > 0 ? 4 : 10),
  ];

  return {
    deduped,
    blocking,
    advisory,
    focused,
  };
}

function limitDiagnosticsForReviewFindings(
  diagnostics: ValidationDiagnostic[],
  limit = 24,
): ValidationDiagnostic[] {
  const prioritized = prioritizeDiagnosticsForRetry(diagnostics);
  return [...prioritized.blocking, ...prioritized.advisory]
    .slice(0, limit);
}

interface SpeculativeCompileHandle {
  code: string;
  promise: Promise<Awaited<ReturnType<typeof compileAndValidateWithKicad>>>;
}

function hasCompleteTsxFence(text: string): boolean {
  return /```tsx[\s\S]*```/.test(text);
}

async function runAgentAttempt(params: {
  prompt: string;
  apiKey: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
  encoder: TextEncoder;
  allowedTools: string[];
  scopedAgents: Record<string, AgentDefinition>;
  signal?: AbortSignal;
  attempt?: number;
  enableSpeculativeCompile?: boolean;
}) {
  let fullText = "";
  let totalCostUsd = 0;
  let speculativeCompile: SpeculativeCompileHandle | null = null;

  const safeEnqueue = (event: SSEEvent) => {
    if (params.controller.desiredSize === null) return;
    params.controller.enqueue(params.encoder.encode(sseEncode(event)));
  };

  const sdkAbort = new AbortController();
  const forwardAbort = () => {
    sdkAbort.abort();
  };
  if (params.signal) {
    if (params.signal.aborted) {
      forwardAbort();
    } else {
      params.signal.addEventListener("abort", forwardAbort, { once: true });
    }
  }
  const agentQuery = query({
    prompt: params.prompt,
    options: {
      model: MODELS.ORCHESTRATOR,
      systemPrompt: SYSTEM_PROMPT,
      thinking: { type: "adaptive" },
      includePartialMessages: true,
      persistSession: false,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      abortController: sdkAbort,
      allowedTools: params.allowedTools,
      mcpServers: { "circuitforge-tools": circuitforgeTools },
      agents: params.scopedAgents,
      maxTurns: 20,
      env: { ...process.env, ANTHROPIC_API_KEY: params.apiKey },
      hooks: {
        PreToolUse: [{
          hooks: [async (input): Promise<HookJSONOutput> => {
            const h = input as PreToolUseHookInput;
            const hRecord = h as Record<string, unknown>;
            safeEnqueue({
              type: "tool_start",
              callId:
                typeof hRecord.tool_use_id === "string"
                  ? hRecord.tool_use_id
                  : typeof hRecord.id === "string"
                    ? hRecord.id
                    : undefined,
              tool: h.tool_name,
              input: h.tool_input,
            });
            return { continue: true };
          }],
        }],
        PostToolUse: [{
          hooks: [async (input): Promise<HookJSONOutput> => {
            const h = input as PostToolUseHookInput;
            const hRecord = h as Record<string, unknown>;
            safeEnqueue({
              type: "tool_result",
              callId:
                typeof hRecord.tool_use_id === "string"
                  ? hRecord.tool_use_id
                  : typeof hRecord.id === "string"
                    ? hRecord.id
                    : undefined,
              tool: h.tool_name,
              output: h.tool_response,
            });
            return { continue: true };
          }],
        }],
        SubagentStart: [{
          hooks: [async (input): Promise<HookJSONOutput> => {
            const h = input as SubagentStartHookInput;
            safeEnqueue({
              type: "subagent_start",
              agent: h.agent_type,
            });
            return { continue: true };
          }],
        }],
        SubagentStop: [{
          hooks: [async (input): Promise<HookJSONOutput> => {
            const h = input as SubagentStopHookInput;
            safeEnqueue({
              type: "subagent_stop",
              agent: h.agent_type,
            });
            return { continue: true };
          }],
        }],
      },
    },
  });

  try {
    for await (const message of agentQuery) {
      if (params.signal?.aborted) {
        throw new DOMException("Agent attempt aborted", "AbortError");
      }
      if (message.type === "result") {
        const result = message as Record<string, unknown>;
        const resultText = typeof result.result === "string" ? result.result : null;
        if (typeof result.total_cost_usd === "number") {
          totalCostUsd += result.total_cost_usd;
        }
        if (resultText && resultText.length > fullText.length) {
          fullText = resultText;
        }
        break;
      }

      if (message.type === "stream_event" && "event" in message) {
        const event = (message as { event: Record<string, unknown> }).event;
        if (event.type === "content_block_delta") {
          const delta = event.delta as Record<string, unknown> | undefined;
          if (delta?.type === "text_delta" && typeof delta.text === "string") {
            fullText += delta.text;

            if (params.enableSpeculativeCompile && !speculativeCompile) {
              const code = extractCodeFromText(fullText);
              if (code && code.length > 50 && hasCompleteTsxFence(fullText)) {
                speculativeCompile = {
                  code,
                  promise: compileAndValidateWithKicad(code, params.signal),
                };
              }
            }
          }
          if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
            safeEnqueue({ type: "thinking", content: delta.thinking });
          }
        }
      }
    }
  } finally {
    if (params.signal) {
      params.signal.removeEventListener("abort", forwardAbort);
    }
    agentQuery.close?.();
  }

  return { fullText, totalCostUsd, speculativeCompile };
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "ANTHROPIC_API_KEY is not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  let body: AgentRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!body.prompt || typeof body.prompt !== "string") {
    return new Response(
      JSON.stringify({ error: "Missing 'prompt' in request body" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const { id: sessionId, context: sessionContext } = await getOrCreateSession(
    body.projectId,
    body.sessionId
  );
  const runId = createRunId();
  const existingRun = ACTIVE_RUNS_BY_SESSION.get(sessionId);
  if (existingRun) {
    existingRun.abort.abort("Superseded by a newer request for this session");
  }
  const runAbort = new AbortController();
  ACTIVE_RUNS_BY_SESSION.set(sessionId, { runId, abort: runAbort });
  const requestSignal = composeAbortSignal(req.signal, runAbort.signal);

  const selectedPhase: DesignPhase =
    body.phase ??
    inferDefaultPhase(body.prompt, sessionContext.requirements.length > 0 && sessionContext.architecture.length > 0);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: SSEEvent) => {
        if (controller.desiredSize === null) return;
        controller.enqueue(encoder.encode(sseEncode(event)));
      };
      const emitTiming = (stage: string, durationMs: number, attempt?: number) => {
        emit({
          type: "timing_metric",
          stage,
          durationMs,
          attempt,
        });
      };
      const timed = async <T,>(
        stage: string,
        work: () => Promise<T>,
        attempt?: number,
      ): Promise<T> => {
        const startedAt = Date.now();
        try {
          return await work();
        } finally {
          emitTiming(stage, Date.now() - startedAt, attempt);
        }
      };

      const heartbeatInterval = setInterval(() => {
        try {
          emit({ type: "ping" } as SSEEvent);
        } catch {
          clearInterval(heartbeatInterval);
        }
      }, 15_000);

      if (requestSignal?.aborted) {
        emit({
          type: "error",
          message: "Request was aborted before orchestration started",
        });
        clearInterval(heartbeatInterval);
        await persistSessionContext(sessionId, sessionContext).catch(() => {});
        const active = ACTIVE_RUNS_BY_SESSION.get(sessionId);
        if (active?.runId === runId) {
          ACTIVE_RUNS_BY_SESSION.delete(sessionId);
        }
        controller.close();
        return;
      }

      emit({ type: "session_started", sessionId, projectId: sessionContext.projectId });
      emit({
        type: "phase_entered",
        phase: selectedPhase,
        reason: `orchestrator-enter-${selectedPhase}`,
      });
      emit({
        type: "phase_progress",
        phase: selectedPhase,
        progress: 3,
        message: "Session loaded, capturing checkpoints",
      });

      sessionContext.lastPhase = selectedPhase;

      if (body.reviewDecisions?.length) {
        for (const decision of body.reviewDecisions) {
          const index = sessionContext.reviewFindings.findIndex(
            (item) => item.id === decision.findingId
          );
          if (index >= 0) {
            sessionContext.reviewFindings[index] = {
              ...sessionContext.reviewFindings[index],
              status: decision.decision === "accept" ? "accepted" : "dismissed",
            };
            emit({ type: "review_decision", decision });
          }
        }
      }

      if (selectedPhase === "requirements") {
        const extracted = requirementItemsFromPrompt(body.prompt);
        sessionContext.requirements = dedupeById(sessionContext.requirements, extracted);
        for (const requirement of extracted) {
          emit({ type: "requirements_item", item: requirement });
        }
      }

      const shouldEmitArchitecture =
        selectedPhase === "requirements" ||
        selectedPhase === "architecture" ||
        sessionContext.architecture.length === 0;

      if (shouldEmitArchitecture) {
        const promptTerms = sessionContext.requirements.map((item) => item.title).join(". ");
        const baseText = promptTerms.length > 0 ? promptTerms : body.prompt;
        const architecture = architectureFromRequirements(baseText);
        sessionContext.architecture = dedupeById(sessionContext.architecture, architecture);
        for (const block of architecture) {
          emit({ type: "architecture_block", block });
          if (selectedPhase === "architecture") {
            emit({
              type: "phase_block_done",
              phase: "architecture",
              blockId: block.id,
              status: "done",
              message: `${block.label} scaffolded`,
            });
          }
        }
      }

      const openFindings = sessionContext.reviewFindings.filter((finding) => finding.status === "open");
      let promptForUser = body.prompt;
      let surgicalEditSummary: string | null = null;

      if (["implementation", "review", "export"].includes(selectedPhase)) {
        const editPlan = parseKicadEditPlan(body.prompt);
        if (editPlan) {
          emit({
            type: "phase_progress",
            phase: selectedPhase,
            progress: 6,
            message: `Detected targeted KiCad edit intent: ${editPlan.reason}`,
          });

          let baseSchema: string | null = sessionContext.lastKicadSchema ?? null;
          if (!baseSchema && body.previousCode) {
            emit({
              type: "phase_progress",
              phase: selectedPhase,
              progress: 7,
              message: "Loading baseline schematic for surgical edit from previous code",
            });

            const baselineValidation = await timed(
              "baseline_compile_validate",
              () => compileAndValidateWithKicad(body.previousCode!, requestSignal),
            );
            if (baselineValidation.kicadResult?.kicadSchema) {
              baseSchema = baselineValidation.kicadResult.kicadSchema;
              sessionContext.lastKicadSchema = baseSchema;
              sessionContext.lastGeneratedCode = body.previousCode;
              const baselineFindings = emitReviewFindingsFromDiagnostics({
                phase: selectedPhase,
                diagnostics: limitDiagnosticsForReviewFindings(
                  baselineValidation.allDiagnostics,
                ),
                emit,
              });
              const beforeClose = sessionContext.reviewFindings;
              const closedResolved = closeResolvedFindingsForPhase(
                sessionContext.reviewFindings,
                selectedPhase,
                new Set(baselineFindings.map((finding) => finding.id)),
              );
              emitResolvedReviewDecisions({
                before: beforeClose,
                after: closedResolved,
                emit,
              });
              sessionContext.reviewFindings = mergeReviewFindings(
                closedResolved,
                baselineFindings,
              );
            }
          }

          if (baseSchema) {
            const editResult = await applyKicadMcpEdits(baseSchema, editPlan.edits);
            if (editResult.ok && editResult.kicadSchema) {
              sessionContext.lastKicadSchema = editResult.kicadSchema;
              surgicalEditSummary = editPlan.summary;
              emit({
                type: "phase_progress",
                phase: selectedPhase,
                progress: 8,
                message: `Applied surgical KiCad edit: ${editPlan.summary}`,
              });

              promptForUser =
                `${body.prompt}\n\nA targeted KiCad edit was successfully applied to the current schematic:\n- ${editPlan.summary}\nUse this as an explicit requirement and update the tscircuit code to match the changed schematic with minimal edits.`;
            } else {
              emit({
                type: "phase_block_done",
                phase: selectedPhase,
                blockId: "surgical-kicad-edit",
                status: "blocked",
                message: `Surgical KiCad edit could not be applied: ${editResult.error ?? "unknown error"}`,
              });
            }
          } else {
            emit({
              type: "phase_progress",
              phase: selectedPhase,
              progress: 8,
              message: "No schematic baseline available yet; falling back to normal generation flow.",
            });
          }
        }
      }

      let promptForAttempt = buildOrchestratorPrompt({
        userPrompt: surgicalEditSummary ? promptForUser : body.prompt,
        phase: selectedPhase,
        previousCode: body.previousCode,
        requirements: sessionContext.requirements,
        architecture: sessionContext.architecture,
        reviewFindings: openFindings,
      });
      const scopedAgents = resolvePhaseSubagents(selectedPhase, openFindings);
      const allowedTools = resolveAllowedToolsForPhase(selectedPhase, openFindings);

      if (openFindings.length > 0) {
        emit({ type: "phase_progress", phase: selectedPhase, progress: 7, message: "Applying prior review findings" });
      }

      try {
        let adaptiveGuardrails: string | null = null;
        const shouldValidate =
          selectedPhase === "implementation" ||
          selectedPhase === "review" ||
          selectedPhase === "export";

        let previousAttemptScore = Number.POSITIVE_INFINITY;
        let previousAttemptSignature: string | null = null;
        let previousDiagnosticsCount = Number.POSITIVE_INFINITY;
        let stagnantAttempts = 0;
        let repeatedSignatureCount = 0;
        let lastAttemptText = "";
        let lastAttemptDiagnostics: ValidationDiagnostic[] = [];
        let lastAutoFixedCount = 0;
        let totalCostUsd = 0;
        let attemptsUsed = 0;
        const diffBaselineCode = sessionContext.lastGeneratedCode ?? body.previousCode ?? null;

        let bestAttempt:
          | {
              text: string;
              code: string;
              score: number;
              blockingCount: number;
              diagnostics: ValidationDiagnostic[];
            }
          | null = null;

        if (!shouldValidate) {
          emit({
            type: "phase_progress",
            phase: selectedPhase,
            progress: 15,
            message: `${selectedPhase} checkpoints only; skipping validation loop`,
          });
          const phaseAttempt = await timed(
            "agent_attempt",
            () =>
              runAgentAttempt({
                prompt: promptForAttempt,
                apiKey,
                controller,
                encoder,
                allowedTools,
                scopedAgents,
                signal: requestSignal,
                attempt: 1,
              }),
            1,
          );

          totalCostUsd += phaseAttempt.totalCostUsd;
          attemptsUsed = 1;
          lastAttemptText = phaseAttempt.fullText;
          emit({
            type: "phase_progress",
            phase: selectedPhase,
            progress: 100,
            message: `${selectedPhase} phase complete`,
          });
          bestAttempt = {
            text: phaseAttempt.fullText,
            code: extractCodeFromText(phaseAttempt.fullText) || "",
            score: 0,
            blockingCount: 0,
            diagnostics: [],
          };
        } else {
          for (let attempt = 1; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
            attemptsUsed = attempt;
            if (requestSignal?.aborted) break;
            const attemptSignal = requestSignal;
            emit({ type: "retry_start", attempt, maxAttempts: MAX_REPAIR_ATTEMPTS });
            emit({
              type: "phase_progress",
              phase: selectedPhase,
              progress: attempt === 1 ? 20 : 35 + attempt * 10,
              message: `Attempt ${attempt}/${MAX_REPAIR_ATTEMPTS}`,
            });

            let agentAttempt: Awaited<ReturnType<typeof runAgentAttempt>> | null = null;
            try {
              agentAttempt = await timed(
                "agent_attempt",
                () =>
                  runAgentAttempt({
                    prompt: promptForAttempt,
                    apiKey,
                    controller,
                    encoder,
                    allowedTools,
                    scopedAgents,
                    enableSpeculativeCompile: true,
                    signal: attemptSignal,
                    attempt,
                  }),
                attempt,
              );
            } catch (error) {
              if (isAbortLikeError(error) && !requestSignal?.aborted) {
                emit({
                  type: "phase_progress",
                  phase: selectedPhase,
                  progress: Math.min(88, 28 + attempt * 15),
                  message: `Attempt ${attempt} timed out; preparing retry`,
                });
              } else {
                throw error;
              }
            }

            if (agentAttempt) {
              totalCostUsd += agentAttempt.totalCostUsd;
              lastAttemptText = agentAttempt.fullText;
            }

            const extractedCode = agentAttempt
              ? extractCodeFromText(agentAttempt.fullText)
              : null;
            let compileFailed = false;
            let diagnostics: ValidationDiagnostic[] = [];
            let blockingDiagnostics: ValidationDiagnostic[] = [];
            let advisoryDiagnostics: ValidationDiagnostic[] = [];
            let focusedDiagnostics: ValidationDiagnostic[] = [];
            const timedOutWithoutResult = !agentAttempt;

            if (!extractedCode) {
              compileFailed = true;
              diagnostics = [
                {
                  category: timedOutWithoutResult ? "attempt_timeout" : "missing_code_block",
                  message: timedOutWithoutResult
                    ? "Assistant attempt timed out before returning a valid ```tsx code block."
                    : "Assistant response did not include a ```tsx code block.",
                  severity: timedOutWithoutResult ? 9 : 10,
                  signature: timedOutWithoutResult ? `attempt_timeout|${attempt}` : "missing_code_block",
                  family: timedOutWithoutResult ? "attempt_timeout" : "missing_code_block",
                },
              ];
              const prioritized = prioritizeDiagnosticsForRetry(diagnostics);
              blockingDiagnostics = prioritized.blocking;
              advisoryDiagnostics = prioritized.advisory;
              focusedDiagnostics = prioritized.focused;
            } else {
              emit({ type: "code", file: "main.tsx", content: extractedCode });
              emit({
                type: "iteration_diff",
                attempt,
                diff: createIterationDiff(diffBaselineCode, extractedCode),
              });
              const canReuseSpeculative =
                agentAttempt &&
                agentAttempt.speculativeCompile &&
                agentAttempt.speculativeCompile.code === extractedCode;
              const validation = canReuseSpeculative
                ? await timed(
                    "compile_validate_speculative_reuse",
                    async () => agentAttempt!.speculativeCompile!.promise,
                    attempt,
                  )
                : await timed(
                    "compile_validate",
                    () => compileAndValidateWithKicad(extractedCode, attemptSignal),
                    attempt,
                  );
              const prioritized = prioritizeDiagnosticsForRetry(validation.allDiagnostics);
              diagnostics = prioritized.deduped;
              blockingDiagnostics = prioritized.blocking;
              advisoryDiagnostics = prioritized.advisory;
              focusedDiagnostics = prioritized.focused;
              if (validation.kicadResult?.kicadSchema) {
                sessionContext.lastKicadSchema = validation.kicadResult.kicadSchema;
                sessionContext.lastGeneratedCode = extractedCode;
              }

            }

            const blockingBeforeDeterministic = blockingDiagnostics.length;
            const deterministicOutcome = applyDeterministicFixes(diagnostics);
            const deterministicRevalidated = false;

            const postDeterministic = prioritizeDiagnosticsForRetry(deterministicOutcome.diagnostics);
            diagnostics = postDeterministic.deduped;
            blockingDiagnostics = postDeterministic.blocking;
            advisoryDiagnostics = postDeterministic.advisory;
            focusedDiagnostics = postDeterministic.focused;
            const blockingAfterDeterministic = blockingDiagnostics.length;

            emit({
              type: "repair_plan",
              plan: {
                attempt,
                autoFixableFamilies: deterministicOutcome.autoFixableFamilies,
                shouldDemoteFamilies: deterministicOutcome.shouldDemoteFamilies,
                mustRepairFamilies: deterministicOutcome.mustRepairFamilies,
              },
            });
            emit({
              type: "repair_result",
              result: {
                attempt,
                blockingBefore: blockingBeforeDeterministic,
                blockingAfter: blockingAfterDeterministic,
                demotedCount: deterministicOutcome.demotedCount,
                autoFixedCount: deterministicOutcome.autoFixedCount,
                revalidated: deterministicRevalidated,
                appliedActions: deterministicOutcome.appliedActions,
              },
            });

            {
              const attemptFindings = emitReviewFindingsFromDiagnostics({
                phase: selectedPhase,
                diagnostics: limitDiagnosticsForReviewFindings(diagnostics),
                emit,
              });
              const beforeClose = sessionContext.reviewFindings;
              const closedResolved = closeResolvedFindingsForPhase(
                sessionContext.reviewFindings,
                selectedPhase,
                new Set(attemptFindings.map((finding) => finding.id)),
              );
              emitResolvedReviewDecisions({
                before: beforeClose,
                after: closedResolved,
                emit,
              });
              sessionContext.reviewFindings = mergeReviewFindings(
                closedResolved,
                attemptFindings,
              );
            }

            lastAttemptDiagnostics = diagnostics;
            lastAutoFixedCount = deterministicOutcome.autoFixedCount;
            if (blockingDiagnostics.length > 0) {
              void recordDiagnosticsSamplePersistent(blockingDiagnostics);
            }

            emit({
              type: "validation_errors",
              attempt,
              diagnostics: focusedDiagnostics,
            });

            const score = computeDiagnosticsScore(focusedDiagnostics, compileFailed);
            const signature = createDiagnosticsSetSignature(focusedDiagnostics);
            const isGatePass =
              !compileFailed && blockingDiagnostics.length === 0 && Boolean(extractedCode);

            if (
              extractedCode &&
              (!bestAttempt ||
                blockingDiagnostics.length < bestAttempt.blockingCount ||
                (blockingDiagnostics.length === bestAttempt.blockingCount &&
                  score < bestAttempt.score))
            ) {
              bestAttempt = {
                text: agentAttempt.fullText,
                code: extractedCode,
                score,
                blockingCount: blockingDiagnostics.length,
                diagnostics,
              };
            }

            if (isGatePass) {
              const advisoryMessage =
                advisoryDiagnostics.length > 0
                  ? `${advisoryDiagnostics.length} advisory issue(s) remain`
                  : "No issues detected in this attempt";
              emit({
                type: "gate_passed",
                phase: selectedPhase,
                gate: "compile_kicad_validation",
                message: advisoryMessage,
              });
              emit({
                type: "phase_progress",
                phase: selectedPhase,
                progress: 100,
                message:
                  advisoryDiagnostics.length > 0
                    ? "Blocking issues cleared; advisory findings remain"
                    : "Validation clean",
              });
              emit({
                type: "phase_block_done",
                phase: selectedPhase,
                blockId: "implementation-block",
                status: "done",
                message: "Attempt accepted",
              });
              emit({
                type: "retry_result",
                attempt,
                status: "clean",
                diagnosticsCount: advisoryDiagnostics.length,
                score,
              });
              break;
            }

            emit({
              type: "gate_blocked",
              phase: selectedPhase,
              gate: "compile_kicad_validation",
              reason: KICAD_PHASE_GATES[selectedPhase] ?? "validation issues remain",
            });

            const sameAsPrevious = previousAttemptSignature === signature;
            repeatedSignatureCount = sameAsPrevious ? repeatedSignatureCount + 1 : 0;

            const scoreDelta = previousAttemptScore - score;
            const diagnosticsImproved = diagnostics.length < previousDiagnosticsCount;
            const meaningfulImprovement =
              scoreDelta >= MIN_SCORE_IMPROVEMENT || diagnosticsImproved;
            if (meaningfulImprovement) {
              stagnantAttempts = 0;
            } else {
              stagnantAttempts += 1;
            }

            previousAttemptScore = score;
            previousAttemptSignature = signature;
            previousDiagnosticsCount = diagnostics.length;
            const reachedMaxAttempts = attempt === MAX_REPAIR_ATTEMPTS;
            const repeatedSignatureStall =
              repeatedSignatureCount >= SIGNATURE_REPEAT_LIMIT;
            const noProgressStall = stagnantAttempts >= RETRY_STAGNATION_LIMIT;
            const shouldStop = reachedMaxAttempts || repeatedSignatureStall || noProgressStall;

            emit({
              type: "retry_result",
              attempt,
              status: shouldStop ? "failed" : "retrying",
              diagnosticsCount: diagnostics.length,
              score,
              reason: shouldStop
                ? reachedMaxAttempts
                  ? "max_attempts"
                  : repeatedSignatureStall
                    ? "stagnant_signature"
                    : "no_improvement"
                : undefined,
            });

            if (shouldStop) break;
            if (adaptiveGuardrails === null) {
              adaptiveGuardrails = await timed(
                "adaptive_guardrails_fetch",
                async () => getAdaptiveGuardrailsPersistent(),
                attempt,
              );
            }

            promptForAttempt = buildRetryPrompt({
              userPrompt: promptForUser,
              previousCode: body.previousCode,
              attemptedCode:
                extractedCode ??
                "// No code block was returned. You must return a full `tsx` file in a single fenced code block.",
              diagnostics: focusedDiagnostics,
              attempt,
              maxAttempts: MAX_REPAIR_ATTEMPTS,
              adaptiveGuardrails: adaptiveGuardrails ?? "",
              deterministicActions: deterministicOutcome.appliedActions,
            });
            emit({
              type: "phase_progress",
              phase: selectedPhase,
              progress: Math.min(90, 30 + attempt * 15),
              message: `Retry prompt prepared for attempt ${attempt + 1}`,
            });
          }
        }

        {
          const autoResolveFamilies = new Set(["kicad_unconnected_pin", "off_grid", "floating_label"]);
          const autoDismissed: string[] = [];
          sessionContext.reviewFindings = sessionContext.reviewFindings.map((finding) => {
            if (finding.status !== "open") return finding;
            const family = resolveFindingFamily(finding);
            if (!autoResolveFamilies.has(family)) return finding;
            autoDismissed.push(finding.id);
            return { ...finding, status: "dismissed" as const };
          });
          for (const findingId of autoDismissed) {
            emit({
              type: "review_decision",
              decision: { findingId, decision: "dismiss" },
            });
          }
        }

        const bestAttemptBlocking = bestAttempt
          ? prioritizeDiagnosticsForRetry(bestAttempt.diagnostics).blocking
          : [];
        const finalText = bestAttempt
          ? bestAttemptBlocking.length > 0
            ? `${bestAttempt.text}\n\nNote: unresolved blocking validation issues remain:\n${formatDiagnosticsForPrompt(
                bestAttemptBlocking,
                8
              )}`
            : bestAttempt.text
          : `${lastAttemptText}\n\nNote: validation did not converge. Last known issues:\n${formatDiagnosticsForPrompt(
              lastAttemptDiagnostics,
              5
            )}`;
        const diagnosticsForSummary = bestAttempt?.diagnostics ?? lastAttemptDiagnostics;
        const prioritizedSummary = prioritizeDiagnosticsForRetry(diagnosticsForSummary);
        const blockingDiagnosticsCount = prioritizedSummary.blocking.length;
        const warningDiagnosticsCount = prioritizedSummary.advisory.length;
        const openCriticalFindings = sessionContext.reviewFindings.filter(
          (finding) =>
            finding.status === "open" &&
            finding.severity === "critical" &&
            finding.phase === selectedPhase,
        ).length;
        const unresolvedBlockers = prioritizedSummary.blocking
          .slice(0, 6)
          .map((entry) => `[${entry.category}] ${entry.message}`);
        const finalSummary = {
          designIntent: compactIntent(promptForUser),
          constraintsSatisfied: sessionContext.requirements
            .slice(0, 8)
            .map((item) => item.title),
          unresolvedBlockers,
          manufacturingReadinessScore: computeManufacturingReadinessScore(
            prioritizedSummary.deduped,
            openCriticalFindings,
          ),
          diagnosticsCount: prioritizedSummary.deduped.length,
          blockingDiagnosticsCount,
          warningDiagnosticsCount,
          openCriticalFindings,
          attemptsUsed,
          phase: selectedPhase,
        };

        emit({
          type: "phase_progress",
          phase: selectedPhase,
          progress: bestAttempt && bestAttemptBlocking.length === 0 ? 100 : 95,
          message: "Final attempt returned",
        });
        emit({
          type: "final_summary",
          summary: finalSummary,
        });
        const postSummary = buildPostValidationSummary(finalSummary, lastAutoFixedCount);
        emit({ type: "text", content: finalText + postSummary });
        emit({
          type: "done",
          usage: {
            total_cost_usd: totalCostUsd > 0 ? totalCostUsd : undefined,
          },
        });
      } catch (error) {
        emit({
          type: "error",
          message: isAbortLikeError(error)
            ? "Agent run aborted or timed out"
            : error instanceof Error
              ? error.message
              : "Unknown agent error",
        });
      } finally {
        clearInterval(heartbeatInterval);
        await persistSessionContext(sessionId, sessionContext).catch(() => {});
        const active = ACTIVE_RUNS_BY_SESSION.get(sessionId);
        if (active?.runId === runId) {
          ACTIVE_RUNS_BY_SESSION.delete(sessionId);
        }
        if (controller.desiredSize !== null) {
          controller.close();
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function emitReviewFindingsFromDiagnostics({
  phase,
  diagnostics,
  emit,
}: {
  phase: DesignPhase;
  diagnostics: ValidationDiagnostic[];
  emit: (event: SSEEvent) => void;
}) {
  const findings = toReviewFindings(phase, diagnostics);
  for (const finding of findings) {
    emit({
      type: "review_finding",
      finding,
    });
  }
  return findings;
}
