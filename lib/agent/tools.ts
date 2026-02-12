import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

/**
 * Custom MCP tool for searching JLCPCB components via jlcsearch.tscircuit.com
 */
const searchParts = tool(
  "search_parts",
  "Search for electronic components available on JLCPCB. Returns real, in-stock parts with LCSC codes, pricing, and stock levels. Use this to find components for circuit designs.",
  {
    q: z.string().describe("Search query (e.g., 'ESP32-C3', '100nF capacitor', '3.3V LDO regulator')"),
    limit: z
      .number()
      .optional()
      .default(10)
      .describe("Maximum number of results to return"),
    package: z
      .string()
      .optional()
      .describe("Optional package/footprint filter (e.g., 'SOIC-8', '0402', 'QFN-32')"),
  },
  async (args) => {
    const params = new URLSearchParams();
    params.set("q", args.q);
    params.set("limit", String(args.limit ?? 10));
    params.set("full", "true");
    if (args.package) {
      params.set("package", args.package);
    }

    try {
      const response = await fetch(
        `https://jlcsearch.tscircuit.com/api/search?${params.toString()}`
      );

      if (!response.ok) {
        return {
          content: [
            {
              type: "text" as const,
              text: `jlcsearch API error: ${response.status} ${response.statusText}`,
            },
          ],
        };
      }

      const data = await response.json();
      const components = data.components ?? [];

      if (components.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No components found for query "${args.q}"${args.package ? ` with package ${args.package}` : ""}. Try a broader search term.`,
            },
          ],
        };
      }

      const formatted = components
        .map(
          (c: {
            lcsc: number;
            mfr: string;
            package: string;
            description: string;
            stock: number;
            price: string;
          }) =>
            `LCSC: C${c.lcsc} | ${c.mfr} | ${c.package} | ${c.description} | Stock: ${c.stock} | Price: $${c.price}`
        )
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Found ${components.length} components:\n\n${formatted}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to search parts: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

/**
 * In-process MCP server with CircuitForge tools.
 * Used by the Agent SDK — avoids stdio subprocess overhead on Vercel.
 */
export const circuitforgeTools = createSdkMcpServer({
  name: "circuitforge-tools",
  version: "1.0.0",
  tools: [searchParts],
});
