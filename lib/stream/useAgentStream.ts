"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { unstable_batchedUpdates } from "react-dom";
import type {
  SSEEvent,
  DesignPhase,
  RequirementItem,
  ArchitectureNode,
  ReviewFinding,
  ReviewDecision,
  AgentRequest,
  PhaseStepState,
  PhaseStepStatus,
  GateEvent,
  IterationDiff,
  FinalSummary,
  TimingMetric,
  RepairPlanEvent,
  RepairResultEvent,
} from "./types";
import { extractCodeFromText, stripCodeBlocks } from "@/lib/agent/code";

export interface AgentMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ToolEvent {
  id: string;
  callId?: string;
  tool: string;
  status: "running" | "done";
  input?: unknown;
  output?: unknown;
  startedAt: number;
  finishedAt?: number;
}

export interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
}

export interface SystemEvent {
  id: string;
  type: "retry_start" | "validation_summary" | "retry_result" | "gate_passed" | "gate_blocked" | "repair_result";
  at: number;
  attempt?: number;
  maxAttempts?: number;
  status?: "clean" | "retrying" | "failed";
  diagnosticsCount?: number;
  diagnosticsByCategory?: Record<string, number>;
  message?: string;
  gate?: string;
  phase?: string;
  blockingBefore?: number;
  blockingAfter?: number;
  autoFixedCount?: number;
  demotedCount?: number;
}

export interface RetryTelemetry {
  maxAttempts: number;
  attemptsSeen: number;
  diagnosticsTotal: number;
  diagnosticsByCategory: Record<string, number>;
  firstErrorCategory: string | null;
  finalStatus: "clean" | "retrying" | "failed" | null;
  finalAttempt: number;
  finalReason: string | null;
}

export interface AgentStreamState {
  messages: AgentMessage[];
  thinkingText: string;
  toolEvents: ToolEvent[];
  circuitCode: string;
  isStreaming: boolean;
  error: string | null;
  costUsd: number | null;
  retryTelemetry: RetryTelemetry | null;
  projectId: string | null;
  sessionId: string | null;
  phase: DesignPhase;
  phaseProgress: number;
  phaseMessage: string | null;
  phaseSteps: PhaseStepState[];
  gateEvents: GateEvent[];
  requirements: RequirementItem[];
  architecture: ArchitectureNode[];
  reviewFindings: ReviewFinding[];
  reviewDecisions: ReviewDecision[];
  iterationDiffs: Array<{ attempt: number; diff: IterationDiff; at: number }>;
  finalSummary: FinalSummary | null;
  timingMetrics: Array<TimingMetric & { at: number }>;
  repairPlans: Array<RepairPlanEvent & { at: number }>;
  repairResults: Array<RepairResultEvent & { at: number }>;
  systemEvents: SystemEvent[];
  todos: TodoItem[];
}

export interface SendPromptOptions {
  projectId?: string;
  sessionId?: string;
  phase?: DesignPhase;
  uiMode?: AgentRequest["uiMode"];
  reviewDecisions?: ReviewDecision[];
}

const DESIGN_PHASE_ORDER: DesignPhase[] = [
  "requirements",
  "architecture",
  "implementation",
  "review",
  "export",
];

function createInitialPhaseSteps(activePhase?: DesignPhase): PhaseStepState[] {
  return DESIGN_PHASE_ORDER.map((phase) => ({
    phase,
    status: phase === (activePhase ?? "implementation") ? "active" : "pending",
  }));
}

function createRetryTelemetry(): RetryTelemetry {
  return {
    maxAttempts: 0,
    attemptsSeen: 0,
    diagnosticsTotal: 0,
    diagnosticsByCategory: {},
    firstErrorCategory: null,
    finalStatus: null,
    finalAttempt: 0,
    finalReason: null,
  };
}

function mergeById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of existing) {
    map.set(item.id, item);
  }
  for (const item of incoming) {
    map.set(item.id, item);
  }
  return Array.from(map.values());
}

function upsertRequirement(items: RequirementItem[], incoming: RequirementItem[]): RequirementItem[] {
  return mergeById(items, incoming);
}

function upsertArchitecture(
  architecture: ArchitectureNode[],
  blocks: ArchitectureNode[]
): ArchitectureNode[] {
  return mergeById(architecture, blocks);
}

function upsertFindings(
  current: ReviewFinding[],
  incoming: ReviewFinding[]
): ReviewFinding[] {
  const map = new Map<string, ReviewFinding>();

  for (const item of current) {
    map.set(item.id, item);
  }

  for (const item of incoming) {
    const prior = map.get(item.id);
    if (!prior || prior.status === "open") {
      map.set(item.id, item);
      continue;
    }
    map.set(item.id, { ...item, status: prior.status });
  }

  return Array.from(map.values());
}

function setFindingDecision(findings: ReviewFinding[], decision: ReviewDecision): ReviewFinding[] {
  return findings.map((finding) =>
    finding.id === decision.findingId
      ? {
          ...finding,
          status: decision.decision === "accept" ? "accepted" : "dismissed",
        }
      : finding
  );
}

function applyPhaseUpdate(
  steps: PhaseStepState[],
  phase: DesignPhase,
  status: PhaseStepStatus,
  reason?: string,
  gate?: string
): PhaseStepState[] {
  const next = [...steps];
  const phaseIndex = DESIGN_PHASE_ORDER.indexOf(phase);

  if (phaseIndex < 0) {
    return next;
  }

  return next.map((step, index) => {
    if (index < phaseIndex) {
      return { ...step, status: "complete" };
    }

    if (index === phaseIndex) {
      return {
        ...step,
        status,
        reason: reason ?? step.reason,
        gate: gate ?? step.gate,
      };
    }

    return {
      ...step,
      status: "pending",
      reason: undefined,
      gate: undefined,
    };
  });
}

const initialState: AgentStreamState = {
  messages: [],
  thinkingText: "",
  toolEvents: [],
  circuitCode: "",
  isStreaming: false,
  error: null,
  costUsd: null,
  retryTelemetry: null,
  projectId: null,
  sessionId: null,
  phase: "implementation",
  phaseProgress: 0,
  phaseMessage: null,
  phaseSteps: createInitialPhaseSteps("implementation"),
  gateEvents: [],
  requirements: [],
  architecture: [],
  reviewFindings: [],
  reviewDecisions: [],
  iterationDiffs: [],
  finalSummary: null,
  timingMetrics: [],
  repairPlans: [],
  repairResults: [],
  systemEvents: [],
  todos: [],
};

function buildRunRecapMessage(state: AgentStreamState): string | null {
  const summary = state.finalSummary;
  if (!summary) return null;
  const actionableAdvisories =
    summary.actionableWarningCount ?? summary.warningDiagnosticsCount;
  const lowSignalAdvisories = summary.lowSignalWarningCount ?? 0;

  const autoFixedTotal = state.repairResults.reduce(
    (sum, item) => sum + (item.autoFixedCount ?? 0),
    0,
  );
  const lastRepair = state.repairResults[state.repairResults.length - 1];
  const flowLine =
    summary.blockingDiagnosticsCount === 0
      ? "Validation is complete and blocking issues are cleared."
      : `Validation stopped with ${summary.blockingDiagnosticsCount} blocking issue(s) remaining.`;
  const repairLine = lastRepair
    ? `Latest repair pass: blocking ${lastRepair.blockingBefore} -> ${lastRepair.blockingAfter}.`
    : "No deterministic repair evidence was captured in this run.";
  const nextSteps =
    summary.blockingDiagnosticsCount === 0
      ? [
          "You can export now, or ask for refinements.",
          "Suggested prompt: `Improve placement/readability and keep behavior unchanged.`",
          "Suggested prompt: `Generate manufacturing notes and BOM sanity checks before export.`",
        ]
      : [
          "Automatic repair budget was exhausted for this run.",
          "Remaining blockers are listed above for traceability.",
          "Backend repair will continue autonomously within the configured attempt budget on each run.",
        ];

  return [
    "## Run Recap",
    "",
    "### Current State",
    `- **Phase:** ${summary.phase}`,
    `- **Readiness:** ${summary.manufacturingReadinessScore}/100`,
    `- **Diagnostics:** ${summary.diagnosticsCount} total (${summary.blockingDiagnosticsCount} blocking, ${actionableAdvisories} actionable advisory${lowSignalAdvisories > 0 ? `, ${lowSignalAdvisories} low-signal advisory` : ""})`,
    `- **Auto-fixed issues this run:** ${autoFixedTotal}`,
    `- ${flowLine}`,
    `- ${repairLine}`,
    "",
    "### Next Actions",
    ...nextSteps.map((line) => `- ${line}`),
  ].join("\n");
}

export function useAgentStream() {
  const [state, setState] = useState<AgentStreamState>(initialState);
  const abortRef = useRef<AbortController | null>(null);
  const accumulatedTextRef = useRef("");
  const activityLogRef = useRef("");
  const toolCounterRef = useRef(0);
  const messageCounterRef = useRef(0);
  const receivedDoneRef = useRef(false);
  const systemEventCounterRef = useRef(0);
  const statusMessageIdRef = useRef<string | null>(null);
  const statusLogRef = useRef<string[]>([]);
  const lastLiveStatusAtRef = useRef(0);
  const lastStateRef = useRef(initialState);

  useEffect(() => {
    lastStateRef.current = state;
  }, [state]);

  const appendActivity = (line: string) => {
    activityLogRef.current += `${line}\n`;
    setState((prev) => ({ ...prev, thinkingText: activityLogRef.current }));
  };

  const ensureRetryTelemetry = (current: RetryTelemetry | null) => current ?? createRetryTelemetry();

  const nextMessageId = () => `msg-${messageCounterRef.current++}`;

  const pushStatusLine = (line: string, opts?: { force?: boolean }) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const now = Date.now();
    if (!opts?.force && now - lastLiveStatusAtRef.current < 1500) return;
    lastLiveStatusAtRef.current = now;
    const last = statusLogRef.current[statusLogRef.current.length - 1];
    if (last === trimmed) return;
    statusLogRef.current = [...statusLogRef.current.slice(-7), trimmed];

    const statusMessageId = statusMessageIdRef.current;
    if (!statusMessageId) return;
    const content = [
      "## Live Status",
      "",
      ...statusLogRef.current.map((entry) => `- ${entry}`),
    ].join("\n");

    setState((prev) => {
      const idx = prev.messages.findIndex((msg) => msg.id === statusMessageId);
      const withoutStatus =
        idx >= 0
          ? [...prev.messages.slice(0, idx), ...prev.messages.slice(idx + 1)]
          : prev.messages;
      if (idx === -1) {
        return {
          ...prev,
          messages: [...withoutStatus, { id: statusMessageId, role: "system", content }],
        };
      }
      return {
        ...prev,
        messages: [...withoutStatus, { id: statusMessageId, role: "system", content }],
      };
    });
  };

  const sendPrompt = useCallback(async (prompt: string, previousCode?: string, options?: SendPromptOptions) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const currentReviewDecisions =
      options?.reviewDecisions ??
      lastStateRef.current.reviewDecisions;
    const nextPhase = options?.phase ?? state.phase;

    accumulatedTextRef.current = "";
    activityLogRef.current = "";
    toolCounterRef.current = 0;
    receivedDoneRef.current = false;
    systemEventCounterRef.current = 0;

    setState((prev) => ({
      ...prev,
      messages: [...prev.messages, { id: nextMessageId(), role: "user", content: prompt }],
      thinkingText: "",
      toolEvents: [],
      isStreaming: true,
      error: null,
      costUsd: null,
      retryTelemetry: createRetryTelemetry(),
      phase: nextPhase,
      phaseProgress: 0,
      phaseMessage: "Phase entered",
      phaseSteps: createInitialPhaseSteps(nextPhase),
      reviewDecisions: [],
      iterationDiffs: [],
      finalSummary: null,
      timingMetrics: [],
      repairPlans: [],
      repairResults: [],
      systemEvents: [],
    }));

    statusLogRef.current = [];
    lastLiveStatusAtRef.current = 0;
    const statusMessageId = nextMessageId();
    statusMessageIdRef.current = statusMessageId;
    setState((prev) => ({
      ...prev,
      messages: [
        ...prev.messages,
        {
          id: statusMessageId,
          role: "system",
          content: "## Live Status\n\n- Starting run and loading previous context.",
        },
      ],
    }));

    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          previousCode,
          projectId: options?.projectId ?? state.projectId ?? null,
          sessionId: options?.sessionId ?? state.sessionId ?? null,
          phase: options?.phase ?? state.phase,
          uiMode: options?.uiMode,
          reviewDecisions: currentReviewDecisions,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errBody: Record<string, unknown> = await response.json().catch(() => ({}));
        throw new Error(
          typeof errBody.error === "string"
            ? errBody.error
            : `Agent request failed: ${response.status}`
        );
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        const parsedEvents: SSEEvent[] = [];

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6);
          if (!jsonStr) continue;

          let event: SSEEvent;
          try {
            event = JSON.parse(jsonStr);
          } catch {
            continue;
          }
          parsedEvents.push(event);
        }

        if (parsedEvents.length === 0) continue;
        unstable_batchedUpdates(() => {
          for (const event of parsedEvents) {
          switch (event.type) {
            case "code": {
              if (typeof event.content === "string" && event.content.trim()) {
                appendActivity(`Updated circuit code (${event.file})`);
                setState((prev) => ({
                  ...prev,
                  circuitCode: event.content,
                }));
              }
              break;
            }

            case "text": {
              accumulatedTextRef.current += event.content;
              const code = extractCodeFromText(accumulatedTextRef.current);
              const chatContent = stripCodeBlocks(accumulatedTextRef.current);

              setState((prev) => {
                const msgs = [...prev.messages];
                const lastMsg = msgs[msgs.length - 1];
                if (lastMsg?.role === "assistant") {
                  msgs[msgs.length - 1] = {
                    ...lastMsg,
                    content: chatContent,
                  };
                } else {
                  msgs.push({
                    id: nextMessageId(),
                    role: "assistant",
                    content: chatContent,
                  });
                }

                return {
                  ...prev,
                  messages: msgs,
                  circuitCode: code ?? prev.circuitCode,
                };
              });
              break;
            }

            case "thinking": {
              appendActivity(event.content);
              break;
            }

            case "tool_start": {
              appendActivity(`→ ${event.tool}${event.input ? ` (${JSON.stringify(event.input).slice(0, 80)})` : ""}`);
              if (event.tool !== "TodoWrite") {
                pushStatusLine(`Running tool: \`${event.tool}\``);
              }

              if (event.tool === "TodoWrite") {
                const inp = event.input as { todos?: TodoItem[]; merge?: boolean } | undefined;
                if (inp?.todos && Array.isArray(inp.todos)) {
                  setState((prev) => {
                    if (inp.merge === false) {
                      return { ...prev, todos: inp.todos as TodoItem[] };
                    }
                    const map = new Map(prev.todos.map((t) => [t.id, t]));
                    for (const todo of inp.todos as TodoItem[]) {
                      const existing = map.get(todo.id);
                      map.set(todo.id, existing ? { ...existing, ...todo } : todo);
                    }
                    return { ...prev, todos: Array.from(map.values()) };
                  });
                }
                break;
              }

              const id = event.callId ?? `tool-${toolCounterRef.current++}`;
              setState((prev) => ({
                ...prev,
                toolEvents: [
                  ...prev.toolEvents,
                  {
                    id,
                    callId: event.callId,
                    tool: event.tool,
                    status: "running",
                    input: event.input,
                    startedAt: Date.now(),
                  },
                ],
              }));
              break;
            }

            case "tool_result": {
              setState((prev) => {
                const events = [...prev.toolEvents];
                const matchedByCallId = event.callId
                  ? events.findIndex(
                      (item) => item.callId === event.callId && item.status === "running",
                    )
                  : -1;
                if (matchedByCallId >= 0) {
                  events[matchedByCallId] = {
                    ...events[matchedByCallId],
                    status: "done",
                    output: event.output,
                    finishedAt: Date.now(),
                  };
                  return { ...prev, toolEvents: events };
                }
                for (let i = events.length - 1; i >= 0; i--) {
                  if (events[i].tool === event.tool && events[i].status === "running") {
                    events[i] = {
                      ...events[i],
                      status: "done",
                      output: event.output,
                      finishedAt: Date.now(),
                    };
                    break;
                  }
                }
                return { ...prev, toolEvents: events };
              });
              break;
            }

            case "subagent_start": {
              appendActivity(`▸ Starting ${event.agent}`);
              pushStatusLine(`Subagent started: \`${event.agent}\``);
              const id = `tool-${toolCounterRef.current++}`;
              setState((prev) => ({
                ...prev,
                toolEvents: [
                  ...prev.toolEvents,
                  {
                    id,
                    tool: `Subagent: ${event.agent}`,
                    status: "running",
                    startedAt: Date.now(),
                  },
                ],
              }));
              break;
            }

            case "subagent_stop": {
              appendActivity(`✓ ${event.agent} done`);
              pushStatusLine(`Subagent finished: \`${event.agent}\``);
              setState((prev) => {
                const events = [...prev.toolEvents];
                for (let i = events.length - 1; i >= 0; i--) {
                  if (events[i].tool.includes(event.agent) && events[i].status === "running") {
                    events[i] = {
                      ...events[i],
                      status: "done",
                      finishedAt: Date.now(),
                    };
                    break;
                  }
                }
                return { ...prev, toolEvents: events };
              });
              break;
            }

            case "phase_entered": {
              appendActivity(`Phase: ${event.phase}`);
              pushStatusLine(`Entered **${event.phase}** phase.`, { force: true });
              setState((prev) => ({
                ...prev,
                phase: event.phase,
                phaseProgress: 0,
                phaseMessage: event.reason ?? "phase entered",
                phaseSteps: applyPhaseUpdate(
                  prev.phaseSteps.length ? prev.phaseSteps : createInitialPhaseSteps(event.phase),
                  event.phase,
                  "active",
                  event.reason,
                  undefined
                ),
              }));
              break;
            }

            case "phase_progress": {
              pushStatusLine(`**${event.phase}**: ${event.message}`);
              setState((prev) => ({
                ...prev,
                phase: event.phase,
                phaseProgress: event.progress,
                phaseMessage: event.message,
                phaseSteps: applyPhaseUpdate(
                  prev.phaseSteps.length ? prev.phaseSteps : createInitialPhaseSteps(event.phase),
                  event.phase,
                  "active",
                  event.message,
                  undefined
                ),
              }));
              break;
            }

            case "phase_block_done": {
              appendActivity(
                `${event.phase} block ${event.blockId} ${event.status}: ${event.message ?? ""}`.trim()
              );
              setState((prev) => ({
                ...prev,
                architecture: prev.architecture.map((block) =>
                  block.id === event.blockId
                    ? { ...block, status: event.status === "done" ? "done" : "blocked" }
                    : block
                ),
              }));
              break;
            }

            case "gate_passed": {
              appendActivity(`✅ ${event.gate}: ${event.message}`);
              pushStatusLine(`**${event.phase}**: gate passed (\`${event.gate}\`). ${event.message}`, { force: true });
              setState((prev) => ({
                ...prev,
                phaseSteps: applyPhaseUpdate(
                  prev.phaseSteps.length ? prev.phaseSteps : createInitialPhaseSteps(event.phase),
                  event.phase,
                  "complete",
                  event.message,
                  event.gate
                ),
                gateEvents: [
                  ...prev.gateEvents,
                  {
                    phase: event.phase,
                    gate: event.gate,
                    status: "passed",
                    reason: event.message,
                    message: event.message,
                    at: Date.now(),
                  },
                ],
                systemEvents: [...prev.systemEvents, { id: `sys-${systemEventCounterRef.current++}`, type: "gate_passed" as const, at: Date.now(), gate: event.gate, phase: event.phase, message: event.message }],
              }));
              break;
            }

            case "gate_blocked": {
              appendActivity(`🛑 ${event.gate} blocked: ${event.reason}`);
              pushStatusLine(`**${event.phase}**: gate blocked (\`${event.gate}\`). Next: apply repairs and retry.`, { force: true });
              setState((prev) => ({
                ...prev,
                phaseSteps: applyPhaseUpdate(
                  prev.phaseSteps.length ? prev.phaseSteps : createInitialPhaseSteps(event.phase),
                  event.phase,
                  "blocked",
                  event.reason,
                  event.gate
                ),
                gateEvents: [
                  ...prev.gateEvents,
                  {
                    phase: event.phase,
                    gate: event.gate,
                    status: "blocked",
                    reason: event.reason,
                    at: Date.now(),
                  },
                ],
                systemEvents: [...prev.systemEvents, { id: `sys-${systemEventCounterRef.current++}`, type: "gate_blocked" as const, at: Date.now(), gate: event.gate, phase: event.phase, message: event.reason }],
              }));
              break;
            }

            case "requirements_item": {
              setState((prev) => ({
                ...prev,
                requirements: upsertRequirement(prev.requirements, [event.item]),
              }));
              break;
            }

            case "architecture_block": {
              setState((prev) => ({
                ...prev,
                architecture: upsertArchitecture(prev.architecture, [event.block]),
              }));
              break;
            }

            case "review_finding": {
              setState((prev) => ({
                ...prev,
                reviewFindings: upsertFindings(prev.reviewFindings, [event.finding]),
              }));
              break;
            }

            case "review_decision": {
              const decision = event.decision;
              pushStatusLine(`Finding \`${decision.findingId}\` marked **${decision.decision}**.`);
              setState((prev) => ({
                ...prev,
                reviewFindings: setFindingDecision(prev.reviewFindings, decision),
                reviewDecisions: [
                  ...prev.reviewDecisions.filter((entry) => entry.findingId !== decision.findingId),
                  decision,
                ],
              }));
              break;
            }

            case "iteration_diff": {
              appendActivity(`Δ Iteration ${event.attempt}: ${event.diff.summary}`);
              setState((prev) => ({
                ...prev,
                iterationDiffs: [
                  ...prev.iterationDiffs,
                  {
                    attempt: event.attempt,
                    diff: event.diff,
                    at: Date.now(),
                  },
                ],
              }));
              break;
            }

            case "final_summary": {
              const actionableAdvisories =
                event.summary.actionableWarningCount ?? event.summary.warningDiagnosticsCount;
              appendActivity(
                `Final readiness: ${event.summary.manufacturingReadinessScore}/100 (open critical: ${event.summary.openCriticalFindings})`
              );
              pushStatusLine(
                `Summary: readiness **${event.summary.manufacturingReadinessScore}/100**, blocking diagnostics **${event.summary.blockingDiagnosticsCount}**, actionable advisories **${actionableAdvisories}**.`,
                { force: true },
              );
              setState((prev) => ({
                ...prev,
                finalSummary: event.summary,
              }));
              break;
            }

            case "timing_metric": {
              setState((prev) => ({
                ...prev,
                timingMetrics: [
                  ...prev.timingMetrics,
                  {
                    stage: event.stage,
                    durationMs: event.durationMs,
                    attempt: event.attempt,
                    at: Date.now(),
                  },
                ].slice(-120),
              }));
              break;
            }

            case "repair_plan": {
              appendActivity(
                `Repair plan A${event.plan.attempt}: auto=${event.plan.autoFixableFamilies.length}, demote=${event.plan.shouldDemoteFamilies.length}, must=${event.plan.mustRepairFamilies.length}`
              );
              setState((prev) => ({
                ...prev,
                repairPlans: [
                  ...prev.repairPlans,
                  {
                    ...event.plan,
                    at: Date.now(),
                  },
                ].slice(-40),
              }));
              break;
            }

            case "repair_result": {
              appendActivity(
                `Repair result A${event.result.attempt}: blocking ${event.result.blockingBefore} -> ${event.result.blockingAfter}`
              );
              pushStatusLine(
                `Attempt ${event.result.attempt}: blocking ${event.result.blockingBefore} -> ${event.result.blockingAfter}, auto-fixed ${event.result.autoFixedCount}.`,
              );
              setState((prev) => ({
                ...prev,
                repairResults: [
                  ...prev.repairResults,
                  {
                    ...event.result,
                    at: Date.now(),
                  },
                ].slice(-40),
                systemEvents: [...prev.systemEvents, { id: `sys-${systemEventCounterRef.current++}`, type: "repair_result" as const, at: Date.now(), attempt: event.result.attempt, blockingBefore: event.result.blockingBefore, blockingAfter: event.result.blockingAfter, autoFixedCount: event.result.autoFixedCount, demotedCount: event.result.demotedCount }],
              }));
              break;
            }

            case "session_started": {
              setState((prev) => ({
                ...prev,
                projectId: event.projectId ?? prev.projectId,
                sessionId: event.sessionId,
              }));
              break;
            }

            case "error": {
              pushStatusLine(`Run failed: ${event.message}`, { force: true });
              setState((prev) => ({
                ...prev,
                error: event.message,
                isStreaming: false,
              }));
              break;
            }

            case "done": {
              receivedDoneRef.current = true;
              pushStatusLine("Run complete.", { force: true });
              setState((prev) => {
                const recap = buildRunRecapMessage(prev);
                return {
                  ...prev,
                  messages: recap
                    ? [...prev.messages, { id: nextMessageId(), role: "assistant", content: recap }]
                    : prev.messages,
                  isStreaming: false,
                  costUsd: event.usage?.total_cost_usd ?? null,
                };
              });
              break;
            }

            case "retry_start": {
              appendActivity(`↻ Retry attempt ${event.attempt}/${event.maxAttempts}`);
              pushStatusLine(
                `Validation attempt ${event.attempt}/${event.maxAttempts} started. Next: inspect diagnostics and apply fixes.`,
                { force: true },
              );
              setState((prev) => ({
                ...prev,
                retryTelemetry: {
                  ...ensureRetryTelemetry(prev.retryTelemetry),
                  maxAttempts: event.maxAttempts,
                  attemptsSeen: Math.max(prev.retryTelemetry?.attemptsSeen ?? 0, event.attempt),
                },
                systemEvents: [...prev.systemEvents, { id: `sys-${systemEventCounterRef.current++}`, type: "retry_start" as const, at: Date.now(), attempt: event.attempt, maxAttempts: event.maxAttempts }],
              }));
              break;
            }

            case "validation_errors": {
              appendActivity(`⚠ Validation: ${event.diagnostics.length} issue(s)`);
              pushStatusLine(
                `Attempt ${event.attempt}: found ${event.diagnostics.length} issue(s). Next: patch and rerun validation.`,
                { force: true },
              );
              setState((prev) => {
                const current = ensureRetryTelemetry(prev.retryTelemetry);

                const batchCounts: Record<string, number> = {};
                for (const diagnostic of event.diagnostics) {
                  batchCounts[diagnostic.category] =
                    (batchCounts[diagnostic.category] ?? 0) + 1;
                }

                const diagnosticsByCategory = { ...current.diagnosticsByCategory };
                for (const [cat, count] of Object.entries(batchCounts)) {
                  diagnosticsByCategory[cat] =
                    (diagnosticsByCategory[cat] ?? 0) + count;
                }

                return {
                  ...prev,
                  retryTelemetry: {
                    ...current,
                    diagnosticsTotal: current.diagnosticsTotal + event.diagnostics.length,
                    diagnosticsByCategory,
                    firstErrorCategory:
                      current.firstErrorCategory ??
                      event.diagnostics[0]?.category ??
                      null,
                  },
                  systemEvents: [...prev.systemEvents, { id: `sys-${systemEventCounterRef.current++}`, type: "validation_summary" as const, at: Date.now(), diagnosticsCount: event.diagnostics.length, diagnosticsByCategory: batchCounts }],
                };
              });
              break;
            }

            case "retry_result": {
              appendActivity(
                `↻ Attempt ${event.attempt}: ${event.status} (${event.diagnosticsCount} issue(s))`
              );
              pushStatusLine(
                event.status === "clean"
                  ? `Attempt ${event.attempt}: validation clean.`
                  : event.status === "failed"
                    ? `Attempt ${event.attempt}: retry loop stopped with ${event.diagnosticsCount} issue(s) remaining.`
                    : `Attempt ${event.attempt}: continuing repair loop (${event.diagnosticsCount} issue(s) left).`,
                { force: true },
              );
              setState((prev) => ({
                ...prev,
                retryTelemetry: {
                  ...ensureRetryTelemetry(prev.retryTelemetry),
                  finalStatus: event.status,
                  finalAttempt: event.attempt,
                  finalReason: event.reason ?? null,
                },
                systemEvents: [...prev.systemEvents, { id: `sys-${systemEventCounterRef.current++}`, type: "retry_result" as const, at: Date.now(), attempt: event.attempt, status: event.status, diagnosticsCount: event.diagnosticsCount, message: event.reason }],
              }));
              break;
            }
          }
          }
        });
      }

      if (!receivedDoneRef.current) {
        pushStatusLine("Connection ended before completion. Last response may be partial.", { force: true });
        setState((prev) => ({
          ...prev,
          isStreaming: false,
          error: "Connection lost — response may be incomplete.",
        }));
      } else {
        setState((prev) => (prev.isStreaming ? { ...prev, isStreaming: false } : prev));
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      pushStatusLine(`Run failed: ${err instanceof Error ? err.message : "Unknown error"}`, { force: true });
      setState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : "Unknown error",
        isStreaming: false,
      }));
    }
  }, [state.phase, state.projectId, state.sessionId]);

  const setReviewDecision = useCallback((findingId: string, decision: "accept" | "dismiss", reason?: string) => {
    setState((prev) => {
      const updated = setFindingDecision(prev.reviewFindings, {
        findingId,
        decision,
        reason,
      });
      const nextDecision: ReviewDecision = { findingId, decision, reason };
      return {
        ...prev,
        reviewFindings: updated,
        reviewDecisions: [...prev.reviewDecisions.filter((entry) => entry.findingId !== findingId), nextDecision],
      };
    });
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setState((prev) => ({ ...prev, isStreaming: false }));
  }, []);

  return { ...state, sendPrompt, setReviewDecision, stop };
}
