import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  PreToolUseHookInput,
  PostToolUseHookInput,
  SubagentStartHookInput,
  SubagentStopHookInput,
  HookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";
import { MODELS } from "@/lib/agent/models";
import {
  buildOrchestratorPrompt,
  SYSTEM_PROMPT,
  requirementItemsFromPrompt,
  architectureFromRequirements,
} from "@/lib/agent/prompt";
import { circuitforgeTools } from "@/lib/agent/tools";
import { subagents } from "@/lib/agent/subagents";
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
import type {
  SSEEvent,
  AgentRequest,
  ValidationDiagnostic,
  ReviewFinding,
  RequirementItem,
  ArchitectureNode,
  DesignPhase,
} from "@/lib/stream/types";

export const runtime = "nodejs";
export const maxDuration = 300;
const MAX_REPAIR_ATTEMPTS = 3;

const MEMORY_BY_SESSION = new Map<
  string,
  {
    projectId?: string;
    requirements: RequirementItem[];
    architecture: ArchitectureNode[];
    reviewFindings: ReviewFinding[];
    lastPhase?: DesignPhase;
    lastKicadSchema?: string;
    lastGeneratedCode?: string;
  }
>();

const PREVENTIVE_LAYOUT_GUARDRAILS = `
Recurring PCB DRC failures to avoid up front:
- Avoid trace overlaps/crossings: do not route two nets through the same corridor.
- Keep trace spacing conservative (target >= 0.25mm) between unrelated nets.
- Keep vias from different nets separated (target >= 0.8mm center spacing).
- Do not drop two vias near the same choke point unless they share a net.
- Prefer short orthogonal routing with clear channel separation around dense IC pins.
`;

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
  const compact = raw.trim().replace(/["'`]/g, "").replace(/[,.;:)]/g, "").replace(/\s+/g, "");
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

  const valueChangeMatch = lower.match(
    /(?:change|set|modify|update|adjust)\s+(?<reference>[a-z]+\d+[a-z]?)\b[^\n]{0,80}?\b(?:to|=)\s+(?<value>[^\n.,;)]{1,24})/i,
  );
  if (valueChangeMatch?.groups) {
    const reference = valueChangeMatch.groups.reference.toUpperCase();
    const normalizedValue = normalizeKicadValue(valueChangeMatch.groups.value ?? "");
    if (normalizedValue) {
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
    /(?:add|insert|place|put)\s+(?<description>[^\n]{0,90}?)\s+(?:near|next to|beside|by|alongside)\s+(?<reference>[a-z]+\d+[a-z]?)\b/i,
  );
  if (addNearMatch?.groups) {
    const description = addNearMatch.groups.description ?? "";
    const reference = normalizeReference(addNearMatch.groups.reference);
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
    /(?:connect|wire)\s+(?<from>[a-z]+\d+[a-z]?)\s+(?:to|and|with)\s+(?<to>[a-z]+\d+[a-z]?)\b/i,
  );
  if (connectMatch?.groups) {
    const from = normalizeReference(connectMatch.groups.from);
    const to = normalizeReference(connectMatch.groups.to);
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
    /(?:add|draw|route)\s+wire\s+(?:from\s*)?(?<x1>-?\d+(?:\.\d+)?)\s*,?\s*(?<y1>-?\d+(?:\.\d+)?)\s*(?:to|and)\s*(?<x2>-?\d+(?:\.\d+)?)\s*,?\s*(?<y2>-?\d+(?:\.\d+)?)\s*$/i,
  );
  if (explicitWireMatch?.groups) {
    const startX = Number.parseFloat(explicitWireMatch.groups.x1);
    const startY = Number.parseFloat(explicitWireMatch.groups.y1);
    const endX = Number.parseFloat(explicitWireMatch.groups.x2);
    const endY = Number.parseFloat(explicitWireMatch.groups.y2);

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

  const removeMatch = lower.match(/(?:remove|delete)\s+(?<reference>[a-z]+\d+[a-z]?)\b/i);
  if (removeMatch?.groups?.reference) {
    const reference = removeMatch.groups.reference.toUpperCase();
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

function sseEncode(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function getOrCreateSession(projectId?: string, sessionId?: string) {
  const resolved = sessionId?.trim() || createSessionId();
  const existing = MEMORY_BY_SESSION.get(resolved);
  if (existing) {
    if (projectId && !existing.projectId) existing.projectId = projectId;
    return { id: resolved, context: existing };
  }

  const context = {
    projectId,
    requirements: [] as RequirementItem[],
    architecture: [] as ArchitectureNode[],
    reviewFindings: [] as ReviewFinding[],
    lastPhase: undefined as DesignPhase | undefined,
  };
  MEMORY_BY_SESSION.set(resolved, context);
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

function makeReviewId(phase: DesignPhase, entry: ValidationDiagnostic) {
  const source = entry.source ?? "tscircuit";
  const signature = entry.signature ? entry.signature.replaceAll(":", "-") : entry.category;
  return `${phase}-${source}-${signature}`;
}

function severityFromDiagnostic(phase: DesignPhase, diagnostic: ValidationDiagnostic): "critical" | "warning" | "info" {
  if (diagnostic.category.includes("compile") || diagnostic.category.includes("missing_code_block")) return "critical";
  if (diagnostic.category.includes("short") || diagnostic.severity >= 7 || phase === "review") return "warning";
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
    isBlocking: diagnostic.category.includes("compile") || diagnostic.severity >= 8,
    status: "open",
    source: diagnostic.source,
    createdAt: Date.now(),
  }));
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

Targeted fix guidance:
${hints.length > 0 ? hints.join("\n") : "- No targeted guidance available; apply general PCB guardrails."}
${adaptiveSection}

Requirements:
1. Return a complete, self-contained tscircuit file in a single \`\`\`tsx block.
2. Preserve the user's requested functionality.
3. Fix the reported issues without adding unsafe changes.
`;
}

async function runAgentAttempt(params: {
  prompt: string;
  apiKey: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
  encoder: TextEncoder;
}) {
  let fullText = "";
  let totalCostUsd = 0;

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
      allowedTools: [
        "WebFetch",
        "WebSearch",
        "Task",
        "mcp__circuitforge-tools__search_parts",
      ],
      mcpServers: { "circuitforge-tools": circuitforgeTools },
      agents: subagents,
      maxTurns: 20,
      env: { ...process.env, ANTHROPIC_API_KEY: params.apiKey },
      hooks: {
        PreToolUse: [{
          hooks: [async (input): Promise<HookJSONOutput> => {
            const h = input as PreToolUseHookInput;
            params.controller.enqueue(
              params.encoder.encode(
                sseEncode({
                  type: "tool_start",
                  tool: h.tool_name,
                  input: h.tool_input,
                })
              )
            );
            return { continue: true };
          }],
        }],
        PostToolUse: [{
          hooks: [async (input): Promise<HookJSONOutput> => {
            const h = input as PostToolUseHookInput;
            params.controller.enqueue(
              params.encoder.encode(
                sseEncode({
                  type: "tool_result",
                  tool: h.tool_name,
                  output: h.tool_response,
                })
              )
            );
            return { continue: true };
          }],
        }],
        SubagentStart: [{
          hooks: [async (input): Promise<HookJSONOutput> => {
            const h = input as SubagentStartHookInput;
            params.controller.enqueue(
              params.encoder.encode(
                sseEncode({
                  type: "subagent_start",
                  agent: h.agent_type,
                })
              )
            );
            return { continue: true };
          }],
        }],
        SubagentStop: [{
          hooks: [async (input): Promise<HookJSONOutput> => {
            const h = input as SubagentStopHookInput;
            params.controller.enqueue(
              params.encoder.encode(
                sseEncode({
                  type: "subagent_stop",
                  agent: h.agent_type,
                })
              )
            );
            return { continue: true };
          }],
        }],
      },
    },
  });

  for await (const message of agentQuery) {
    if (message.type === "result") {
      const result = message as Record<string, unknown>;
      if (typeof result.total_cost_usd === "number") {
        totalCostUsd += result.total_cost_usd;
      }
      break;
    }

    if (message.type === "stream_event" && "event" in message) {
      const event = (message as { event: Record<string, unknown> }).event;
      if (event.type === "content_block_delta") {
        const delta = event.delta as Record<string, unknown> | undefined;
        if (delta?.type === "text_delta" && typeof delta.text === "string") {
          fullText += delta.text;
        }
        if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
          params.controller.enqueue(
            params.encoder.encode(
              sseEncode({ type: "thinking", content: delta.thinking })
            )
          );
        }
      }
    }
  }

  return { fullText, totalCostUsd };
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

  const { id: sessionId, context: sessionContext } = getOrCreateSession(
    body.projectId,
    body.sessionId
  );

  const selectedPhase: DesignPhase =
    body.phase ??
    inferDefaultPhase(body.prompt, sessionContext.requirements.length > 0 && sessionContext.architecture.length > 0);

  const encoder = new TextEncoder();
  const adaptiveGuardrails = await getAdaptiveGuardrailsPersistent();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: SSEEvent) => {
        controller.enqueue(encoder.encode(sseEncode(event)));
      };

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

      if (selectedPhase === "requirements" || selectedPhase === "architecture") {
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

            const baselineValidation = await compileAndValidateWithKicad(body.previousCode);
            if (baselineValidation.kicadResult?.kicadSchema) {
              baseSchema = baselineValidation.kicadResult.kicadSchema;
              sessionContext.lastKicadSchema = baseSchema;
              sessionContext.lastGeneratedCode = body.previousCode;
              sessionContext.reviewFindings = mergeReviewFindings(
                sessionContext.reviewFindings,
                emitReviewFindingsFromDiagnostics({
                  phase: selectedPhase,
                  diagnostics: baselineValidation.allDiagnostics,
                  emit,
                })
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

      if (openFindings.length > 0) {
        emit({ type: "phase_progress", phase: selectedPhase, progress: 7, message: "Applying prior review findings" });
      }

      try {
        const shouldValidate =
          selectedPhase === "implementation" ||
          selectedPhase === "review" ||
          selectedPhase === "export";

        let previousAttemptScore = Number.POSITIVE_INFINITY;
        let previousAttemptSignature: string | null = null;
        let stagnantAttempts = 0;
        let lastAttemptText = "";
        let lastAttemptDiagnostics: ValidationDiagnostic[] = [];
        let totalCostUsd = 0;

        let bestAttempt:
          | { text: string; code: string; score: number; diagnostics: ValidationDiagnostic[] }
          | null = null;

        if (!shouldValidate) {
          emit({
            type: "phase_progress",
            phase: selectedPhase,
            progress: 15,
            message: `${selectedPhase} checkpoints only; skipping validation loop`,
          });
          const phaseAttempt = await runAgentAttempt({
            prompt: promptForAttempt,
            apiKey,
            controller,
            encoder,
          });

          totalCostUsd += phaseAttempt.totalCostUsd;
          lastAttemptText = phaseAttempt.fullText;
          emit({
            type: "text",
            content: phaseAttempt.fullText,
          });
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
            diagnostics: [],
          };
        } else {
          for (let attempt = 1; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
            emit({ type: "retry_start", attempt, maxAttempts: MAX_REPAIR_ATTEMPTS });
            emit({
              type: "phase_progress",
              phase: selectedPhase,
              progress: attempt === 1 ? 20 : 35 + attempt * 10,
              message: `Attempt ${attempt}/${MAX_REPAIR_ATTEMPTS}`,
            });

            const agentAttempt = await runAgentAttempt({
              prompt: promptForAttempt,
              apiKey,
              controller,
              encoder,
            });

            totalCostUsd += agentAttempt.totalCostUsd;
            lastAttemptText = agentAttempt.fullText;

            const extractedCode = extractCodeFromText(agentAttempt.fullText);
            let compileFailed = false;
            let diagnostics: ValidationDiagnostic[] = [];

            if (!extractedCode) {
              compileFailed = true;
              diagnostics = [
                {
                  category: "missing_code_block",
                  message: "Assistant response did not include a ```tsx code block.",
                  severity: 10,
                  signature: "missing_code_block",
                },
              ];
            } else {
              const validation = await compileAndValidateWithKicad(extractedCode);
              diagnostics = validation.allDiagnostics;
              if (validation.kicadResult?.kicadSchema) {
                sessionContext.lastKicadSchema = validation.kicadResult.kicadSchema;
                sessionContext.lastGeneratedCode = extractedCode;
              }

              sessionContext.reviewFindings = mergeReviewFindings(
                sessionContext.reviewFindings,
                emitReviewFindingsFromDiagnostics({
                  phase: selectedPhase,
                  diagnostics,
                  emit,
                })
              );
            }

            lastAttemptDiagnostics = diagnostics;
            if (!compileFailed && diagnostics.length === 0 && extractedCode) {
              // keep all findings open until user explicitly acts on them
            } else if (diagnostics.length > 0) {
              void recordDiagnosticsSamplePersistent(diagnostics);
            }

            emit({
              type: "validation_errors",
              attempt,
              diagnostics,
            });

            const score = computeDiagnosticsScore(diagnostics, compileFailed);
            const signature = createDiagnosticsSetSignature(diagnostics);
            const isClean =
              !compileFailed && diagnostics.length === 0 && Boolean(extractedCode);

            if (extractedCode && (!bestAttempt || score < bestAttempt.score)) {
              bestAttempt = {
                text: agentAttempt.fullText,
                code: extractedCode,
                score,
                diagnostics,
              };
            }

            if (isClean) {
              emit({
                type: "gate_passed",
                phase: selectedPhase,
                gate: "compile_kicad_validation",
                message: "No issues detected in this attempt",
              });
              emit({
                type: "phase_progress",
                phase: selectedPhase,
                progress: 100,
                message: "Validation clean",
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
                diagnosticsCount: 0,
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
            if (score < previousAttemptScore) {
              stagnantAttempts = 0;
            } else {
              stagnantAttempts += 1;
            }

            previousAttemptScore = score;
            previousAttemptSignature = signature;
            const reachedMaxAttempts = attempt === MAX_REPAIR_ATTEMPTS;
            const shouldStop = reachedMaxAttempts || sameAsPrevious || stagnantAttempts >= 2;

            emit({
              type: "retry_result",
              attempt,
              status: shouldStop ? "failed" : "retrying",
              diagnosticsCount: diagnostics.length,
              score,
              reason: shouldStop
                ? reachedMaxAttempts
                  ? "max_attempts"
                  : sameAsPrevious
                    ? "stagnant_signature"
                    : "no_improvement"
                : undefined,
            });

            if (shouldStop) break;

            promptForAttempt = buildRetryPrompt({
              userPrompt: promptForUser,
              previousCode: body.previousCode,
              attemptedCode:
                extractedCode ??
                "// No code block was returned. You must return a full `tsx` file in a single fenced code block.",
              diagnostics,
              attempt,
              maxAttempts: MAX_REPAIR_ATTEMPTS,
              adaptiveGuardrails,
            });
            emit({
              type: "phase_progress",
              phase: selectedPhase,
              progress: Math.min(90, 30 + attempt * 15),
              message: `Retry prompt prepared for attempt ${attempt + 1}`,
            });
          }
        }

        const finalText = bestAttempt
          ? bestAttempt.diagnostics.length > 0
            ? `${bestAttempt.text}\n\nNote: unresolved validation issues remain:\n${formatDiagnosticsForPrompt(
                bestAttempt.diagnostics,
                8
              )}`
            : bestAttempt.text
          : `${lastAttemptText}\n\nNote: validation did not converge. Last known issues:\n${formatDiagnosticsForPrompt(
              lastAttemptDiagnostics,
              5
            )}`;

        emit({
          type: "phase_progress",
          phase: selectedPhase,
          progress: bestAttempt && bestAttempt.diagnostics.length === 0 ? 100 : 95,
          message: "Final attempt returned",
        });
        emit({ type: "text", content: finalText });
        emit({
          type: "done",
          usage: {
            total_cost_usd: totalCostUsd > 0 ? totalCostUsd : undefined,
          },
        });
      } catch (error) {
        emit({
          type: "error",
          message: error instanceof Error ? error.message : "Unknown agent error",
        });
      } finally {
        controller.close();
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
