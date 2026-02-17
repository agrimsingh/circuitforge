import type { ValidationDiagnostic } from "@/lib/stream/types";

const TSCIRCUIT_AI_REFERENCE_URL = "https://docs.tscircuit.com/ai.txt";
const REFERENCE_FETCH_TIMEOUT_MS = 4_000;
const REFERENCE_CACHE_TTL_MS = 1000 * 60 * 60;
const MAX_REFERENCE_CHARS = 2_400;

let cachedReference: { text: string; fetchedAt: number } | null = null;
let inflightFetch: Promise<string> | null = null;

function shouldIncludeReference(diagnostics: ValidationDiagnostic[]): boolean {
  return diagnostics.some((entry) => {
    const category = entry.category.toLowerCase();
    return (
      category.startsWith("source_") ||
      category.includes("compile") ||
      category.includes("footprint") ||
      category.includes("autorouter")
    );
  });
}

function combineSignals(signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const valid = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (valid.length === 0) return undefined;
  if (valid.length === 1) return valid[0];
  return AbortSignal.any(valid);
}

function categoriesToKeywords(diagnostics: ValidationDiagnostic[]): string[] {
  const keywords = new Set<string>([
    "trace",
    "selector",
    "net",
    "footprint",
    "pinlabels",
    "connections",
    "supplierpartnumbers",
    "board",
    "routing",
  ]);

  for (const entry of diagnostics) {
    const category = entry.category.toLowerCase();
    if (category.includes("trace")) {
      keywords.add("from");
      keywords.add("to");
      keywords.add("trace");
    }
    if (category.includes("footprint")) {
      keywords.add("footprint");
      keywords.add("package");
    }
    if (category.includes("compile") || category.includes("source_failed_to_create_component")) {
      keywords.add("chip");
      keywords.add("pinlabels");
      keywords.add("connections");
      keywords.add("supplierpartnumbers");
    }
    if (category.includes("autorouter")) {
      keywords.add("pcbx");
      keywords.add("pcby");
      keywords.add("board");
      keywords.add("routing");
      keywords.add("clearance");
    }
  }

  return Array.from(keywords);
}

function extractRelevantLines(referenceText: string, keywords: string[]): string {
  const lines = referenceText.split(/\r?\n/);
  const normalizedKeywords = keywords.map((k) => k.toLowerCase());
  const selected = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (!normalizedKeywords.some((keyword) => lower.includes(keyword))) continue;
    const start = Math.max(0, i - 1);
    const end = Math.min(lines.length - 1, i + 1);
    for (let j = start; j <= end; j++) selected.add(j);
  }

  const ordered = Array.from(selected)
    .sort((a, b) => a - b)
    .map((index) => lines[index].trim())
    .filter(Boolean);

  let output = "";
  for (const line of ordered) {
    const next = output ? `${output}\n- ${line}` : `- ${line}`;
    if (next.length > MAX_REFERENCE_CHARS) break;
    output = next;
  }

  return output;
}

async function fetchReferenceText(signal?: AbortSignal): Promise<string> {
  if (process.env.NODE_ENV === "test") return "";
  if (process.env.CIRCUITFORGE_USE_TSCIRCUIT_AI_REFERENCE === "false") return "";

  const now = Date.now();
  if (cachedReference && now - cachedReference.fetchedAt < REFERENCE_CACHE_TTL_MS) {
    return cachedReference.text;
  }
  if (inflightFetch) return inflightFetch;

  inflightFetch = (async () => {
    const timeoutSignal = AbortSignal.timeout(REFERENCE_FETCH_TIMEOUT_MS);
    const requestSignal = combineSignals([signal, timeoutSignal]);
    try {
      const response = await fetch(TSCIRCUIT_AI_REFERENCE_URL, {
        method: "GET",
        signal: requestSignal,
        cache: "no-store",
      });
      if (!response.ok) return "";
      const text = await response.text();
      if (!text.trim()) return "";
      cachedReference = { text, fetchedAt: Date.now() };
      return text;
    } catch {
      return "";
    } finally {
      inflightFetch = null;
    }
  })();

  return inflightFetch;
}

export async function getTscircuitReferenceHints(
  diagnostics: ValidationDiagnostic[],
  signal?: AbortSignal,
): Promise<string> {
  if (!shouldIncludeReference(diagnostics)) return "";
  const referenceText = await fetchReferenceText(signal);
  if (!referenceText) return "";
  const keywords = categoriesToKeywords(diagnostics);
  return extractRelevantLines(referenceText, keywords);
}

