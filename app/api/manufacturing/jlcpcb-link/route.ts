export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { bom_csv?: string; kicad_sch?: string; orderHints?: Record<string, unknown> } & Record<
    string,
    unknown
  >;

  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const payload = {
    version: "v1",
    provider: "jlcpcb",
    status: "stub",
    supportedFiles: ["bom.csv", "kicad_sch"],
    note: "Stub implementation: prepare files in preferred JLCPCB format before sending to BOM upload API.",
    receivedHints: body?.orderHints ?? {},
    generatedAt: Date.now(),
  };

  return Response.json(payload);
}

