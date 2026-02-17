export type DesignPhase =
  | "requirements"
  | "architecture"
  | "implementation"
  | "review"
  | "export";

export type UiMode = "auto" | "beginner" | "expert";

export type PhaseStepStatus = "pending" | "active" | "complete" | "blocked";

export interface PhaseStepState {
  phase: DesignPhase;
  status: PhaseStepStatus;
  reason?: string;
  gate?: string;
}

export interface GateEvent {
  phase: DesignPhase;
  gate: string;
  status: "blocked" | "passed";
  reason?: string;
  message?: string;
  at: number;
}

export interface RequirementItem {
  id: string;
  title: string;
  category: string;
  status: "pending" | "collected" | "accepted" | "rejected";
  value?: string;
  rationale?: string;
  createdAt: number;
}

export interface ArchitectureNode {
  id: string;
  label: string;
  kind: "block" | "component" | "interface" | "power" | "net";
  status: "proposed" | "approved" | "in_progress" | "done" | "blocked";
  role?: string;
  criticality?: "high" | "medium" | "low";
  notes?: string;
  inputs?: string[];
  outputs?: string[];
  interfaces?: string[];
  keyComponents?: string[];
  constraints?: string[];
  failureModes?: string[];
  children?: string[];
  portMappings?: Array<{ from: string; to: string }>;
}

export interface BlockStatus {
  blockId: string;
  phase: DesignPhase;
  status: "queued" | "running" | "done" | "blocked";
  details?: string;
}

export interface ReviewFinding {
  id: string;
  phase: DesignPhase;
  category: string;
  severity: "critical" | "warning" | "info";
  title: string;
  message: string;
  isBlocking?: boolean;
  status: "open" | "accepted" | "dismissed";
  suggestion?: string;
  source?: "agent" | "tscircuit" | "kicad";
  createdAt: number;
}

export interface ReviewDecision {
  findingId: string;
  decision: "accept" | "dismiss";
  reason?: string;
}

export interface IterationDiff {
  addedComponents: string[];
  removedComponents: string[];
  changedComponentValues: Array<{ name: string; from: string; to: string }>;
  traceCountDelta: number;
  summary: string;
}

export interface FinalSummary {
  designIntent: string;
  constraintsSatisfied: string[];
  unresolvedBlockers: string[];
  manufacturingReadinessScore: number;
  diagnosticsCount: number;
  blockingDiagnosticsCount: number;
  warningDiagnosticsCount: number;
  actionableWarningCount?: number;
  lowSignalWarningCount?: number;
  openCriticalFindings: number;
  attemptsUsed: number;
  phase: DesignPhase;
}

export interface TimingMetric {
  stage: string;
  durationMs: number;
  attempt?: number;
}

export interface ValidationDiagnostic {
  category: string;
  message: string;
  signature: string;
  severity: number;
  source?: "agent" | "tscircuit" | "kicad";
  family?: string;
  handling?: "auto_fixable" | "should_demote" | "must_repair";
}

export interface RepairPlanEvent {
  attempt: number;
  autoFixableFamilies: string[];
  shouldDemoteFamilies: string[];
  mustRepairFamilies: string[];
  strategy?: "normal" | "structural_trace_rebuild" | "structural_layout_spread" | "targeted_congestion_relief";
}

export interface RepairResultEvent {
  attempt: number;
  blockingBefore: number;
  blockingAfter: number;
  demotedCount: number;
  autoFixedCount: number;
  revalidated: boolean;
  appliedActions: string[];
}

export type SSEEvent =
  | { type: "text"; content: string }
  | { type: "thinking"; content: string }
  | { type: "code"; file: string; content: string }
  | { type: "tool_start"; callId?: string; tool: string; input: unknown }
  | { type: "tool_result"; callId?: string; tool: string; output: unknown }
  | { type: "subagent_start"; agent: string }
  | { type: "subagent_stop"; agent: string }
  | { type: "retry_start"; attempt: number; maxAttempts: number }
  | { type: "validation_errors"; attempt: number; diagnostics: ValidationDiagnostic[] }
  | { type: "repair_plan"; plan: RepairPlanEvent }
  | { type: "repair_result"; result: RepairResultEvent }
  | {
      type: "retry_result";
      attempt: number;
      status: "clean" | "retrying" | "failed";
      diagnosticsCount: number;
      score: number;
      reason?: string;
    }
  | { type: "error"; message: string }
  | { type: "done"; usage?: { total_cost_usd?: number } }
  | { type: "session_started"; sessionId: string; projectId?: string }
  | { type: "phase_entered"; phase: DesignPhase; reason?: string }
  | {
      type: "phase_progress";
      phase: DesignPhase;
      progress: number;
      message: string;
      blockId?: string;
    }
  | {
      type: "phase_block_done";
      phase: DesignPhase;
      blockId: string;
      status: "done" | "blocked";
      message?: string;
    }
  | {
      type: "gate_passed";
      phase: DesignPhase;
      gate: string;
      message: string;
    }
  | {
      type: "gate_blocked";
      phase: DesignPhase;
      gate: string;
      reason: string;
    }
  | { type: "requirements_item"; item: RequirementItem }
  | { type: "architecture_block"; block: ArchitectureNode }
  | { type: "review_finding"; finding: ReviewFinding }
  | { type: "review_decision"; decision: ReviewDecision }
  | { type: "iteration_diff"; attempt: number; diff: IterationDiff }
  | { type: "final_summary"; summary: FinalSummary }
  | { type: "timing_metric"; stage: string; durationMs: number; attempt?: number }
  | { type: "ping" };

export interface AgentRequest {
  prompt: string;
  previousCode?: string;
  projectId?: string;
  sessionId?: string;
  phase?: DesignPhase;
  uiMode?: UiMode;
  reviewDecisions?: ReviewDecision[];
}
