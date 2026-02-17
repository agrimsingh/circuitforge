export const MODELS = {
  ORCHESTRATOR: "claude-opus-4-6",
  CODEGEN: "claude-opus-4-6",
  CODEGEN_FAST: "claude-sonnet-4-5",
  CODEGEN_STRONG: "claude-opus-4-6",
  SCOUT: "claude-haiku-4-5",
} as const;

export type ModelRole = keyof typeof MODELS;
