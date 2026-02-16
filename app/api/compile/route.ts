import { compileWithFallback } from "@/lib/compile/local";

export const runtime = "nodejs";
export const maxDuration = 300;

type CompileBody = {
  fs_map?: Record<string, string>;
};

function isRecordOfStrings(v: unknown): v is Record<string, string> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  for (const val of Object.values(v)) {
    if (typeof val !== "string") return false;
  }
  return true;
}

export async function POST(req: Request) {
  let body: CompileBody;
  try {
    body = (await req.json()) as CompileBody;
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: "Invalid JSON body" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const fsMap = body.fs_map;
  if (!isRecordOfStrings(fsMap)) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Missing or invalid 'fs_map' (expected Record<string, string>)",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const result = await compileWithFallback(fsMap);

  if (result.ok && result.circuitJson !== null) {
    return new Response(
      JSON.stringify({ circuit_json: result.circuitJson }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({
      ok: false,
      error: result.errorMessage ?? "Compile failed",
    }),
    { status: 400, headers: { "Content-Type": "application/json" } },
  );
}
