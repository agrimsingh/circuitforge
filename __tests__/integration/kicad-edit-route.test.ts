import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/kicad/edit/route";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/kicad/edit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeRawRequest(raw: string): Request {
  return new Request("http://localhost/api/kicad/edit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw,
  });
}

describe("kicad edit route", () => {
  it("returns 400 for invalid json", async () => {
    const res = await POST(makeRawRequest("{bad"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when kicad_sch is missing", async () => {
    const res = await POST(makeRequest({ edits: [] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("kicad_sch");
  });
});

