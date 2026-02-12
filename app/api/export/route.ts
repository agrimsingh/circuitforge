import {
  convertSoupToGerberCommands,
  stringifyGerberCommandLayers,
  convertSoupToExcellonDrillCommands,
  stringifyExcellonDrill,
} from "circuit-json-to-gerber";
import { convertCircuitJsonToBomRows, convertBomRowsToCsv } from "circuit-json-to-bom-csv";
import {
  convertCircuitJsonToPickAndPlaceCsv,
} from "circuit-json-to-pnp-csv";
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

  const circuitJson = body.circuit_json;

  try {
    const zip = new JSZip();
    const gerbersFolder = zip.folder("gerbers")!;

    // --- Gerber files ---
    const gerberCommands = convertSoupToGerberCommands(circuitJson as never);
    const gerberLayers = stringifyGerberCommandLayers(gerberCommands as never);
    for (const [layerName, content] of Object.entries(gerberLayers)) {
      gerbersFolder.file(`${layerName}.gbr`, content as string);
    }

    // --- Drill files ---
    try {
      const platedDrill = convertSoupToExcellonDrillCommands({
        circuitJson: circuitJson as never,
        is_plated: true,
      });
      gerbersFolder.file("plated.drl", stringifyExcellonDrill(platedDrill as never));
    } catch {
      // No plated holes — skip
    }

    try {
      const unplatedDrill = convertSoupToExcellonDrillCommands({
        circuitJson: circuitJson as never,
        is_plated: false,
      });
      gerbersFolder.file("unplated.drl", stringifyExcellonDrill(unplatedDrill as never));
    } catch {
      // No unplated holes — skip
    }

    // --- BOM CSV ---
    try {
      const bomRows = await convertCircuitJsonToBomRows({
        circuitJson: circuitJson as never,
      });
      const bomCsv = convertBomRowsToCsv(bomRows);
      zip.file("bom.csv", bomCsv);
    } catch {
      zip.file("bom.csv", "# BOM generation failed — circuit may not have source components\n");
    }

    // --- PNP CSV ---
    try {
      const pnpCsv = convertCircuitJsonToPickAndPlaceCsv(circuitJson as never);
      zip.file("pnp.csv", pnpCsv);
    } catch {
      zip.file("pnp.csv", "# PNP generation failed\n");
    }

    const zipArrayBuffer = await zip.generateAsync({ type: "arraybuffer" });

    return new Response(zipArrayBuffer, {
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
