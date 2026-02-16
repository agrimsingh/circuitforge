import {
  convertSoupToGerberCommands,
  stringifyGerberCommandLayers,
  convertSoupToExcellonDrillCommands,
  stringifyExcellonDrill,
} from "circuit-json-to-gerber";
import { convertCircuitJsonToBomRows, convertBomRowsToCsv } from "circuit-json-to-bom-csv";
import { convertCircuitJsonToPickAndPlaceCsv } from "circuit-json-to-pnp-csv";
import { assessKicadFindings } from "@/lib/kicad/review";
import { compileForValidation } from "@/lib/agent/repairLoop";
import type { ValidationDiagnostic } from "@/lib/stream/types";
import JSZip from "jszip";

export const runtime = "nodejs";

interface ExportFormatSet {
  kicad?: boolean;
  reviewBundle?: boolean;
}

interface ExportRequestBody {
  circuit_json?: unknown[];
  tscircuit_code?: string;
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

  const hasCircuitJson = Array.isArray(body.circuit_json);
  const hasTscircuitCode =
    typeof body.tscircuit_code === "string" && body.tscircuit_code.trim().length > 0;
  if (!hasCircuitJson && !hasTscircuitCode) {
    return new Response(
      JSON.stringify({
        error: "Missing 'circuit_json' array or 'tscircuit_code' string in body",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  let soup: unknown[] = [];
  if (hasCircuitJson) {
    soup = body.circuit_json as unknown[];
  } else {
    const compile = await compileForValidation(body.tscircuit_code!.trim(), req.signal);
    if (!compile.ok || !compile.circuitJson) {
      return new Response(
        JSON.stringify({
          error: "Export compile failed",
          details: compile.errorMessage ?? "compile failed",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    soup = compile.circuitJson;
  }
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

    const layersPromise = Promise.resolve().then(() => {
      const gerberCommands = convertSoupToGerberCommands(soup as never);
      return stringifyGerberCommandLayers(gerberCommands as never);
    });
    const platedDrillPromise = Promise.resolve().then(() => {
      try {
        const drill = convertSoupToExcellonDrillCommands({
          circuitJson: soup as never,
          is_plated: true,
        });
        return stringifyExcellonDrill(drill as never);
      } catch {
        return null;
      }
    });
    const unplatedDrillPromise = Promise.resolve().then(() => {
      try {
        const drill = convertSoupToExcellonDrillCommands({
          circuitJson: soup as never,
          is_plated: false,
        });
        return stringifyExcellonDrill(drill as never);
      } catch {
        return null;
      }
    });
    const bomPromise = convertCircuitJsonToBomRows({ circuitJson: soup as never })
      .then((rows) => convertBomRowsToCsv(rows))
      .catch(() => "# BOM generation failed\n");
    const pnpPromise = Promise.resolve().then(() => {
      try {
        return convertCircuitJsonToPickAndPlaceCsv(soup as never);
      } catch {
        return "# PNP generation failed\n";
      }
    });
    const kicadPromise =
      formatSet.kicad || formatSet.reviewBundle
        ? assessKicadFindings(soup).catch(() => null)
        : Promise.resolve(null);

    const [layers, platedDrill, unplatedDrill, bomCsv, pnpCsv, kicadResult] = await Promise.all([
      layersPromise,
      platedDrillPromise,
      unplatedDrillPromise,
      bomPromise,
      pnpPromise,
      kicadPromise,
    ]);

    for (const [name, content] of Object.entries(layers)) {
      gerbers.file(`${name}.gbr`, content as string);
    }

    if (platedDrill) gerbers.file("plated.drl", platedDrill);
    if (unplatedDrill) gerbers.file("unplated.drl", unplatedDrill);

    zip.file("bom.csv", bomCsv);
    zip.file("pnp.csv", pnpCsv);

    if (formatSet.kicad || formatSet.reviewBundle) {
      const safeKicadResult = kicadResult;
      const schemaText =
        typeof safeKicadResult?.kicadSchema === "string" && safeKicadResult.kicadSchema.trim()
          ? safeKicadResult.kicadSchema
          : "(kicad_sch\n  (version 20211014)\n  (generator CircuitForge)\n  (comment \"kicad conversion unavailable\")\n)";

      zip.file("kicad_sch", schemaText);

      if (formatSet.reviewBundle) {
        const findings = (safeKicadResult?.findings ?? [])
          .map((entry) => entry as ValidationDiagnostic)
          .slice(0, 500);
        zip.file(
          "connectivity.json",
          JSON.stringify(safeKicadResult?.connectivity ?? {}, null, 2)
        );
        zip.file(
          "kicad_report.json",
          JSON.stringify(
            {
              ok: safeKicadResult?.ok ?? false,
              findings,
              traceability: safeKicadResult?.traceability ?? null,
              connectivity: safeKicadResult?.connectivity ?? null,
              metadata: {
                ...(safeKicadResult?.metadata ?? {}),
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
