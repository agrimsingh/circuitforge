"use client";

import { useMemo } from "react";
import {
  ChainOfThought,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
} from "@/components/ai-elements/chain-of-thought";
import {
  Confirmation,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRequest,
} from "@/components/ai-elements/confirmation";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import { ArchitecturePanel } from "./ArchitecturePanel";
import type { ToolEvent, RetryTelemetry } from "@/lib/stream/useAgentStream";
import type {
  DesignPhase,
  RequirementItem,
  ArchitectureNode,
  ReviewFinding,
  PhaseStepState,
  GateEvent,
} from "@/lib/stream/types";

interface InfoPanelProps {
  activityText: string;
  toolEvents: ToolEvent[];
  isStreaming: boolean;
  retryTelemetry: RetryTelemetry | null;
  phase: DesignPhase;
  phaseProgress: number;
  phaseMessage: string | null;
  requirements: RequirementItem[];
  architecture: ArchitectureNode[];
  reviewFindings: ReviewFinding[];
  phaseSteps?: PhaseStepState[];
  gateEvents?: GateEvent[];
  onReviewDecision: (
    findingId: string,
    decision: "accept" | "dismiss",
    reason?: string
  ) => void;
  onSend?: (prompt: string) => void;
}

const phases: DesignPhase[] = [
  "requirements",
  "architecture",
  "implementation",
  "review",
  "export",
];

function toolStateFromEvent(status: ToolEvent["status"]) {
  return status === "running" ? "input-streaming" : "output-available";
}

function phaseClass(phase: DesignPhase) {
  const normalized = phase.toUpperCase();
  return normalized.slice(0, 1) + normalized.slice(1);
}

function normalizeStatus(
  status: "pending" | "active" | "complete" | "blocked"
): "pending" | "active" | "complete" {
  return status === "pending" ? "pending" : status === "blocked" ? "active" : status;
}

function deriveSteps(currentPhase: DesignPhase): PhaseStepState[] {
  const currentIndex = phases.indexOf(currentPhase);
  return phases.map((phase, index) => ({
    phase,
    status:
      index < currentIndex
        ? ("complete" as const)
        : index === currentIndex
          ? ("active" as const)
          : ("pending" as const),
  }));
}

export function InfoPanel({
  activityText,
  toolEvents,
  isStreaming,
  retryTelemetry,
  phase,
  phaseProgress,
  phaseMessage,
  requirements,
  architecture,
  reviewFindings,
  phaseSteps,
  gateEvents,
  onReviewDecision,
  onSend,
}: InfoPanelProps) {
  const openFindings = useMemo(
    () => reviewFindings.filter((finding) => finding.status === "open"),
    [reviewFindings]
  );

  const steps =
    phaseSteps && phaseSteps.length > 0
      ? phaseSteps
      : deriveSteps(phase);

  const latestBlockedGate = gateEvents
    ?.filter((event) => event.status === "blocked")
    .slice()
    .reverse()[0];

  return (
    <div className="flex flex-col h-full bg-[#080c14]">
      <div className="flex items-center justify-between border-b border-[#1a2236] px-4 py-2">
        <span className="text-xs font-mono text-[#4a6080] uppercase tracking-wide">Workflow</span>
        <span className="text-xs font-mono text-[#4a6080]">
          {phaseMessage || `Current phase: ${phaseClass(phase)} (${phaseProgress}%)`}
        </span>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-3 scrollbar-thin">
        <section className="space-y-2">
          <ChainOfThought defaultOpen>
            <ChainOfThoughtHeader>Design phases</ChainOfThoughtHeader>
            {steps.map((step) => (
              <ChainOfThoughtStep
                key={step.phase}
                status={normalizeStatus(step.status)}
                label={<span className="font-medium uppercase tracking-wide text-xs">{step.phase}</span>}
                description={
                  step.status === "blocked"
                    ? `Blocked by ${step.gate ?? "gate decision"}`
                    : step.reason ?? `${phaseProgress}%`
                }
              />
            ))}
          </ChainOfThought>
        </section>

        {latestBlockedGate && (
          <section className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <Confirmation
              state="approval-requested"
              approval={{ id: latestBlockedGate.gate }}
            >
              <ConfirmationRequest>
                <p className="text-sm font-medium text-amber-300">
                  Decision needed: {latestBlockedGate.gate}
                </p>
                <p className="mt-1 text-xs text-amber-200/90">
                  {latestBlockedGate.reason ||
                    latestBlockedGate.message ||
                    "Proceeding blocked by gating condition."}
                </p>
              </ConfirmationRequest>

              {onSend && (
                <ConfirmationActions className="mt-2">
                  <ConfirmationAction
                    variant="outline"
                    onClick={() =>
                      onSend(
                        `Acknowledge gate ${latestBlockedGate.gate} and continue with the current design plan.`
                      )
                    }
                  >
                    Acknowledge
                  </ConfirmationAction>
                  <ConfirmationAction
                    variant="outline"
                    onClick={() =>
                      onSend(`Retry the current run because ${latestBlockedGate.gate} was blocked.`)
                    }
                  >
                    Retry
                  </ConfirmationAction>
                  <ConfirmationAction
                    variant="outline"
                    onClick={() =>
                      onSend(`Proceed despite the gate block for ${latestBlockedGate.gate}.`)
                    }
                  >
                    Proceed
                  </ConfirmationAction>
                </ConfirmationActions>
              )}
            </Confirmation>
          </section>
        )}

        <section className="space-y-2">
          <h4 className="text-xs font-mono uppercase tracking-wide text-[#4a6080]">Reasoning / Activity</h4>
          <Reasoning isStreaming={isStreaming} defaultOpen className="not-prose">
            <ReasoningTrigger>Streaming activity log</ReasoningTrigger>
            <ReasoningContent>
              {activityText || "No activity emitted yet."}
            </ReasoningContent>
          </Reasoning>

          {retryTelemetry && retryTelemetry.attemptsSeen > 0 && (
            <div className="rounded-md border border-[#1a2236] p-2">
              <h5 className="text-xs uppercase tracking-wide text-[#4a6080]">Retry telemetry</h5>
              <p className="mt-1 text-xs text-[#88a3c5]">
                Attempts: {retryTelemetry.attemptsSeen}/{retryTelemetry.maxAttempts || "?"}
              </p>
              <p className="text-xs text-[#88a3c5]">Final status: {retryTelemetry.finalStatus ?? "running"}</p>
              <p className="text-xs text-[#88a3c5]">Total diagnostics: {retryTelemetry.diagnosticsTotal}</p>
              <p className="text-xs text-[#88a3c5]">
                First error: {retryTelemetry.firstErrorCategory ?? "none"}
              </p>
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h4 className="text-xs font-mono uppercase tracking-wide text-[#4a6080]">Tools</h4>
          {toolEvents.length === 0 ? (
            <p className="text-xs text-[#2a3a54]">No tool activity yet</p>
          ) : (
            <div className="space-y-2">
              {toolEvents.map((event) => (
                <Tool key={event.id}>
                  <ToolHeader
                    title={event.tool}
                    type="dynamic-tool"
                    toolName={event.tool}
                    state={toolStateFromEvent(event.status)}
                  />
                  <ToolContent>
                    <ToolInput input={event.input ?? { note: "No input" }} />
                    <ToolOutput
                      output={event.output ?? (event.status === "running" ? "Running..." : "No output")}
                      errorText={undefined}
                    />
                  </ToolContent>
                </Tool>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h4 className="text-xs font-mono uppercase tracking-wide text-[#4a6080]">Requirements</h4>
          {requirements.length === 0 ? (
            <p className="text-xs text-[#2a3a54]">No requirements yet</p>
          ) : (
            <ul className="space-y-2">
              {requirements.map((requirement) => (
                <li
                  key={requirement.id}
                  className="rounded-md border border-[#1a2236] p-2 text-xs text-[#88a3c5]"
                >
                  <p className="font-medium">{requirement.title}</p>
                  <p className="text-[11px] text-[#4a6080]">{requirement.category}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <h4 className="text-xs font-mono uppercase tracking-wide text-[#4a6080]">Architecture</h4>
          <ArchitecturePanel blocks={architecture} />
        </section>

        <section className="space-y-2">
          <h4 className="text-xs font-mono uppercase tracking-wide text-[#4a6080]">
            Review findings
          </h4>
          {openFindings.length === 0 ? (
            <p className="text-xs text-[#2a3a54]">No open findings</p>
          ) : (
            openFindings.map((finding) => (
              <div
                key={finding.id}
                className="rounded-md border border-[#1a2236] p-2"
              >
                <div className="text-xs text-[#88a3c5]">{finding.category} · {finding.phase}</div>
                <p className="mt-1 text-xs text-[#5a7090]">{finding.message}</p>
                {finding.suggestion && (
                  <p className="mt-1 text-xs text-[#5f7ea0]">Suggestion: {finding.suggestion}</p>
                )}
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => onReviewDecision(finding.id, "accept")}
                    className="rounded border border-[#2a3a54] px-2 py-1 text-[10px] text-[#4fc77a]"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => onReviewDecision(finding.id, "dismiss")}
                    className="rounded border border-[#2a3a54] px-2 py-1 text-[10px] text-[#d4a85f]"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
