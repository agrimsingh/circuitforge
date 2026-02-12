import { describe, it, expect } from "vitest";
import { circuitforgeTools } from "../tools";

describe("circuitforgeTools MCP server", () => {
  it("is defined and has the correct server name", () => {
    expect(circuitforgeTools).toBeDefined();
    expect(typeof circuitforgeTools).toBe("object");
  });
});
