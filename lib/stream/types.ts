export type SSEEvent =
  | { type: "text"; content: string }
  | { type: "thinking"; content: string }
  | { type: "code"; file: string; content: string }
  | { type: "tool_start"; tool: string; input: unknown }
  | { type: "tool_result"; tool: string; output: unknown }
  | { type: "subagent_start"; agent: string }
  | { type: "subagent_stop"; agent: string }
  | { type: "error"; message: string }
  | { type: "done"; usage?: { total_cost_usd?: number } };

export interface AgentRequest {
  prompt: string;
  previousCode?: string;
}
