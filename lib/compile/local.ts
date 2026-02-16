export interface LocalCompileResult {
  ok: boolean;
  circuitJson: unknown[] | null;
  errorMessage: string | null;
  source: "local" | "remote";
}

const REMOTE_COMPILE_URL = "https://compile.tscircuit.com/api/compile";
const REMOTE_FETCH_TIMEOUT_MS = 30_000;

/**
 * Compile tscircuit TSX code locally using @tscircuit/eval.
 * No external timeout — runs until the circuit settles or the signal aborts.
 */
export async function compileLocally(
  fsMap: Record<string, string>,
  signal?: AbortSignal,
): Promise<LocalCompileResult> {
  if (signal?.aborted) {
    throw new DOMException("Compile aborted", "AbortError");
  }

  const { CircuitRunner } = await import("@tscircuit/eval");
  const runner = new CircuitRunner();

  let abortHandler: (() => void) | null = null;
  if (signal) {
    abortHandler = () => {
      runner.kill?.();
    };
    signal.addEventListener("abort", abortHandler, { once: true });
  }

  try {
    const hasExportDefault = fsMap["main.tsx"]?.includes("export default");
    await runner.executeWithFsMap({
      fsMap,
      ...(hasExportDefault
        ? { mainComponentPath: "main.tsx" }
        : { entrypoint: "main.tsx" }),
    });
    await runner.renderUntilSettled();
    const circuitJson = await runner.getCircuitJson();

    return {
      ok: true,
      circuitJson: circuitJson as unknown[] | null,
      errorMessage: null,
      source: "local",
    };
  } catch (error) {
    if (signal?.aborted) {
      throw new DOMException("Compile aborted", "AbortError");
    }
    return {
      ok: false,
      circuitJson: null,
      errorMessage: error instanceof Error ? error.message : String(error),
      source: "local",
    };
  } finally {
    if (signal && abortHandler) {
      signal.removeEventListener("abort", abortHandler);
    }
  }
}

/**
 * Compile via the remote tscircuit API (fallback).
 */
export async function compileRemote(
  fsMap: Record<string, string>,
  signal?: AbortSignal,
): Promise<LocalCompileResult> {
  const timeoutSignal = AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;

  const response = await fetch(REMOTE_COMPILE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fs_map: fsMap }),
    signal: combinedSignal,
  });

  const text = await response.text();
  let payload: Record<string, unknown> | null = null;
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    payload = null;
  }

  if (response.ok && payload && Array.isArray(payload.circuit_json)) {
    return {
      ok: true,
      circuitJson: payload.circuit_json as unknown[],
      errorMessage: null,
      source: "remote",
    };
  }

  const errorMessage =
    (payload && typeof payload.details === "string" && payload.details) ||
    (payload && typeof payload.error === "string" && payload.error) ||
    (payload && typeof payload.message === "string" && payload.message) ||
    text.slice(0, 1500) ||
    `Compile failed with status ${response.status}`;

  return {
    ok: false,
    circuitJson: null,
    errorMessage: String(errorMessage),
    source: "remote",
  };
}

/**
 * Compile with local-first strategy. Falls back to remote API if local fails
 * with an unexpected error (e.g., import resolution issues).
 */
export async function compileWithFallback(
  fsMap: Record<string, string>,
  signal?: AbortSignal,
): Promise<LocalCompileResult> {
  try {
    return await compileLocally(fsMap, signal);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    console.warn("[compile] Local compile threw, falling back to remote:", error);
    return compileRemote(fsMap, signal);
  }
}
