import { describe, it, expect } from "vitest";

const BASE_URL = "https://jlcsearch.tscircuit.com/api/search";

interface JLCComponent {
  lcsc: number;
  mfr: string;
  package: string;
  description: string;
  stock: number;
  price: string;
}

async function searchParts(
  q: string,
  opts: { limit?: number; package?: string } = {},
): Promise<JLCComponent[]> {
  const params = new URLSearchParams();
  params.set("q", q);
  params.set("limit", String(opts.limit ?? 10));
  params.set("full", "true");
  if (opts.package) params.set("package", opts.package);

  const response = await fetch(`${BASE_URL}?${params}`);
  if (!response.ok) {
    throw new Error(`jlcsearch API error: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  return data.components ?? [];
}

describe("jlcsearch API integration", () => {
  it("returns components for a valid query", async () => {
    const components = await searchParts("ESP32", { limit: 5 });
    expect(components.length).toBeGreaterThan(0);
    expect(components.length).toBeLessThanOrEqual(5);
  });

  it("response shape matches JLCComponent interface", async () => {
    const components = await searchParts("AMS1117-3.3", { limit: 3 });
    expect(components.length).toBeGreaterThan(0);

    for (const c of components) {
      expect(typeof c.lcsc).toBe("number");
      expect(typeof c.mfr).toBe("string");
      expect(typeof c.package).toBe("string");
      expect(typeof c.description).toBe("string");
      expect(typeof c.stock).toBe("number");
      expect(typeof c.price).toBe("string");
    }
  });

  it("respects the limit parameter", async () => {
    const components = await searchParts("capacitor", { limit: 2 });
    expect(components.length).toBeLessThanOrEqual(2);
  });

  it("package filter narrows results", async () => {
    const components = await searchParts("capacitor 100nF", {
      limit: 5,
      package: "0402",
    });

    for (const c of components) {
      expect(c.package.toLowerCase()).toContain("0402");
    }
  });

  it("returns empty array for nonsense query", async () => {
    const components = await searchParts("xyzzyplugh99nonexistent");
    expect(components).toEqual([]);
  });

  it("search_parts tool output format matches spec", async () => {
    const components = await searchParts("ESP32-C3", { limit: 3 });

    if (components.length > 0) {
      const formatted = components
        .map(
          (c) =>
            `LCSC: C${c.lcsc} | ${c.mfr} | ${c.package} | ${c.description} | Stock: ${c.stock} | $${c.price}`,
        )
        .join("\n");

      expect(formatted).toContain("LCSC: C");
      expect(formatted).toContain("Stock:");
      expect(formatted).toContain("$");

      for (const c of components) {
        expect(c.lcsc).toBeGreaterThan(0);
      }
    }
  });
});
