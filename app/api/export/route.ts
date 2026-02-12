import {
  convertSoupToGerberCommands,
  stringifyGerberCommandLayers,
  convertSoupToExcellonDrillCommands,
  stringifyExcellonDrill,
} from "circuit-json-to-gerber";
import { convertCircuitJsonToBomRows, convertBomRowsToCsv } from "circuit-json-to-bom-csv";
import { convertCircuitJsonToPickAndPlaceCsv } from "circuit-json-to-pnp-csv";
import JSZip from "jszip";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { circuit_json: unknown[] };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!Array.isArray(body.circuit_json)) {
    return new Response(
      JSON.stringify({ error: "Missing 'circuit_json' array in body" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const soup = body.circuit_json;

  try {
    const zip = new JSZip();
    const gerbers = zip.folder("gerbers")!;

    const gerberCommands = convertSoupToGerberCommands(soup as never);
    const layers = stringifyGerberCommandLayers(gerberCommands as never);
    for (const [name, content] of Object.entries(layers)) {
      gerbers.file(`${name}.gbr`, content as string);
    }

    try {
      const drill = convertSoupToExcellonDrillCommands({ circuitJson: soup as never, is_plated: true });
      gerbers.file("plated.drl", stringifyExcellonDrill(drill as never));
    } catch { /* no plated holes */ }

    try {
      const drill = convertSoupToExcellonDrillCommands({ circuitJson: soup as never, is_plated: false });
      gerbers.file("unplated.drl", stringifyExcellonDrill(drill as never));
    } catch { /* no unplated holes */ }

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
