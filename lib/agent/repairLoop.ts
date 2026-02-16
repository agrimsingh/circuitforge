import type { ValidationDiagnostic } from "@/lib/stream/types";
import {
  type KicadValidationResult,
  assessKicadFindings,
  assessKicadFindingsFromRaw,
  resolveDiagnosticFamily,
} from "@/lib/kicad/review";
import { compileWithFallback } from "@/lib/compile/local";

interface KicadDiagnostics {
  findings: ValidationDiagnostic[];
  connectivity?: unknown;
  traceability?: unknown;
}

export interface CompileResult {
  ok: boolean;
  source: string;
  circuitJson: unknown[] | null;
  errorMessage: string | null;
}

/**
 * Compile tscircuit code for validation. Uses local @tscircuit/eval first,
 * falls back to remote compile.tscircuit.com API.
 */
export async function compileForValidation(code: string, signal?: AbortSignal): Promise<CompileResult> {
  const result = await compileWithFallback({ "main.tsx": code }, signal);
  return {
    ok: result.ok,
    source: result.source,
    circuitJson: result.circuitJson,
    errorMessage: result.errorMessage,
  };
}

function readObjectIds(entry: Record<string, unknown>) {
  const ids: string[] = [];
  for (const [key, value] of Object.entries(entry)) {
    if (key.endsWith("_id") && typeof value === "string" && value.trim()) {
      ids.push(value);
    }
    if (key.endsWith("_ids") && Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && item.trim()) ids.push(item);
      }
    }
  }
  return ids.sort();
}

function scoreCategory(category: string, source: "tscircuit" | "kicad" = "tscircuit") {
  const base =
    category.includes("trace") || category.includes("via") || category.includes("clearance")
      ? 6
      : category.includes("short")
        ? 7
        : 4;

  return source === "kicad" ? base + 1 : base;
}

function signatureWithLocation(base: string, entry: Record<string, unknown>) {
  const center = entry.center;
  const pcbCenter = entry.pcb_center;
  const point =
    center && typeof center === "object"
      ? (center as Record<string, unknown>)
      : pcbCenter && typeof pcbCenter === "object"
        ? (pcbCenter as Record<string, unknown>)
        : null;

  if (!point) return base;
  const x = typeof point.x === "number" ? point.x.toFixed(2) : "?";
  const y = typeof point.y === "number" ? point.y.toFixed(2) : "?";
  return `${base}|${x},${y}`;
}

export function extractValidationDiagnostics(circuitJson: unknown[]): ValidationDiagnostic[] {
  const diagnostics: ValidationDiagnostic[] = [];

  for (const item of circuitJson) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;

    const type = typeof entry.type === "string" ? entry.type : "";
    const errorType = typeof entry.error_type === "string" ? entry.error_type : "";
    const category = (errorType || type).trim();

    if (!category) continue;
    if (!category.endsWith("_error") && !category.includes("error")) continue;

    const message =
      typeof entry.message === "string" && entry.message.trim()
        ? entry.message
        : `Validation error: ${category}`;

    const ids = readObjectIds(entry);
    const signatureBase = [category, ...ids].join("|");

    diagnostics.push({
      category,
      message,
      severity: scoreCategory(category, "tscircuit"),
      signature: signatureWithLocation(signatureBase || category, entry),
      source: "tscircuit",
      family: resolveDiagnosticFamily(category, message),
    });
  }

  return diagnostics;
}

export function createCompileFailureDiagnostics(errorMessage: string): ValidationDiagnostic[] {
  const message = errorMessage.trim() || "Compilation failed with unknown error";
  return [
    {
      category: "compile_error",
      message,
      severity: 10,
      signature: `compile_error|${message.slice(0, 300)}`,
      source: "tscircuit",
      family: resolveDiagnosticFamily("compile_error", message),
    },
  ];
}

function mergeKicadResults(result: KicadValidationResult | null): ValidationDiagnostic[] {
  if (!result) return [];
  const findings = assessKicadFindingsFromRaw(result.findings);
  return findings.map((entry) => ({
    ...entry,
    source: "kicad",
    family: entry.family ?? resolveDiagnosticFamily(entry.category, entry.message),
  }));
}

export async function compileAndValidateWithKicad(
  code: string,
  signal?: AbortSignal,
): Promise<{
  compileResult: CompileResult;
  kicadResult: KicadValidationResult | null;
  allDiagnostics: ValidationDiagnostic[];
}> {
  const compileResult = await compileForValidation(code, signal);
  if (!compileResult.ok || !compileResult.circuitJson) {
    return {
      compileResult,
      kicadResult: null,
      allDiagnostics: createCompileFailureDiagnostics(compileResult.errorMessage ?? "compile failed"),
    };
  }

  const tscircuitDiagnostics = extractValidationDiagnostics(compileResult.circuitJson);
  const kicadResult = await assessKicadFindingsFromCircuitJson(compileResult.circuitJson);
  const kicadDiagnostics = mergeKicadResults(kicadResult);

  return {
    compileResult,
    kicadResult,
    allDiagnostics: [...tscircuitDiagnostics, ...kicadDiagnostics],
  };
}

export async function assessKicadFindingsFromCircuitJson(circuitJson: unknown[]): Promise<KicadValidationResult> {
  const res = await assessKicadFindings(circuitJson);
  return res;
}

export function computeDiagnosticsScore(diagnostics: ValidationDiagnostic[], compileFailed: boolean) {
  const baseScore = diagnostics.reduce((sum, d) => sum + d.severity * 100, 0);
  return compileFailed ? baseScore + 5000 : baseScore;
}

export function createDiagnosticsSetSignature(diagnostics: ValidationDiagnostic[]) {
  if (diagnostics.length === 0) return "clean";
  return diagnostics.map((d) => d.signature).sort().join("||");
}

export function formatDiagnosticsForPrompt(diagnostics: ValidationDiagnostic[], limit = 8) {
  return diagnostics
    .slice(0, limit)
    .map(
      (d, i) =>
        `${i + 1}. [${d.category}] ${d.message}`,
    )
    .join("\n");
}

export function kicadReviewSummary(result: KicadValidationResult | null): KicadDiagnostics {
  if (!result) {
    return { findings: [], connectivity: null, traceability: null };
  }

  return {
    findings: assessKicadFindingsFromRaw(result.findings).map((diagnostic) => ({
      ...diagnostic,
      source: "kicad",
    })),
    connectivity: result.connectivity,
    traceability: result.traceability,
  };
}
