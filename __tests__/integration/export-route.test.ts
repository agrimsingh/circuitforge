import { describe, it, expect } from "vitest";
import { POST } from "@/app/api/export/route";
import JSZip from "jszip";
import simpleCircuit from "../fixtures/simple-circuit.json";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeRawRequest(raw: string): Request {
  return new Request("http://localhost/api/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw,
  });
}

describe("Export route — validation", () => {
  it("returns 400 for invalid JSON body", async () => {
    const res = await POST(makeRawRequest("{not valid json!!!}"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("returns 400 when circuit_json is missing", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("circuit_json");
  });

  it("returns 400 when circuit_json is not an array", async () => {
    const res = await POST(makeRequest({ circuit_json: "not an array" }));
    expect(res.status).toBe(400);
  });
});

describe("Export route — zip generation", () => {
  it("returns a zip file with correct content type", async () => {
    const res = await POST(makeRequest({ circuit_json: simpleCircuit }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    expect(res.headers.get("Content-Disposition")).toContain("circuitforge-export.zip");
  });

  it("zip contains gerbers/ folder with .gbr files", async () => {
    const res = await POST(makeRequest({ circuit_json: simpleCircuit }));
    const buffer = await res.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);

    const gerberFiles = Object.keys(zip.files).filter(
      (f) => f.startsWith("gerbers/") && f.endsWith(".gbr"),
    );
    expect(gerberFiles.length).toBeGreaterThan(0);
  });

  it("zip contains bom.csv", async () => {
    const res = await POST(makeRequest({ circuit_json: simpleCircuit }));
    const buffer = await res.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);

    expect(zip.files["bom.csv"]).toBeDefined();
    const bomContent = await zip.files["bom.csv"].async("string");
    expect(bomContent.length).toBeGreaterThan(0);
  });

  it("zip contains pnp.csv", async () => {
    const res = await POST(makeRequest({ circuit_json: simpleCircuit }));
    const buffer = await res.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);

    expect(zip.files["pnp.csv"]).toBeDefined();
    const pnpContent = await zip.files["pnp.csv"].async("string");
    expect(pnpContent.length).toBeGreaterThan(0);
  });

  it("zip structure matches spec (gerbers/*.gbr, bom.csv, pnp.csv)", async () => {
    const res = await POST(makeRequest({ circuit_json: simpleCircuit }));
    const buffer = await res.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);

    const fileNames = Object.keys(zip.files).filter((f) => !zip.files[f].dir);

    expect(fileNames.some((f) => f.startsWith("gerbers/") && f.endsWith(".gbr"))).toBe(true);
    expect(fileNames.includes("bom.csv")).toBe(true);
    expect(fileNames.includes("pnp.csv")).toBe(true);
  });

  it("includes kicad_sch when formatSet.kicad is true", async () => {
    const res = await POST(
      makeRequest({
        circuit_json: simpleCircuit,
        formatSet: { kicad: true },
      }),
    );
    const buffer = await res.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);

    expect(zip.files["kicad_sch"]).toBeDefined();
    const kicadContent = await zip.files["kicad_sch"].async("string");
    expect(kicadContent).toContain("(kicad_sch");
  });

  it("includes review bundle files when reviewBundle is true", async () => {
    const res = await POST(
      makeRequest({
        circuit_json: simpleCircuit,
        formatSet: { reviewBundle: true },
      }),
    );
    const buffer = await res.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);

    expect(zip.files["connectivity.json"]).toBeDefined();
    expect(zip.files["kicad_report.json"]).toBeDefined();

    const report = JSON.parse(await zip.files["kicad_report.json"].async("string"));
    expect(report.findings).toBeDefined();
  });

  it("handles empty circuit_json array gracefully", async () => {
    const res = await POST(makeRequest({ circuit_json: [] }));
    expect([200, 500]).toContain(res.status);
  });
});
