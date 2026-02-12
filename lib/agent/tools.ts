import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

interface JLCComponent {
  lcsc: number;
  mfr: string;
  package: string;
  description: string;
  stock: number;
  price: string;
}

const searchParts = tool(
  "search_parts",
  "Search for electronic components available on JLCPCB. Returns real, in-stock parts with LCSC codes, pricing, and stock levels.",
  {
    q: z.string().describe("Search query (e.g., 'ESP32-C3', '100nF capacitor', '3.3V LDO regulator')"),
    limit: z.number().optional().default(10).describe("Maximum number of results"),
    package: z.string().optional().describe("Package filter (e.g., 'SOIC-8', '0402')"),
  },
  async (args) => {
    const params = new URLSearchParams();
    params.set("q", args.q);
    params.set("limit", String(args.limit ?? 10));
    params.set("full", "true");
    if (args.package) params.set("package", args.package);

    const response = await fetch(
      `https://jlcsearch.tscircuit.com/api/search?${params}`
    );

    if (!response.ok) {
      return {
        content: [{ type: "text" as const, text: `jlcsearch API error: ${response.status} ${response.statusText}` }],
      };
    }

    const data = await response.json();
    const components: JLCComponent[] = data.components ?? [];

    if (components.length === 0) {
      return {
        content: [{ type: "text" as const, text: `No components found for "${args.q}". Try a broader search.` }],
      };
    }

    const formatted = components
      .map((c) => `LCSC: C${c.lcsc} | ${c.mfr} | ${c.package} | ${c.description} | Stock: ${c.stock} | $${c.price}`)
      .join("\n");

    return {
      content: [{ type: "text" as const, text: `Found ${components.length} components:\n\n${formatted}` }],
    };
  }
);

export const circuitforgeTools = createSdkMcpServer({
  name: "circuitforge-tools",
  version: "1.0.0",
  tools: [searchParts],
});
