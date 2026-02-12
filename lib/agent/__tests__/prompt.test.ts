import { describe, it, expect } from "vitest";
import { SYSTEM_PROMPT } from "../prompt";

function buildFullPrompt(prompt: string, previousCode?: string): string {
  if (previousCode) {
    return `The user previously designed a circuit. Here is the existing tscircuit code:\n\n\`\`\`tsx\n${previousCode}\n\`\`\`\n\nThe user now says: ${prompt}\n\nModify or extend the existing design based on the user's request.`;
  }
  return prompt;
}

describe("SYSTEM_PROMPT", () => {
  it("identifies as CircuitForge", () => {
    expect(SYSTEM_PROMPT).toContain("CircuitForge");
  });

  it("mentions tscircuit as the output format", () => {
    expect(SYSTEM_PROMPT).toContain("tscircuit");
  });

  it("references JLCPCB for real parts", () => {
    expect(SYSTEM_PROMPT).toContain("JLCPCB");
  });

  it("instructs the agent to use search_parts tool", () => {
    expect(SYSTEM_PROMPT).toContain("search_parts");
  });

  it("includes the workflow steps (analyze, select, design, validate, present)", () => {
    expect(SYSTEM_PROMPT).toContain("Analyze Requirements");
    expect(SYSTEM_PROMPT).toContain("Select Components");
    expect(SYSTEM_PROMPT).toContain("Design Circuit");
    expect(SYSTEM_PROMPT).toContain("Validate");
    expect(SYSTEM_PROMPT).toContain("Present");
  });

  it("specifies tsx code output format", () => {
    expect(SYSTEM_PROMPT).toContain("```tsx");
    expect(SYSTEM_PROMPT).toContain("export default");
    expect(SYSTEM_PROMPT).toContain("<board");
  });

  it("mentions LCSC part numbers", () => {
    expect(SYSTEM_PROMPT).toContain("LCSC");
  });

  it("requires decoupling capacitors", () => {
    expect(SYSTEM_PROMPT).toContain("decoupling capacitors");
  });
});

describe("buildFullPrompt", () => {
  it("returns the prompt as-is when no previousCode", () => {
    expect(buildFullPrompt("Design an LED blinker")).toBe("Design an LED blinker");
  });

  it("wraps previousCode in a tsx code block", () => {
    const result = buildFullPrompt("Add a button", '<board width="20mm" />');
    expect(result).toContain("```tsx");
    expect(result).toContain('<board width="20mm" />');
    expect(result).toContain("```");
  });

  it("includes both the existing code context and the new prompt", () => {
    const result = buildFullPrompt("Add a button", "const x = 1;");
    expect(result).toContain("previously designed a circuit");
    expect(result).toContain("Add a button");
    expect(result).toContain("Modify or extend");
  });

  it("preserves the exact previousCode without modification", () => {
    const code = 'export default () => (\n  <board width="50mm" height="40mm">\n    <resistor name="R1" />\n  </board>\n)';
    const result = buildFullPrompt("change it", code);
    expect(result).toContain(code);
  });
});
