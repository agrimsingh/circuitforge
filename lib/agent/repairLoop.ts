import { Sandbox } from "@vercel/sandbox";
import type { ValidationDiagnostic } from "@/lib/stream/types";
import {
  type KicadValidationResult,
  assessKicadFindings,
  assessKicadFindingsFromRaw,
  resolveDiagnosticFamily,
} from "@/lib/kicad/review";

const COMPILE_API_URL = "https://compile.tscircuit.com/api/compile";
const SANDBOX_RUNTIME = "node24";
const SANDBOX_TIMEOUT_MS = 2 * 60 * 1000;
const COMPILE_FETCH_TIMEOUT_MS = 30_000;
const COMPILE_FETCH_RETRIES = 2;
const COMPILE_FETCH_BACKOFF_MS = 350;
const SANDBOX_POOL_SIZE = Math.max(
  1,
  Number.parseInt(process.env.CIRCUITFORGE_SANDBOX_POOL_SIZE ?? "4", 10) || 4,
);

type CompileSource = "sandbox" | "inline";

const sandboxPool: Sandbox[] = [];
let createdSandboxCount = 0;
const sandboxWaitQueue: Array<{
  resolve: (sandbox: Sandbox) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}> = [];

function makeAbortError(message: string) {
  return new DOMException(message, "AbortError");
}

function dequeueActiveWaiter() {
  while (sandboxWaitQueue.length > 0) {
    const waiter = sandboxWaitQueue.shift();
    if (!waiter) continue;
    if (waiter.signal?.aborted) continue;
    if (waiter.signal && waiter.onAbort) {
      waiter.signal.removeEventListener("abort", waiter.onAbort);
    }
    return waiter;
  }
  return null;
}

async function hydrateWaiterFromNewSandbox() {
  const waiter = dequeueActiveWaiter();
  if (!waiter) return;
  if (createdSandboxCount >= SANDBOX_POOL_SIZE) {
    sandboxWaitQueue.unshift(waiter);
    return;
  }

  createdSandboxCount += 1;
  try {
    const sandbox = await Sandbox.create({
      runtime: SANDBOX_RUNTIME,
      timeout: SANDBOX_TIMEOUT_MS,
    });
    waiter.resolve(sandbox);
  } catch (error) {
    createdSandboxCount = Math.max(0, createdSandboxCount - 1);
    waiter.reject(error instanceof Error ? error : new Error(String(error)));
    void hydrateWaiterFromNewSandbox();
  }
}

async function acquireSandbox(signal?: AbortSignal): Promise<Sandbox> {
  if (signal?.aborted) throw makeAbortError("Sandbox acquisition aborted");
  const pooled = sandboxPool.pop();
  if (pooled) return pooled;

  if (createdSandboxCount < SANDBOX_POOL_SIZE) {
    createdSandboxCount += 1;
    try {
      return await Sandbox.create({ runtime: SANDBOX_RUNTIME, timeout: SANDBOX_TIMEOUT_MS });
    } catch (error) {
      createdSandboxCount = Math.max(0, createdSandboxCount - 1);
      throw error;
    }
  }

  return new Promise<Sandbox>((resolve, reject) => {
    const waiter = {
      resolve,
      reject,
      signal,
    } as {
      resolve: (sandbox: Sandbox) => void;
      reject: (error: Error) => void;
      signal?: AbortSignal;
      onAbort?: () => void;
    };
    if (signal) {
      const onAbort = () => {
        const idx = sandboxWaitQueue.indexOf(waiter);
        if (idx >= 0) sandboxWaitQueue.splice(idx, 1);
        reject(makeAbortError("Sandbox queue wait aborted"));
      };
      waiter.onAbort = onAbort;
      signal.addEventListener("abort", onAbort, { once: true });
    }
    sandboxWaitQueue.push(waiter);
  });
}

function releaseSandbox(sb: Sandbox) {
  const waiter = dequeueActiveWaiter();
  if (waiter) {
    waiter.resolve(sb);
    return;
  }

  if (sandboxPool.length < SANDBOX_POOL_SIZE) {
    sandboxPool.push(sb);
    return;
  }

  createdSandboxCount = Math.max(0, createdSandboxCount - 1);
  sb.stop().catch(() => {});
}

function discardSandbox(sb: Sandbox) {
  createdSandboxCount = Math.max(0, createdSandboxCount - 1);
  sb.stop().catch(() => {});
  void hydrateWaiterFromNewSandbox();
}

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

async function delay(ms: number, signal?: AbortSignal) {
  if (ms <= 0) return;
  if (signal?.aborted) throw makeAbortError("Delay aborted");
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onAbort = () => {
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      reject(makeAbortError("Delay aborted"));
    };
    timer = setTimeout(() => {
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

async function compileInline(code: string, signal?: AbortSignal): Promise<CompileResult> {
  const timeoutSignal = AbortSignal.timeout(COMPILE_FETCH_TIMEOUT_MS);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= COMPILE_FETCH_RETRIES; attempt += 1) {
    try {
      const response = await fetch(COMPILE_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fs_map: { "main.tsx": code } }),
        signal: combinedSignal,
      });

      const text = await response.text();
      const result = parseCompileResult({
        ok: response.ok,
        status: response.status,
        text,
        source: "inline",
      });

      const shouldRetry = !response.ok && response.status >= 500 && attempt < COMPILE_FETCH_RETRIES;
      if (!shouldRetry) return result;
      await delay(COMPILE_FETCH_BACKOFF_MS * (attempt + 1), combinedSignal);
      continue;
    } catch (error) {
      lastError = error;
      if (attempt >= COMPILE_FETCH_RETRIES) break;
      await delay(COMPILE_FETCH_BACKOFF_MS * (attempt + 1), combinedSignal);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Inline compile failed after retries");
}

async function compileWithSandbox(code: string, signal?: AbortSignal): Promise<CompileResult> {
  if (signal?.aborted) throw makeAbortError("Compile aborted before sandbox start");
  const sandbox = await acquireSandbox(signal);
  let abortHandler: (() => void) | null = null;

  try {
    if (signal) {
      abortHandler = () => {
        sandbox.stop().catch(() => {});
      };
      signal.addEventListener("abort", abortHandler, { once: true });
    }

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
    if (signal?.aborted) {
      throw makeAbortError("Compile aborted while waiting for sandbox output");
    }
    if (signal && abortHandler) {
      signal.removeEventListener("abort", abortHandler);
      abortHandler = null;
    }
    releaseSandbox(sandbox);
    return parseCompileResult({
      ...parsed,
      source: "sandbox",
    });
  } catch (error) {
    discardSandbox(sandbox);
    throw error;
  } finally {
    if (signal && abortHandler) {
      signal.removeEventListener("abort", abortHandler);
    }
  }
}

export async function compileForValidation(code: string, signal?: AbortSignal): Promise<CompileResult> {
  try {
    return await compileWithSandbox(code, signal);
  } catch {
    return compileInline(code, signal);
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

  const [kicadResult, tscircuitDiagnostics] = await Promise.all([
    assessKicadFindingsFromCircuitJson(compileResult.circuitJson),
    Promise.resolve(extractValidationDiagnostics(compileResult.circuitJson)),
  ]);
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
