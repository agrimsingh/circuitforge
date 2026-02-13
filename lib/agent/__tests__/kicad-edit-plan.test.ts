import { describe, it, expect } from "vitest";
import { parseKicadEditPlan, normalizeReference } from "@/app/api/agent/route";

describe("Kicad edit plan parsing", () => {
  it("parses component value change", () => {
    const result = parseKicadEditPlan("change R1 to 4.7k");

    expect(result).not.toBeNull();
    expect(result?.edits).toHaveLength(1);
    expect(result?.edits[0]).toEqual({
      tool: "manage_component",
      args: {
        action: "modify",
        reference: "R1",
        value: "4.7k",
      },
    });
    expect(result?.reason).toContain("R1 -> 4.7k");
  });

  it("parses reference with suffix letters", () => {
    const result = parseKicadEditPlan("Set U1A to 3.3V");
    expect(result).not.toBeNull();
    expect(result?.edits[0]).toEqual({
      tool: "manage_component",
      args: {
        action: "modify",
        reference: "U1A",
        value: "3.3V",
      },
    });
  });

  it("parses nearby add intent and infers default capacitor", () => {
    const result = parseKicadEditPlan("add a decoupling capacitor near U2");

    expect(result).not.toBeNull();
    expect(result?.edits[0]).toMatchObject({
      tool: "manage_component",
      args: {
        action: "add",
        lib_id: "Device:C",
        value: "100nF",
        footprint: "0805",
      },
    });
    expect(result?.edits[0].args.nearReference).toBe("U2");
  });

  it("parses remove intent", () => {
    const result = parseKicadEditPlan("remove D2");
    expect(result).not.toBeNull();
    expect(result?.edits[0]).toEqual({
      tool: "manage_component",
      args: {
        action: "remove",
        reference: "D2",
      },
    });
  });

  it("parses explicit wire by references", () => {
    const result = parseKicadEditPlan("connect C1 to U2");
    expect(result).not.toBeNull();
    expect(result?.edits[0]).toEqual({
      tool: "manage_wire",
      args: {
        action: "add",
        fromReference: "C1",
        toReference: "U2",
      },
    });
    expect(result?.summary).toContain("wire between C1 and U2");
  });

  it("parses explicit coordinate wire", () => {
    const result = parseKicadEditPlan("add wire from 10,20 to 30,40");
    expect(result).not.toBeNull();
    expect(result?.edits[0]).toMatchObject({
      tool: "manage_wire",
      args: {
        action: "add",
        start: { x: 10, y: 20 },
        end: { x: 30, y: 40 },
      },
    });
  });

  it("ignores non-edit prompts", () => {
    const result = parseKicadEditPlan("can you make it run quieter?");
    expect(result).toBeNull();
  });

  it("normalizes references consistently", () => {
    expect(normalizeReference("  u12b ")).toBe("U12B");
    expect(normalizeReference("bad-ref")).toBeNull();
  });
});
