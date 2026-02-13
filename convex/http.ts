import { httpAction } from "./_generated/server";
import { httpRouter } from "convex/server";
import { api } from "./_generated/api";

const http = httpRouter();

function isAuthorized(req: Request) {
  const sharedSecret = process.env.CIRCUITFORGE_CONVEX_SHARED_SECRET;
  if (!sharedSecret) return false;
  const provided = req.headers.get("x-circuitforge-secret");
  return Boolean(provided && provided === sharedSecret);
}

http.route({
  path: "/error-memory/record",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!isAuthorized(req)) {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as {
      categories?: unknown;
      diagnosticsCount?: unknown;
      createdAt?: unknown;
    };

    const categories = Array.isArray(body.categories)
      ? body.categories.filter((c): c is string => typeof c === "string")
      : [];
    const diagnosticsCount =
      typeof body.diagnosticsCount === "number" && Number.isFinite(body.diagnosticsCount)
        ? body.diagnosticsCount
        : categories.length;
    const createdAt =
      typeof body.createdAt === "number" && Number.isFinite(body.createdAt)
        ? body.createdAt
        : Date.now();

    const result = await ctx.runMutation(api.errorMemory.recordSample, {
      categories,
      diagnosticsCount,
      createdAt,
    });

    return Response.json(result);
  }),
});

http.route({
  path: "/error-memory/guardrails",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!isAuthorized(req)) {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as { maxCategories?: unknown };
    const maxCategories =
      typeof body.maxCategories === "number" && Number.isFinite(body.maxCategories)
        ? body.maxCategories
        : 3;

    const result = await ctx.runQuery(api.errorMemory.getAdaptiveGuardrails, {
      maxCategories,
    });

    return Response.json({
      ok: true,
      guardrails: result.guardrails ?? "",
      sampleCount: result.sampleCount ?? 0,
    });
  }),
});

export default http;
