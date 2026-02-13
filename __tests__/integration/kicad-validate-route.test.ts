import { describe, it, expect } from "vitest";
import { POST } from "@/app/api/kicad/validate/route";
import simpleCircuit from "../fixtures/simple-circuit.json";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/kicad/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeRawRequest(raw: string): Request {
  return new Request("http://localhost/api/kicad/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw,
  });
}

describe("kicad validate route", () => {
  it("returns 400 for invalid json", async () => {
    const res = await POST(makeRawRequest("{not valid}"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid JSON");
  });

  it("returns 400 when request body is missing both circuit_json and tscircuit_code", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Missing");
  });

  it("returns kicad schema and findings for valid circuit_json", async () => {
    const res = await POST(makeRequest({ circuit_json: simpleCircuit }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.kicadSchema).toBe("string");
    expect(body.kicadSchema).toContain("(kicad_sch");
    expect(Array.isArray(body.findings)).toBe(true);
    expect(body.metadata).toBeTruthy();
  });
});

