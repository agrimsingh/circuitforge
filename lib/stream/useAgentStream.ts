"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type {
  SSEEvent,
  DesignPhase,
  RequirementItem,
  ArchitectureNode,
  ReviewFinding,
  ReviewDecision,
  AgentRequest,
} from "./types";
import { extractCodeFromText, stripCodeBlocks } from "@/lib/agent/code";

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ToolEvent {
  id: string;
  tool: string;
  status: "running" | "done";
  input?: unknown;
  output?: unknown;
  startedAt: number;
  finishedAt?: number;
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
  requirements: RequirementItem[];
  architecture: ArchitectureNode[];
  reviewFindings: ReviewFinding[];
  reviewDecisions: ReviewDecision[];
}

export interface SendPromptOptions {
  projectId?: string;
  sessionId?: string;
  phase?: DesignPhase;
  uiMode?: AgentRequest["uiMode"];
  reviewDecisions?: ReviewDecision[];
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
    map.set(item.id, item);
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
  requirements: [],
  architecture: [],
  reviewFindings: [],
  reviewDecisions: [],
};

export function useAgentStream() {
  const [state, setState] = useState<AgentStreamState>(initialState);
  const abortRef = useRef<AbortController | null>(null);
  const accumulatedTextRef = useRef("");
  const activityLogRef = useRef("");
  const toolCounterRef = useRef(0);
  const lastStateRef = useRef(initialState);

  useEffect(() => {
    lastStateRef.current = state;
  }, [state]);

  const appendActivity = (line: string) => {
    activityLogRef.current += `${line}\n`;
    setState((prev) => ({ ...prev, thinkingText: activityLogRef.current }));
  };

  const ensureRetryTelemetry = (current: RetryTelemetry | null) => current ?? createRetryTelemetry();

  const sendPrompt = useCallback(async (prompt: string, previousCode?: string, options?: SendPromptOptions) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const currentReviewDecisions =
      options?.reviewDecisions ??
      lastStateRef.current.reviewDecisions;

    accumulatedTextRef.current = "";
    activityLogRef.current = "";
    toolCounterRef.current = 0;

    setState((prev) => ({
      ...prev,
      messages: [...prev.messages, { role: "user", content: prompt }],
      thinkingText: "",
      toolEvents: [],
      isStreaming: true,
      error: null,
      costUsd: null,
      retryTelemetry: createRetryTelemetry(),
      phase: options?.phase ?? prev.phase,
      reviewDecisions: [],
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

          switch (event.type) {
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
              const id = `tool-${toolCounterRef.current++}`;
              setState((prev) => ({
                ...prev,
                toolEvents: [
                  ...prev.toolEvents,
                  {
                    id,
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
              setState((prev) => ({
                ...prev,
                phase: event.phase,
                phaseProgress: 0,
                phaseMessage: event.reason ?? "phase entered",
              }));
              break;
            }

            case "phase_progress": {
              if (event.phase) {
                setState((prev) => ({
                  ...prev,
                  phase: event.phase,
                  phaseProgress: event.progress,
                  phaseMessage: event.message,
                }));
              }
              break;
            }

            case "phase_block_done": {
              appendActivity(
                `${event.phase} block ${event.blockId} ${event.status}: ${event.message ?? ""}`
                  .trim()
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
              break;
            }

            case "gate_blocked": {
              appendActivity(`🛑 ${event.gate} blocked: ${event.reason}`);
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

            case "session_started": {
              setState((prev) => ({
                ...prev,
                projectId: event.projectId ?? prev.projectId,
                sessionId: event.sessionId,
              }));
              break;
            }

            case "error": {
              setState((prev) => ({
                ...prev,
                error: event.message,
                isStreaming: false,
              }));
              break;
            }

            case "done": {
              setState((prev) => ({
                ...prev,
                isStreaming: false,
                costUsd: event.usage?.total_cost_usd ?? null,
              }));
              break;
            }

            case "retry_start": {
              appendActivity(`↻ Retry attempt ${event.attempt}/${event.maxAttempts}`);
              setState((prev) => ({
                ...prev,
                retryTelemetry: {
                  ...ensureRetryTelemetry(prev.retryTelemetry),
                  maxAttempts: event.maxAttempts,
                  attemptsSeen: Math.max(prev.retryTelemetry?.attemptsSeen ?? 0, event.attempt),
                },
              }));
              break;
            }

            case "validation_errors": {
              appendActivity(`⚠ Validation: ${event.diagnostics.length} issue(s)`);
              setState((prev) => {
                const current = ensureRetryTelemetry(prev.retryTelemetry);

                const diagnosticsByCategory = { ...current.diagnosticsByCategory };
                for (const diagnostic of event.diagnostics) {
                  diagnosticsByCategory[diagnostic.category] =
                    (diagnosticsByCategory[diagnostic.category] ?? 0) + 1;
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
                };
              });
              break;
            }

            case "retry_result": {
              appendActivity(
                `↻ Attempt ${event.attempt}: ${event.status} (${event.diagnosticsCount} issue(s))`
              );
              setState((prev) => ({
                ...prev,
                retryTelemetry: {
                  ...ensureRetryTelemetry(prev.retryTelemetry),
                  finalStatus: event.status,
                  finalAttempt: event.attempt,
                  finalReason: event.reason ?? null,
                },
              }));
              break;
            }
          }
        }
      }

      setState((prev) => (prev.isStreaming ? { ...prev, isStreaming: false } : prev));
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
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

