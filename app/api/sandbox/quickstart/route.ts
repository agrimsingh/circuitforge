import { runVercelSandboxSmokeTest } from "@/lib/sandbox/vercelSandbox";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  try {
    const result = await runVercelSandboxSmokeTest();
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
