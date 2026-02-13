import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  PreToolUseHookInput,
  PostToolUseHookInput,
  SubagentStartHookInput,
  SubagentStopHookInput,
  HookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";
import { MODELS } from "@/lib/agent/models";
import { SYSTEM_PROMPT } from "@/lib/agent/prompt";
import { circuitforgeTools } from "@/lib/agent/tools";
import { subagents } from "@/lib/agent/subagents";
import { extractCodeFromText } from "@/lib/agent/code";
import {
  compileForValidation,
  computeDiagnosticsScore,
  createCompileFailureDiagnostics,
  createDiagnosticsSetSignature,
  extractValidationDiagnostics,
  formatDiagnosticsForPrompt,
} from "@/lib/agent/repairLoop";
import {
  getAdaptiveGuardrailsPersistent,
  recordDiagnosticsSamplePersistent,
} from "@/lib/agent/persistentErrorMemory";
import type { SSEEvent, AgentRequest, ValidationDiagnostic } from "@/lib/stream/types";

export const runtime = "nodejs";
export const maxDuration = 300;
const MAX_REPAIR_ATTEMPTS = 3;
const PREVENTIVE_LAYOUT_GUARDRAILS = `
Recurring PCB DRC failures to avoid up front:
- Avoid trace overlaps/crossings: do not route two nets through the same corridor.
- Keep trace spacing conservative (target >= 0.25mm between unrelated nets).
- Keep vias from different nets separated (target >= 0.8mm center spacing).
- Do not drop two vias near the same choke point unless they share a net.
- Prefer short orthogonal routing with clear channel separation around dense IC pins.
`;

function sseEncode(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function buildInitialPrompt(prompt: string, adaptiveGuardrails: string, previousCode?: string) {
  const adaptiveSection = adaptiveGuardrails ? `\n\n${adaptiveGuardrails}` : "";
  if (!previousCode) {
    return `${prompt}\n\n${PREVENTIVE_LAYOUT_GUARDRAILS}${adaptiveSection}`;
  }
  return `The user previously designed a circuit. Here is the existing tscircuit code:\n\n\`\`\`tsx\n${previousCode}\n\`\`\`\n\nThe user now says: ${prompt}\n\nModify or extend the existing design based on the user's request.\n\n${PREVENTIVE_LAYOUT_GUARDRAILS}${adaptiveSection}`;
}

function buildTargetedFixHints(diagnostics: ValidationDiagnostic[]) {
  const categories = new Set(diagnostics.map((d) => d.category));
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

  return hints.join("\n");
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
  const targetedFixHints = buildTargetedFixHints(params.diagnostics);
  const adaptiveSection = params.adaptiveGuardrails
    ? `\nRecent learned failure patterns:\n${params.adaptiveGuardrails}\n`
    : "";
  const previousCodeSection = params.previousCode
    ? `\nOriginal baseline code from the user context:\n\`\`\`tsx\n${params.previousCode}\n\`\`\`\n`
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
${targetedFixHints || "- No targeted guidance available; apply general PCB clearance/routing best practices."}
${adaptiveSection}

Requirements:
1. Return a complete, self-contained tscircuit file in a single \`\`\`tsx block.
2. Preserve the user's requested functionality.
3. Fix the reported issues without introducing new footprint/schema mistakes.
4. Keep component naming stable where possible.
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
            params.controller.enqueue(params.encoder.encode(sseEncode({
              type: "tool_start", tool: h.tool_name, input: h.tool_input,
            })));
            return { continue: true };
          }],
        }],
        PostToolUse: [{
          hooks: [async (input): Promise<HookJSONOutput> => {
            const h = input as PostToolUseHookInput;
            params.controller.enqueue(params.encoder.encode(sseEncode({
              type: "tool_result", tool: h.tool_name, output: h.tool_response,
            })));
            return { continue: true };
          }],
        }],
        SubagentStart: [{
          hooks: [async (input): Promise<HookJSONOutput> => {
            const h = input as SubagentStartHookInput;
            params.controller.enqueue(params.encoder.encode(sseEncode({
              type: "subagent_start", agent: h.agent_type,
            })));
            return { continue: true };
          }],
        }],
        SubagentStop: [{
          hooks: [async (input): Promise<HookJSONOutput> => {
            const h = input as SubagentStopHookInput;
            params.controller.enqueue(params.encoder.encode(sseEncode({
              type: "subagent_stop", agent: h.agent_type,
            })));
            return { continue: true };
          }],
        }],
      },
    },
  });

  for await (const message of agentQuery) {
    if (message.type === "stream_event" && "event" in message) {
      const event = (message as { event: Record<string, unknown> }).event;

      if (event.type === "content_block_delta") {
        const delta = event.delta as Record<string, unknown> | undefined;
        if (delta?.type === "text_delta" && typeof delta.text === "string") {
          fullText += delta.text;
        }
        if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
          params.controller.enqueue(params.encoder.encode(sseEncode({
            type: "thinking",
            content: delta.thinking,
          })));
        }
      }
    }

    if (message.type === "result") {
      const result = message as Record<string, unknown>;
      if (typeof result.total_cost_usd === "number") {
        totalCostUsd += result.total_cost_usd;
      }
      break;
    }
  }

  return {
    fullText,
    totalCostUsd,
  };
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

  const encoder = new TextEncoder();
  const adaptiveGuardrails = await getAdaptiveGuardrailsPersistent();
  const initialPrompt = buildInitialPrompt(body.prompt, adaptiveGuardrails, body.previousCode);

  const stream = new ReadableStream({
    async start(controller) {
      try {
        let promptForAttempt = initialPrompt;
        let totalCostUsd = 0;
        let previousAttemptScore = Number.POSITIVE_INFINITY;
        let previousAttemptSignature: string | null = null;
        let stagnantAttempts = 0;
        let lastAttemptText = "";
        let lastAttemptDiagnostics: ValidationDiagnostic[] = [];

        let bestAttempt: {
          text: string;
          code: string;
          score: number;
          diagnostics: ValidationDiagnostic[];
        } | null = null;

        for (let attempt = 1; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
          controller.enqueue(encoder.encode(sseEncode({
            type: "retry_start",
            attempt,
            maxAttempts: MAX_REPAIR_ATTEMPTS,
          })));

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
            diagnostics = [{
              category: "missing_code_block",
              message: "Assistant response did not include a ```tsx code block.",
              severity: 10,
              signature: "missing_code_block",
            }];
          } else {
            const compileResult = await compileForValidation(extractedCode);
            if (!compileResult.ok || !compileResult.circuitJson) {
              compileFailed = true;
              diagnostics = createCompileFailureDiagnostics(
                compileResult.errorMessage ?? `Compile failed: ${compileResult.status}`
              );
            } else {
              diagnostics = extractValidationDiagnostics(compileResult.circuitJson);
            }
          }

          lastAttemptDiagnostics = diagnostics;
          if (diagnostics.length > 0) {
            void recordDiagnosticsSamplePersistent(diagnostics);
          }

          controller.enqueue(encoder.encode(sseEncode({
            type: "validation_errors",
            attempt,
            diagnostics,
          })));

          const score = computeDiagnosticsScore(diagnostics, compileFailed);
          const signature = createDiagnosticsSetSignature(diagnostics);
          const isClean = !compileFailed && diagnostics.length === 0 && Boolean(extractedCode);

          if (extractedCode && (!bestAttempt || score < bestAttempt.score)) {
            bestAttempt = {
              text: agentAttempt.fullText,
              code: extractedCode,
              score,
              diagnostics,
            };
          }

          if (isClean) {
            controller.enqueue(encoder.encode(sseEncode({
              type: "retry_result",
              attempt,
              status: "clean",
              diagnosticsCount: 0,
              score,
            })));
            break;
          }

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

          controller.enqueue(encoder.encode(sseEncode({
            type: "retry_result",
            attempt,
            status: shouldStop ? "failed" : "retrying",
            diagnosticsCount: diagnostics.length,
            score,
            reason: shouldStop
              ? (reachedMaxAttempts
                ? "max_attempts"
                : sameAsPrevious
                  ? "stagnant_signature"
                  : "no_improvement")
              : undefined,
          })));

          if (shouldStop) break;

          promptForAttempt = buildRetryPrompt({
            userPrompt: body.prompt,
            previousCode: body.previousCode,
            attemptedCode:
              extractedCode ??
              "// No code block was returned. You must return a full `tsx` file in a single fenced code block.",
            diagnostics,
            attempt,
            maxAttempts: MAX_REPAIR_ATTEMPTS,
            adaptiveGuardrails,
          });
        }

        const finalText = bestAttempt
          ? (bestAttempt.diagnostics.length > 0
            ? `${bestAttempt.text}\n\nNote: unresolved validation issues remain:\n${formatDiagnosticsForPrompt(bestAttempt.diagnostics, 5)}`
            : bestAttempt.text)
          : `${lastAttemptText}\n\nNote: validation did not converge. Last known issues:\n${formatDiagnosticsForPrompt(lastAttemptDiagnostics, 5)}`;

        controller.enqueue(encoder.encode(sseEncode({
          type: "text",
          content: finalText,
        })));

        controller.enqueue(encoder.encode(sseEncode({
          type: "done",
          usage: {
            total_cost_usd: totalCostUsd > 0 ? totalCostUsd : undefined,
          },
        })));
      } catch (error) {
        controller.enqueue(encoder.encode(sseEncode({
          type: "error",
          message: error instanceof Error ? error.message : "Unknown agent error",
        })));
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
