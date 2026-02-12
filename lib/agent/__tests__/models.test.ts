import { describe, it, expect } from "vitest";
import { MODELS } from "../models";

describe("model aliases", () => {
  it("defines all required roles", () => {
    expect(MODELS.ORCHESTRATOR).toBeDefined();
    expect(MODELS.CODEGEN).toBeDefined();
    expect(MODELS.SCOUT).toBeDefined();
  });

  it("uses valid Claude model strings", () => {
    const validPrefix = "claude-";
    expect(MODELS.ORCHESTRATOR).toMatch(new RegExp(`^${validPrefix}`));
    expect(MODELS.CODEGEN).toMatch(new RegExp(`^${validPrefix}`));
    expect(MODELS.SCOUT).toMatch(new RegExp(`^${validPrefix}`));
  });

  it("assigns correct tiers", () => {
    expect(MODELS.ORCHESTRATOR).toContain("opus");
    expect(MODELS.CODEGEN).toContain("sonnet");
    expect(MODELS.SCOUT).toContain("haiku");
  });
});
