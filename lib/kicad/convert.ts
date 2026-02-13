import type { ValidationDiagnostic } from "@/lib/stream/types";
import { loadKicadLibrary } from "./bridge";

export interface KicadConversionResult {
  ok: boolean;
  kicadSchema?: string;
  diagnostics: ValidationDiagnostic[];
  connectivity?: unknown;
  traceability?: unknown;
  metadata: Record<string, unknown>;
}

function toDiagnostic(category: string, message: string): ValidationDiagnostic {
  return {
    category,
    message,
    severity: 10,
    signature: `${category}|${message.slice(0, 180)}`,
    source: "kicad",
  };
}

function findFirstFunction(module: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (typeof module[key] === "function") return module[key];
    const nested = (module as { default?: unknown }).default;
    if (typeof nested === "object" && nested !== null) {
      const nestedRecord = nested as Record<string, unknown>;
      if (typeof nestedRecord[key] === "function") return nestedRecord[key];
    }
  }
  return null;
}

function ensureFallbackSchematic(cause: string) {
  return [
    "(kicad_sch",
    `  (version 20211014)`,
    "  (generator CircuitForge)",
    `  (paper A4)`,
    `  (comment "kicad conversion fallback: ${cause}")`,
    ")",
    "",
    "",
  ].join("\\n");
}

type LibraryFunctionMap = Record<string, unknown>;

function getMember(module: LibraryFunctionMap, key: string): unknown {
  if (module[key] !== undefined) return module[key];
  const nested = (module as { default?: unknown }).default;
  if (typeof nested === "object" && nested !== null) {
    return (nested as Record<string, unknown>)[key];
  }
  return undefined;
}

async function convertWithPrimaryLibrary(
  module: LibraryFunctionMap,
  circuitJson: unknown[],
): Promise<string> {
  const converterCtor = getMember(module, "CircuitJsonToKicadSchConverter") as
    | (new (circuitJson: unknown[]) => {
        runUntilFinished(): void;
        getOutputString(): unknown;
      })
    | undefined;

  if (typeof converterCtor !== "function") {
    throw new Error("CircuitJsonToKicadSchConverter is unavailable");
  }

  const converter = new converterCtor(circuitJson);
  converter.runUntilFinished();
  const output = converter.getOutputString();
  const schemaText = typeof output === "string" ? output : output?.toString?.();
  if (!schemaText || typeof schemaText !== "string") {
    throw new Error("circuit-json-to-kicad converter did not return schematic text");
  }
  return schemaText;
}

async function convertWithFallbackLibrary(
  module: LibraryFunctionMap,
  circuitJson: unknown[],
): Promise<string> {
  const parseFunction = findFirstFunction(module, [
    "fromCircuitJson",
    "convertCircuitJsonToSchematic",
    "circuitJsonToKicad",
    "circuitJsonToKicadSchematic",
  ]);

  const writeFunction = findFirstFunction(module, [
    "toKicadSch",
    "toKicadSchematic",
    "serializeKicadSch",
    "writeKicadSch",
  ]);

  if (typeof parseFunction !== "function" || typeof writeFunction !== "function") {
    throw new Error("Fallback kicad-sch-ts API is incomplete");
  }

  const schematic = await Promise.resolve(
    (parseFunction as (input: unknown[]) => unknown | Promise<unknown>)(circuitJson),
  );
  const output = await Promise.resolve(
    (writeFunction as (input: unknown) => string | { toString: () => string } | Promise<string>)(
      schematic,
    ),
  );
  const schemaText = typeof output === "string" ? output : output?.toString?.();
  if (!schemaText || typeof schemaText !== "string") {
    throw new Error("kicad-sch-ts converter did not return schematic text");
  }
  return schemaText;
}

async function loadFallbackLibrary(): Promise<LibraryFunctionMap | null> {
  try {
    return (await import("kicad-sch-ts")) as LibraryFunctionMap;
  } catch {
    return null;
  }
}

export async function convertTscircuitCircuitJsonToKicadSchema(
  circuitJson: unknown[],
): Promise<KicadConversionResult> {
  const metadata: Record<string, unknown> = {
    source: "circuit-json",
    generatedAt: Date.now(),
    attempts: [],
  };

  const library = await loadKicadLibrary();
  if (!library) {
    metadata.conversionBackend = "none";
    metadata.loadFailure = true;
    return {
      ok: false,
      diagnostics: [
        toDiagnostic(
          "kicad_library_missing",
          "No KiCad conversion module is available; generating fallback placeholder schematic",
        ),
      ],
      kicadSchema: ensureFallbackSchematic("conversion libraries unavailable"),
      metadata,
    };
  }

  const source = (library as { __source?: string }).__source ?? "unknown";
  const conversionDiagnostics: string[] = [];
  metadata.conversionBackend = source;

  try {
    const schemaText = await convertWithPrimaryLibrary(library as LibraryFunctionMap, circuitJson);
    metadata.conversionBackend = "circuit-json-to-kicad";
    metadata.attempts = ["circuit-json-to-kicad"];
    return {
      ok: true,
      diagnostics: [],
      kicadSchema: schemaText,
      metadata,
    };
  } catch (error) {
    conversionDiagnostics.push(
      `circuit-json-to-kicad: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const fallbackDiagnostics: string[] = [];
  try {
    const fallbackLibrary = await loadFallbackLibrary();
    const fallbackSchemaText = await convertWithFallbackLibrary(
      fallbackLibrary ?? (library as LibraryFunctionMap),
      circuitJson,
    );
    metadata.conversionBackend = "kicad-sch-ts";
    metadata.attempts = ["circuit-json-to-kicad", "kicad-sch-ts-fallback"];
    return {
      ok: true,
      diagnostics: conversionDiagnostics.map((diagnosticMessage) =>
        toDiagnostic("kicad_converter_fallback_hint", diagnosticMessage),
      ),
      kicadSchema: fallbackSchemaText,
      metadata,
    };
  } catch (error) {
    fallbackDiagnostics.push(
      `kicad-sch-ts: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return {
    ok: false,
    diagnostics: [...conversionDiagnostics, ...fallbackDiagnostics].map((diagnosticMessage) =>
      toDiagnostic("kicad_converter_error", diagnosticMessage),
    ),
    kicadSchema: ensureFallbackSchematic([...conversionDiagnostics, ...fallbackDiagnostics].join(" | ")),
    metadata: {
      ...metadata,
      attempts: ["circuit-json-to-kicad", "kicad-sch-ts-fallback"],
      conversionFailure: true,
      conversionBackend: source,
    },
  };
}
