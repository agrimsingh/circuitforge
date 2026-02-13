import { Sandbox } from "@vercel/sandbox";
import type { ValidationDiagnostic } from "@/lib/stream/types";
import {
  type KicadValidationResult,
  assessKicadFindings,
  assessKicadFindingsFromRaw,
} from "@/lib/kicad/review";

const COMPILE_API_URL = "https://compile.tscircuit.com/api/compile";
const SANDBOX_RUNTIME = "node24";
const SANDBOX_TIMEOUT_MS = 2 * 60 * 1000;

type CompileSource = "sandbox" | "inline";

interface KicadDiagnostics {
  findings: ValidationDiagnostic[];
  connectivity?: unknown;
  traceability?: unknown;
}

export interface CompileResult {
  ok: boolean;
  status: number;
  source: CompileSource;
  circuitJson: unknown[] | null;
  errorMessage: string | null;
}

function getErrorMessage(payload: unknown, fallbackText: string, status: number) {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (typeof record.details === "string" && record.details.trim()) return record.details;
    if (typeof record.error === "string" && record.error.trim()) return record.error;
    if (typeof record.message === "string" && record.message.trim()) return record.message;
  }

  const trimmed = fallbackText.trim();
  if (!trimmed) return `Compile failed with status ${status}`;
  return trimmed.slice(0, 1500);
}

function parseCompileResult(raw: { ok: boolean; status: number; text: string; source: CompileSource }): CompileResult {
  let payload: unknown = null;
  try {
    payload = raw.text ? JSON.parse(raw.text) : null;
  } catch {
    payload = null;
  }

  if (raw.ok && payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.circuit_json)) {
      return {
        ok: true,
        status: raw.status,
        source: raw.source,
        circuitJson: record.circuit_json,
        errorMessage: null,
      };
    }
  }

  return {
    ok: false,
    status: raw.status,
    source: raw.source,
    circuitJson: null,
    errorMessage: getErrorMessage(payload, raw.text, raw.status),
  };
}

async function compileInline(code: string): Promise<CompileResult> {
  const response = await fetch(COMPILE_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fs_map: { "main.tsx": code } }),
  });

  const text = await response.text();
  return parseCompileResult({
    ok: response.ok,
    status: response.status,
    text,
    source: "inline",
  });
}

async function compileWithSandbox(code: string): Promise<CompileResult> {
  let sandbox: Sandbox | null = null;

  try {
    sandbox = await Sandbox.create({
      runtime: SANDBOX_RUNTIME,
      timeout: SANDBOX_TIMEOUT_MS,
    });

    const payloadB64 = Buffer.from(
      JSON.stringify({ fs_map: { "main.tsx": code } }),
      "utf8"
    ).toString("base64");

    const script =
      "(async()=>{" +
      "const payload=JSON.parse(Buffer.from(process.env.CIRCUITFORGE_PAYLOAD_B64||'', 'base64').toString('utf8'));" +
      "const res=await fetch('https://compile.tscircuit.com/api/compile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});" +
      "const text=await res.text();" +
      "console.log(JSON.stringify({ok:res.ok,status:res.status,text}));" +
      "})().catch((err)=>{console.error(String(err));process.exit(1);});";

    const command = await sandbox.runCommand({
      cmd: "node",
      args: ["-e", script],
      env: { CIRCUITFORGE_PAYLOAD_B64: payloadB64 },
    });

    const stdout = (await command.stdout()).trim();
    if (command.exitCode !== 0) {
      const stderr = (await command.stderr()).trim();
      throw new Error(stderr || stdout || "Sandbox compile command failed");
    }

    const parsed = JSON.parse(stdout) as { ok: boolean; status: number; text: string };
    return parseCompileResult({
      ...parsed,
      source: "sandbox",
    });
  } finally {
    if (sandbox) {
      await sandbox.stop().catch(() => {
        // Ignore teardown errors.
      });
    }
  }
}

export async function compileForValidation(code: string): Promise<CompileResult> {
  try {
    return await compileWithSandbox(code);
  } catch {
    return compileInline(code);
  }
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
    },
  ];
}

function mergeKicadResults(result: KicadValidationResult | null): ValidationDiagnostic[] {
  if (!result) return [];
  const findings = assessKicadFindingsFromRaw(result.findings);
  return findings.map((entry) => ({
    ...entry,
    source: "kicad",
  }));
}

export async function compileAndValidateWithKicad(
  code: string,
): Promise<{
  compileResult: CompileResult;
  kicadResult: KicadValidationResult | null;
  allDiagnostics: ValidationDiagnostic[];
}> {
  const compileResult = await compileForValidation(code);
  if (!compileResult.ok || !compileResult.circuitJson) {
    return {
      compileResult,
      kicadResult: null,
      allDiagnostics: createCompileFailureDiagnostics(compileResult.errorMessage ?? "compile failed"),
    };
  }

  const kicadResult = await assessKicadFindingsFromCircuitJson(compileResult.circuitJson);
  const kicadDiagnostics = mergeKicadResults(kicadResult);
  const tscircuitDiagnostics = extractValidationDiagnostics(compileResult.circuitJson);

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
  return diagnostics.map((d) => `${d.source ?? "tscircuit"}:${d.signature}`).sort().join("||");
}

export function formatDiagnosticsForPrompt(diagnostics: ValidationDiagnostic[], limit = 8) {
  return diagnostics
    .slice(0, limit)
    .map(
      (d, i) =>
        `${i + 1}. [${d.source ?? "tscircuit"}:${d.category}] ${d.message}`,
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
