import type { ValidationDiagnostic } from "@/lib/stream/types";
import {
  getAdaptiveGuardrails as getInMemoryAdaptiveGuardrails,
  recordDiagnosticsSample as recordInMemoryDiagnosticsSample,
} from "@/lib/agent/errorMemory";

interface ConvexConfig {
  siteUrl: string;
  sharedSecret: string;
}

interface GuardrailsResponse {
  ok?: boolean;
  guardrails?: string;
}

const REQUEST_TIMEOUT_MS = Math.max(
  500,
  Number.parseInt(process.env.CIRCUITFORGE_CONVEX_TIMEOUT_MS ?? "5000", 10) || 5000,
);
const REQUEST_RETRIES = Math.max(
  0,
  Number.parseInt(process.env.CIRCUITFORGE_CONVEX_RETRIES ?? "2", 10) || 2,
);
const RETRY_BACKOFF_MS = 250;

async function delay(ms: number) {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function getConvexConfig(): ConvexConfig | null {
  const siteUrl = (
    process.env.CONVEX_SITE_URL?.trim() ||
    process.env.NEXT_PUBLIC_CONVEX_SITE_URL?.trim()
  );
  const sharedSecret = process.env.CIRCUITFORGE_CONVEX_SHARED_SECRET?.trim();
  if (!siteUrl || !sharedSecret) return null;
  return {
    siteUrl: siteUrl.replace(/\/$/, ""),
    sharedSecret,
  };
}

async function postConvexJson<TResponse>(config: ConvexConfig, path: string, payload: unknown) {
  const safeRetries = REQUEST_RETRIES;

  for (let attempt = 0; attempt <= safeRetries; attempt += 1) {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${config.siteUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-circuitforge-secret": config.sharedSecret,
        },
        body: JSON.stringify(payload),
        signal: abortController.signal,
        cache: "no-store",
      });

      if (!response.ok) {
        const shouldRetry = response.status >= 500 || response.status === 429;
        if (attempt < safeRetries && shouldRetry) {
          await delay(RETRY_BACKOFF_MS * (attempt + 1));
          continue;
        }
        return null;
      }
      return (await response.json()) as TResponse;
    } catch {
      if (attempt < safeRetries) {
        await delay(RETRY_BACKOFF_MS * (attempt + 1));
        continue;
      }
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  return null;
}

export async function getAdaptiveGuardrailsPersistent(maxCategories = 3) {
  const fallback = getInMemoryAdaptiveGuardrails(maxCategories);
  const config = getConvexConfig();
  if (!config) return fallback;

  const response = await postConvexJson<GuardrailsResponse>(
    config,
    "/error-memory/guardrails",
    { maxCategories }
  );

  if (!response?.ok || typeof response.guardrails !== "string") {
    return fallback;
  }

  return response.guardrails || fallback;
}

export async function recordDiagnosticsSamplePersistent(diagnostics: ValidationDiagnostic[]) {
  recordInMemoryDiagnosticsSample(diagnostics);
  if (diagnostics.length === 0) return;

  const config = getConvexConfig();
  if (!config) return;

  const categories = [...new Set(
    diagnostics.map((d) => d.category?.trim()).filter((c): c is string => Boolean(c))
  )];
  if (categories.length === 0) return;

  await postConvexJson(config, "/error-memory/record", {
    categories,
    diagnosticsCount: diagnostics.length,
    createdAt: Date.now(),
  });
}
