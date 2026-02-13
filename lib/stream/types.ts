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
  notes?: string;
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

export interface ValidationDiagnostic {
  category: string;
  message: string;
  signature: string;
  severity: number;
  source?: "tscircuit" | "kicad";
}

export type SSEEvent =
  | { type: "text"; content: string }
  | { type: "thinking"; content: string }
  | { type: "code"; file: string; content: string }
  | { type: "tool_start"; tool: string; input: unknown }
  | { type: "tool_result"; tool: string; output: unknown }
  | { type: "subagent_start"; agent: string }
  | { type: "subagent_stop"; agent: string }
  | { type: "retry_start"; attempt: number; maxAttempts: number }
  | { type: "validation_errors"; attempt: number; diagnostics: ValidationDiagnostic[] }
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
  | { type: "review_decision"; decision: ReviewDecision };

export interface AgentRequest {
  prompt: string;
  previousCode?: string;
  projectId?: string;
  sessionId?: string;
  phase?: DesignPhase;
  uiMode?: UiMode;
  reviewDecisions?: ReviewDecision[];
}
