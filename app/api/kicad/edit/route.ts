import { applyKicadMcpEdits, type KicadSchemaEdit } from "@/lib/kicad/review";

export const runtime = "nodejs";

type EditBody =
  | {
      kicad_sch?: string;
      edits?: KicadSchemaEdit[];
    }
  | Record<string, unknown>;

export async function POST(req: Request) {
  let body: EditBody;
  try {
    body = (await req.json()) as EditBody;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const kicadSchema = typeof body.kicad_sch === "string" ? body.kicad_sch.trim() : "";
  const edits = Array.isArray(body.edits) ? body.edits : [];

  if (!kicadSchema) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Missing or empty 'kicad_sch' input",
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const result = await applyKicadMcpEdits(kicadSchema, edits);
  return new Response(
    JSON.stringify(result),
    {
      status: result.ok ? 200 : 400,
      headers: { "Content-Type": "application/json" },
    },
  );
}

