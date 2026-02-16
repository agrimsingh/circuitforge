"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from "motion/react";
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
import { Button } from "@/components/ui/button";
import type { ToolEvent, RetryTelemetry } from "@/lib/stream/useAgentStream";
import dynamic from "next/dynamic";

const ArchitecturePanel = dynamic(
  () => import("./ArchitecturePanel").then((m) => ({ default: m.ArchitecturePanel })),
  { ssr: false }
);
import type {
  DesignPhase,
  RequirementItem,
  ArchitectureNode,
  ReviewFinding,
  PhaseStepState,
  GateEvent,
  FinalSummary,
  IterationDiff,
  TimingMetric,
  RepairPlanEvent,
  RepairResultEvent,
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
  iterationDiffs: Array<{ attempt: number; diff: IterationDiff; at: number }>;
  finalSummary: FinalSummary | null;
  timingMetrics: Array<TimingMetric & { at: number }>;
  repairPlans: Array<RepairPlanEvent & { at: number }>;
  repairResults: Array<RepairResultEvent & { at: number }>;
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

function AnimatedScore({ value }: { value: number }) {
  const motionValue = useMotionValue(0);
  const spring = useSpring(motionValue, { damping: 30, stiffness: 100 });
  const display = useTransform(spring, (v: number) => Math.round(v));
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    motionValue.set(value);
  }, [value, motionValue]);

  useEffect(() => {
    const unsubscribe = display.on("change", (v: number) => setDisplayValue(v));
    return unsubscribe;
  }, [display]);

  return <>{displayValue}</>;
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
  iterationDiffs,
  finalSummary,
  timingMetrics,
  repairPlans,
  repairResults,
  phaseSteps,
  gateEvents,
  onReviewDecision,
  onSend,
}: InfoPanelProps) {
  const [findingFilter, setFindingFilter] = useState<"all" | "critical" | "warning" | "info">(
    "all",
  );
  const openFindings = useMemo(
    () => reviewFindings.filter((finding) => finding.status === "open"),
    [reviewFindings]
  );
  const filteredFindings = useMemo(
    () =>
      openFindings.filter((finding) =>
        findingFilter === "all" ? true : finding.severity === findingFilter,
      ),
    [findingFilter, openFindings],
  );
  const openCriticalCount = useMemo(
    () => openFindings.filter((finding) => finding.severity === "critical").length,
    [openFindings],
  );
  const latestDiff = iterationDiffs.length > 0 ? iterationDiffs[iterationDiffs.length - 1] : null;
  const latestTimings = timingMetrics.slice(-8).reverse();
  const latestRepairPlan = repairPlans.length > 0 ? repairPlans[repairPlans.length - 1] : null;
  const latestRepairResult = repairResults.length > 0 ? repairResults[repairResults.length - 1] : null;
  const recentRepairResults = repairResults.slice(-6).reverse();

  const steps =
    phaseSteps && phaseSteps.length > 0
      ? phaseSteps
      : deriveSteps(phase);

  const [gateFlash, setGateFlash] = useState(false);
  const prevGateCountRef = useRef(0);

  useEffect(() => {
    const passedCount = gateEvents?.filter(e => e.status === "passed").length ?? 0;
    if (passedCount > prevGateCountRef.current) {
      setGateFlash(true);
      const timer = setTimeout(() => setGateFlash(false), 600);
      prevGateCountRef.current = passedCount;
      return () => clearTimeout(timer);
    }
    prevGateCountRef.current = passedCount;
  }, [gateEvents]);

  const latestBlockedGate = gateEvents
    ?.filter((event) => event.status === "blocked")
    .slice()
    .reverse()[0];
  const applyBulkDecision = (decision: "accept" | "dismiss") => {
    for (const finding of filteredFindings) {
      onReviewDecision(finding.id, decision);
    }
  };
  const triggerCriticalFix = () => {
    if (!onSend || openCriticalCount === 0) return;
    onSend(
      `Fix all ${openCriticalCount} open critical review findings with minimal design changes, rerun validation, and summarize what changed.`,
    );
  };

  return (
    <div className="flex flex-col h-full bg-surface">
      <div className="flex flex-col border-b border-border/40">
        <div className="flex items-center justify-between px-4 py-2">
          <span className="text-xs font-medium text-muted-foreground">Workflow</span>
          <span className="text-xs text-muted-foreground">
            {phaseMessage || `Current phase: ${phaseClass(phase)} (${phaseProgress}%)`}
          </span>
        </div>
        {isStreaming && (
          <div className="h-0.5 w-full bg-border/30">
            <motion.div
              className="h-full bg-accent/70 origin-left"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: phaseProgress / 100 }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
            />
          </div>
        )}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3 scrollbar-thin">
        <section className="relative space-y-2">
          <AnimatePresence>
            {gateFlash && (
              <motion.div
                key="gate-flash"
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 0.6, 0.6, 0] }}
                transition={{ duration: 0.6, times: [0, 0.15, 0.5, 1] }}
                className="absolute inset-0 rounded-lg bg-success/10 pointer-events-none z-10"
              />
            )}
          </AnimatePresence>
          <ChainOfThought defaultOpen>
            <ChainOfThoughtHeader>Design phases</ChainOfThoughtHeader>
            {steps.map((step) => (
              <ChainOfThoughtStep
                key={step.phase}
                status={normalizeStatus(step.status)}
                label={<span className="font-medium text-xs">{step.phase}</span>}
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
                <p className="text-pretty mt-1 text-xs text-amber-200/90">
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
          <h4 className="text-xs font-medium text-muted-foreground flex items-center gap-2">
            <span className="inline-block w-0.5 h-3 rounded-full bg-accent/30" />
            Reasoning / Activity
          </h4>
          <Reasoning isStreaming={isStreaming} defaultOpen className="not-prose">
            <ReasoningTrigger>Streaming activity log</ReasoningTrigger>
            <ReasoningContent>
              {activityText || "No activity emitted yet."}
            </ReasoningContent>
          </Reasoning>

          {retryTelemetry && retryTelemetry.attemptsSeen > 0 && (
            <div className="rounded-md border border-accent/10 bg-accent/2 p-2">
              <h5 className="text-xs font-medium text-muted-foreground">Retry telemetry</h5>
              <p className="mt-1 text-xs text-info">
                Attempts: {retryTelemetry.attemptsSeen}/{retryTelemetry.maxAttempts || "?"}
              </p>
              <p className="text-xs text-info">Final status: {retryTelemetry.finalStatus ?? "running"}</p>
              <p className="text-xs text-info">Total diagnostics: {retryTelemetry.diagnosticsTotal}</p>
              <p className="text-xs text-info">
                First error: {retryTelemetry.firstErrorCategory ?? "none"}
              </p>
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground flex items-center gap-2">
            <span className="inline-block w-0.5 h-3 rounded-full bg-accent/30" />
            Output evidence
          </h4>
          {finalSummary ? (
            <div className="rounded-md border border-border p-2 text-xs">
              <p className="text-info">
                Readiness: <span className="font-semibold"><AnimatedScore value={finalSummary.manufacturingReadinessScore} />/100</span>
              </p>
              <p className="text-muted-foreground mt-1">
                Diagnostics: {finalSummary.diagnosticsCount} · blocking: {finalSummary.blockingDiagnosticsCount} · warnings: {finalSummary.warningDiagnosticsCount}
              </p>
              <p className="text-muted-foreground">
                Open critical findings: {finalSummary.openCriticalFindings}
              </p>
              <p className="text-muted-foreground">
                Attempts used: {finalSummary.attemptsUsed} · Phase: {finalSummary.phase}
              </p>
              {finalSummary.unresolvedBlockers.length > 0 && (
                <ul className="mt-2 space-y-1 text-warning">
                  {finalSummary.unresolvedBlockers.slice(0, 3).map((item) => (
                    <li key={item}>• {item}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No final evidence summary yet.</p>
          )}

          {latestDiff && (
            <div className="rounded-md border border-border p-2 text-xs text-info">
              <p className="font-medium">
                Attempt {latestDiff.attempt}: {latestDiff.diff.summary}
              </p>
              <p className="mt-1 text-muted-foreground">
                +{latestDiff.diff.addedComponents.length} / -{latestDiff.diff.removedComponents.length} components ·
                trace delta {latestDiff.diff.traceCountDelta >= 0 ? `+${latestDiff.diff.traceCountDelta}` : latestDiff.diff.traceCountDelta}
              </p>
            </div>
          )}

          {latestTimings.length > 0 && (
            <div className="rounded-md border border-accent/10 bg-accent/2 p-2">
              <p className="text-xs font-medium text-muted-foreground">Latest timings</p>
              <ul className="mt-1 space-y-1 text-xs text-info">
                {latestTimings.map((metric, index) => (
                  <li key={`${metric.stage}-${metric.at}-${index}`}>
                    {metric.stage}
                    {metric.attempt ? ` (A${metric.attempt})` : ""}: {metric.durationMs}ms
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(latestRepairPlan || latestRepairResult) && (
            <div className="rounded-md border border-accent/10 bg-accent/2 p-2">
              <p className="text-xs font-medium text-muted-foreground">Deterministic repair evidence</p>
              {latestRepairPlan && (
                <p className="mt-1 text-xs text-info">
                  A{latestRepairPlan.attempt}: auto {latestRepairPlan.autoFixableFamilies.length} · demote{" "}
                  {latestRepairPlan.shouldDemoteFamilies.length} · must{" "}
                  {latestRepairPlan.mustRepairFamilies.length}
                </p>
              )}
              {latestRepairResult && (
                <p className="text-xs text-muted-foreground">
                  Last result A{latestRepairResult.attempt}: blocking {latestRepairResult.blockingBefore} →{" "}
                  {latestRepairResult.blockingAfter}, auto-fixed {latestRepairResult.autoFixedCount}, demoted{" "}
                  {latestRepairResult.demotedCount}
                  {latestRepairResult.revalidated ? " (revalidated)" : ""}
                </p>
              )}
              {recentRepairResults.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {recentRepairResults.map((result, index) => (
                    <li key={`${result.attempt}-${result.at}-${index}`}>
                      A{result.attempt}: {result.blockingBefore} → {result.blockingAfter}
                      {result.appliedActions.length > 0
                        ? ` (${result.appliedActions.slice(0, 2).join(", ")})`
                        : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground flex items-center gap-2">
            <span className="inline-block w-0.5 h-3 rounded-full bg-accent/30" />
            Tools
          </h4>
          {toolEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tool activity yet. Tools will appear here as the agent works.</p>
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
                      output={event.output ?? (event.status === "running" ? "Running…" : "No output")}
                      errorText={undefined}
                    />
                  </ToolContent>
                </Tool>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground flex items-center gap-2">
            <span className="inline-block w-0.5 h-3 rounded-full bg-accent/30" />
            Requirements
          </h4>
          {requirements.length === 0 ? (
            <p className="text-sm text-muted-foreground">No requirements extracted yet. Start a conversation to generate requirements.</p>
          ) : (
            <motion.ul
              className="space-y-2"
              initial="hidden"
              animate="show"
              variants={{
                hidden: { opacity: 0 },
                show: { opacity: 1, transition: { staggerChildren: 0.05, delayChildren: 0.1 } },
              }}
            >
              {requirements.map((requirement) => (
                <motion.li
                  key={requirement.id}
                  variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
                  transition={{ duration: 0.15, ease: "easeOut" }}
                  className="rounded-md border border-border p-2 text-xs text-info"
                >
                  <p className="font-medium">{requirement.title}</p>
                  <p className="text-[11px] text-muted-foreground">{requirement.category}</p>
                </motion.li>
              ))}
            </motion.ul>
          )}
        </section>

        <section className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground flex items-center gap-2">
            <span className="inline-block w-0.5 h-3 rounded-full bg-accent/30" />
            Architecture
          </h4>
          <ArchitecturePanel blocks={architecture} />
        </section>

        <section className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground flex items-center gap-2">
            <span className="inline-block w-0.5 h-3 rounded-full bg-accent/30" />
            Review findings
          </h4>
          {openFindings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open findings. Review findings will appear after the review phase.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {(["all", "critical", "warning", "info"] as const).map((option) => (
                  <Button
                    key={option}
                    variant="outline"
                    size="sm"
                    onClick={() => setFindingFilter(option)}
                    className={`h-7 px-2 text-[10px] ${
                      findingFilter === option ? "text-foreground border-accent" : "text-muted-foreground"
                    }`}
                  >
                    {option}
                  </Button>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => applyBulkDecision("accept")}
                  className="h-7 px-2 text-[10px] text-success"
                >
                  Accept visible
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => applyBulkDecision("dismiss")}
                  className="h-7 px-2 text-[10px] text-warning"
                >
                  Dismiss visible
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={triggerCriticalFix}
                  disabled={!onSend || openCriticalCount === 0}
                  className="h-7 px-2 text-[10px] text-info"
                >
                  Fix critical + rerun
                </Button>
              </div>

              {filteredFindings.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No findings match the current filter.
                </p>
              )}

              {filteredFindings.map((finding) => (
              <div
                key={finding.id}
                className="rounded-md border border-border p-2"
              >
                <div className="text-xs text-info">{finding.category} · {finding.phase}</div>
                <p className="text-pretty mt-1 text-xs text-muted-foreground">{finding.message}</p>
                {finding.suggestion && (
                  <p className="text-pretty mt-1 text-xs text-info">Suggestion: {finding.suggestion}</p>
                )}
                <div className="mt-2 flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onReviewDecision(finding.id, "accept")}
                    className="h-8 px-2.5 text-[11px] text-success"
                  >
                    Accept
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onReviewDecision(finding.id, "dismiss")}
                    className="h-8 px-2.5 text-[11px] text-warning"
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
              ))}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
