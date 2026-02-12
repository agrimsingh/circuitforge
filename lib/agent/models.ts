export const MODELS = {
  ORCHESTRATOR: "claude-opus-4-6",
  CODEGEN: "claude-sonnet-4-5",
  SCOUT: "claude-haiku-4-5",
} as const;

export type ModelRole = keyof typeof MODELS;
