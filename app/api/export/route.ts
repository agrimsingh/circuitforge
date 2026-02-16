import {
  convertSoupToGerberCommands,
  stringifyGerberCommandLayers,
  convertSoupToExcellonDrillCommands,
  stringifyExcellonDrill,
} from "circuit-json-to-gerber";
import { convertCircuitJsonToBomRows, convertBomRowsToCsv } from "circuit-json-to-bom-csv";
import { convertCircuitJsonToPickAndPlaceCsv } from "circuit-json-to-pnp-csv";
import { assessKicadFindings } from "@/lib/kicad/review";
import type { ValidationDiagnostic } from "@/lib/stream/types";
import JSZip from "jszip";

export const runtime = "nodejs";

interface ExportFormatSet {
  kicad?: boolean;
  reviewBundle?: boolean;
}

interface ExportRequestBody {
  circuit_json: unknown[];
  formatSet?: ExportFormatSet;
  readiness?: {
    criticalFindingsCount?: number;
    allowRiskyExport?: boolean;
    readinessScore?: number | null;
  };
}

export async function POST(req: Request) {
  let body: ExportRequestBody;
  try {
    body = (await req.json()) as ExportRequestBody;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!Array.isArray(body.circuit_json)) {
    return new Response(
      JSON.stringify({
        error: "Missing 'circuit_json' array in body",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const soup = body.circuit_json;
  const formatSet = body.formatSet ?? {};
  const criticalFindingsCount = Number.isFinite(body.readiness?.criticalFindingsCount)
    ? Math.max(0, Number(body.readiness?.criticalFindingsCount))
    : 0;
  const allowRiskyExport = body.readiness?.allowRiskyExport === true;

  if (criticalFindingsCount > 0 && !allowRiskyExport) {
    return new Response(
      JSON.stringify({
        error: "Export blocked by unresolved critical findings",
        details:
          "Resolve critical review findings first, or explicitly request a risky export override.",
        criticalFindingsCount,
      }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    const zip = new JSZip();
    const gerbers = zip.folder("gerbers")!;

    const gerberCommands = convertSoupToGerberCommands(soup as never);
    const layers = stringifyGerberCommandLayers(gerberCommands as never);
    for (const [name, content] of Object.entries(layers)) {
      gerbers.file(`${name}.gbr`, content as string);
    }

    try {
      const drill = convertSoupToExcellonDrillCommands({
        circuitJson: soup as never,
        is_plated: true,
      });
      gerbers.file("plated.drl", stringifyExcellonDrill(drill as never));
    } catch {
      // no plated holes
    }

    try {
      const drill = convertSoupToExcellonDrillCommands({
        circuitJson: soup as never,
        is_plated: false,
      });
      gerbers.file("unplated.drl", stringifyExcellonDrill(drill as never));
    } catch {
      // no unplated holes
    }

    try {
      const bomRows = await convertCircuitJsonToBomRows({ circuitJson: soup as never });
      zip.file("bom.csv", convertBomRowsToCsv(bomRows));
    } catch {
      zip.file("bom.csv", "# BOM generation failed\n");
    }

    try {
      zip.file("pnp.csv", convertCircuitJsonToPickAndPlaceCsv(soup as never));
    } catch {
      zip.file("pnp.csv", "# PNP generation failed\n");
    }

    if (formatSet.kicad || formatSet.reviewBundle) {
      const kicadResult = await assessKicadFindings(soup);
      const schemaText =
        typeof kicadResult.kicadSchema === "string" && kicadResult.kicadSchema.trim()
          ? kicadResult.kicadSchema
          : "(kicad_sch\n  (version 20211014)\n  (generator CircuitForge)\n  (comment \"kicad conversion unavailable\")\n)";

      zip.file("kicad_sch", schemaText);

      if (formatSet.reviewBundle) {
        const findings = kicadResult.findings
          .map((entry) => entry as ValidationDiagnostic)
          .slice(0, 500);
        zip.file(
          "connectivity.json",
          JSON.stringify(kicadResult.connectivity ?? {}, null, 2)
        );
        zip.file(
          "kicad_report.json",
          JSON.stringify(
            {
              ok: kicadResult.ok,
              findings,
              traceability: kicadResult.traceability,
              connectivity: kicadResult.connectivity,
              metadata: {
                ...kicadResult.metadata,
                findingsCount: findings.length,
              },
            },
            null,
            2
          )
        );
      }
    }

    const buffer = await zip.generateAsync({ type: "arraybuffer" });

    return new Response(buffer, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="circuitforge-export.zip"',
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "Export failed",
        details: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

