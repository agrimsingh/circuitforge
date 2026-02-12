/** Model aliases for CircuitForge agent roles */
export const MODELS = {
  /** Main orchestrator + validator — deep reasoning */
  ORCHESTRATOR: "claude-opus-4-6",
  /** Code generation subagent — fast, high-quality code */
  CODEGEN: "claude-sonnet-4-5",
  /** Parts search + BOM optimizer — fast lookups */
  SCOUT: "claude-haiku-4-5",
} as const;

export type ModelRole = keyof typeof MODELS;
