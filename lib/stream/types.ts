export interface ValidationDiagnostic {
  category: string;
  message: string;
  signature: string;
  severity: number;
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
  | { type: "done"; usage?: { total_cost_usd?: number } };

export interface AgentRequest {
  prompt: string;
  previousCode?: string;
}
