import { compileForValidation } from "@/lib/agent/repairLoop";
import { assessKicadFindings } from "@/lib/kicad/review";

export const runtime = "nodejs";

type ValidateBody =
  | {
      tscircuit_code?: string;
      circuit_json?: unknown[];
    }
  | Record<string, unknown>;

export async function POST(req: Request) {
  let body: ValidateBody;
  try {
    body = (await req.json()) as ValidateBody;
  } catch {
    return new Response(
      JSON.stringify({
        error: "Invalid JSON body",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const explicitCircuitJson = Array.isArray((body as ValidateBody).circuit_json)
    ? ((body as ValidateBody).circuit_json as unknown[])
    : null;

  const tscircuitCode = typeof body.tscircuit_code === "string" ? body.tscircuit_code.trim() : "";

  let circuitJson: unknown[] | null = explicitCircuitJson;
  let compileError: string | null = null;

  if (!circuitJson && tscircuitCode.length > 0) {
    const compileResult = await compileForValidation(tscircuitCode);
    if (!compileResult.ok || !compileResult.circuitJson) {
      compileError =
        compileResult.errorMessage ?? "Compile failed";
      return new Response(
        JSON.stringify({
          ok: false,
          error: "tscircuit compile failed",
          details: compileError,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    circuitJson = compileResult.circuitJson;
  }

  if (!Array.isArray(circuitJson)) {
    return new Response(
      JSON.stringify({
        error: "Missing 'circuit_json' array or 'tscircuit_code' string",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const result = await assessKicadFindings(circuitJson);

  return new Response(
    JSON.stringify({
      ok: true,
      kicadSchema: result.kicadSchema,
      findings: result.findings,
      connectivity: result.connectivity,
      traceability: result.traceability,
      metadata: {
        ...result.metadata,
        sourceCircuitEntries: circuitJson.length,
      },
    }),
    { headers: { "Content-Type": "application/json" } }
  );
}

