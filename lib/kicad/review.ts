import type { ValidationDiagnostic } from "@/lib/stream/types";
import { convertTscircuitCircuitJsonToKicadSchema } from "./convert";
import { join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

type UnknownRecord = Record<string, unknown>;

export interface KicadValidationResult {
  ok: boolean;
  findings: unknown[];
  diagnostics: ValidationDiagnostic[];
  connectivity?: unknown;
  traceability?: unknown;
  kicadSchema?: string;
  metadata: Record<string, unknown>;
}

const BOM_REQUIRED_PROPERTIES = ["PartNumber", "Manufacturer"];

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeCategory(item: UnknownRecord): string {
  return (
    asString(item.category) ??
    asString(item.type) ??
    asString(item.code) ??
    "kicad_finding"
  );
}

function normalizeMessage(item: UnknownRecord): string {
  return (
    asString(item.message) ??
    asString(item.detail) ??
    "Kicad review finding requires attention"
  );
}

function normalizeSeverityFromCategory(category: string): number {
  if (category.includes("short") || category.includes("collision") || category.includes("error")) return 9;
  if (category.includes("clearance") || category.includes("overlap") || category.includes("spacing")) return 7;
  if (category.includes("warning") || category.includes("dfm") || category.includes("manufactur")) return 6;
  return 5;
}

export function resolveDiagnosticFamily(category: string, message?: string): string {
  const normalizedCategory = category.trim().toLowerCase();
  const normalizedMessage = (message ?? "").trim().toLowerCase();
  const combined = `${normalizedCategory} ${normalizedMessage}`;

  if (combined.includes("kicad_unconnected_pin") || combined.includes("unconnected pin")) {
    return "kicad_unconnected_pin";
  }
  if (combined.includes("floating_label") || combined.includes("floating label")) {
    return "floating_label";
  }
  if (combined.includes("off_grid") || combined.includes("off-grid") || combined.includes("off grid")) {
    return "off_grid";
  }
  if (combined.includes("kicad_bom_property") || combined.includes("bom")) {
    return "kicad_bom_property";
  }
  if (
    combined.includes("pin_conflict_warning") ||
    combined.includes("pin conflict") ||
    combined.includes("pin_conflict")
  ) {
    return "pin_conflict_warning";
  }
  if (combined.includes("duplicate_reference")) {
    return "duplicate_reference";
  }
  if (combined.includes("compile_error") || combined.includes("compile")) {
    return "compile_error";
  }
  return normalizedCategory || "validation";
}

function makeDiagnosticFromUnknown(raw: UnknownRecord): ValidationDiagnostic {
  const category = normalizeCategory(raw);
  const message = normalizeMessage(raw);
  const family = resolveDiagnosticFamily(category, message);
  return {
    category,
    message,
    severity: typeof raw.severity === "number" ? raw.severity : normalizeSeverityFromCategory(category),
    signature: `${category}|${message.slice(0, 160)}`,
    family,
  };
}

function normalizeFindingsFromSchemaText(schemaText: string): UnknownRecord[] {
  const findings: UnknownRecord[] = [];
  if (!schemaText) return findings;

  const schemaLines = schemaText.split("\n");
  for (const line of schemaLines) {
    const normalized = line.toLowerCase();
    if (
      normalized.includes("warn") ||
      normalized.includes("error") ||
      normalized.includes("unconnected") ||
      normalized.includes("overlap") ||
      normalized.includes("clearance")
    ) {
      findings.push({
        category: normalized.includes("error") ? "kicad_error" : "kicad_warning",
        message: line.trim(),
        severity: normalized.includes("error") ? 9 : 6,
      });
    }
  }

  return findings;
}

function makeDiagnosticFromKicad(
  category: string,
  message: string,
  severity = 6,
): UnknownRecord {
  const family = resolveDiagnosticFamily(category, message);
  return {
    category,
    message,
    severity,
    family,
    ...(severity >= 8 ? { isBlocking: true } : {}),
  };
}

function normalizeErcSeverity(raw: string): number {
  switch (raw.toLowerCase()) {
    case "error":
      return 9;
    case "warning":
      return 7;
    case "info":
      return 4;
    default:
      return 6;
  }
}

function adjustErcSeverityForKnownNonBlocking(
  code: string,
  message: string,
  baseSeverity: number,
): number {
  const upperCode = code.toUpperCase();
  if (upperCode !== "DUPLICATE_REFERENCE") return baseSeverity;

  const normalizedMessage = message.toLowerCase();
  const isPowerSymbolDuplicate =
    /\b(gnd|vcc|vdd|vss|3v3|5v|\+3v3|\+5v)\b/.test(normalizedMessage);
  if (isPowerSymbolDuplicate) return Math.min(baseSeverity, 4);
  return Math.min(baseSeverity, 6);
}

function safePoint(point: unknown): string | null {
  if (!point || typeof point !== "object") return null;
  const p = point as Record<string, unknown>;
  const rawX = p.x;
  const rawY = p.y;
  const x = typeof rawX === "number" ? rawX : typeof rawX === "string" ? Number(rawX) : null;
  const y = typeof rawY === "number" ? rawY : typeof rawY === "string" ? Number(rawY) : null;
  if (!Number.isFinite(x ?? NaN) || !Number.isFinite(y ?? NaN)) return null;
  return `${x},${y}`;
}

function normalizeKicadSchemaFindingsFromAnalyses(
  analysisFindings: UnknownRecord[],
  fallbackPrefix = "kicad_check",
): UnknownRecord[] {
  return analysisFindings
    .filter((item): item is UnknownRecord => item !== null && typeof item === "object")
    .map((item) => {
      const category = asString(item.category) ?? fallbackPrefix;
      const message = asString(item.message) ?? asString(item.code) ?? `${category} issue`;
      const severity = typeof item.severity === "number" ? item.severity : 6;
      return {
        category,
        message,
        severity,
        signature: `${category}|${message.slice(0, 160)}`,
        family: resolveDiagnosticFamily(category, message),
      };
    });
}

function summarizeKicadNets(nets: UnknownRecord[]) {
  const samples: string[] = [];
  for (const net of nets) {
    const name = asString(net.name) ?? "unnamed";
    const wireCount = typeof net.wireCount === "number" ? net.wireCount : 0;
    const pinCount = Array.isArray(net.pins) ? net.pins.length : 0;
    samples.push(`${name}(pins=${pinCount}, wires=${wireCount})`);
  }

  return {
    nets: nets.length,
    unconnectedPins: 0,
    sampledNets: samples.slice(0, 100),
  };
}

interface ConnectivityResult {
  findings: UnknownRecord[];
  metadata: UnknownRecord;
}

function runConnectivityAnalysis(
  schematic: unknown,
  kicadLib: Record<string, unknown>,
): ConnectivityResult {
  const findings: UnknownRecord[] = [];
  const metadata: UnknownRecord = {};

  const ConnectivityAnalyzer = kicadLib.ConnectivityAnalyzer as
    | (new (schematic: unknown, symbolCache?: unknown) => {
        analyzeNets: () => UnknownRecord[];
        findUnconnectedPins: () => UnknownRecord[];
      })
    | undefined;

  if (typeof ConnectivityAnalyzer !== "function") return { findings, metadata };

  const analyzer = new ConnectivityAnalyzer(schematic);
  const nets = analyzer.analyzeNets?.() ?? [];
  const unconnectedPins = analyzer.findUnconnectedPins?.() ?? [];

  const netSummaries = Array.isArray(nets) ? summarizeKicadNets(nets as UnknownRecord[]) : null;
  metadata.connectivity_nets = netSummaries?.nets ?? 0;
  metadata.connectivity_sample_nets = netSummaries?.sampledNets ?? [];

  if (Array.isArray(unconnectedPins) && unconnectedPins.length > 0) {
    for (const pin of unconnectedPins as UnknownRecord[]) {
      const component = asString(pin.reference) ?? "unknown";
      const pinName = asString(pin.pin) ?? "unknown";
      const point = safePoint(pin.position);
      findings.push(
        makeDiagnosticFromKicad(
          "kicad_unconnected_pin",
          `${component} pin ${pinName} is unconnected${point ? ` at ${point}` : ""}`,
          7,
        ),
      );
    }
    metadata.connectivity_unconnected_pins = unconnectedPins.length;
  }

  if (netSummaries) {
    metadata.connectivity_samples = netSummaries.sampledNets;
  }

  return { findings, metadata };
}

interface ErcResult {
  findings: UnknownRecord[];
  metadata: UnknownRecord;
}

function runErcAnalysis(
  schematic: unknown,
  kicadLib: Record<string, unknown>,
): ErcResult {
  const findings: UnknownRecord[] = [];
  const metadata: UnknownRecord = {};

  const ElectricalRulesChecker = kicadLib.ElectricalRulesChecker as
    | (new (schematic: unknown, config?: unknown, symbolCache?: unknown) => {
        check: () => {
          violations: UnknownRecord[];
          passed: boolean;
          errorCount?: number;
          warningCount?: number;
          infoCount?: number;
        };
      })
    | undefined;

  if (typeof ElectricalRulesChecker !== "function") return { findings, metadata };

  const checker = new ElectricalRulesChecker(schematic);
  const result = checker.check?.();
  const violations = Array.isArray(result?.violations)
    ? (result!.violations as UnknownRecord[])
    : [];

  metadata.erc_passed = result?.passed === true;
  metadata.erc_error_count = result?.errorCount;
  metadata.erc_warning_count = result?.warningCount;
  metadata.erc_info_count = result?.infoCount;

  for (const violation of violations) {
    const message = asString(violation.message) ?? "Electrical rule violation";
    const code = asString(violation.code) ?? "kicad_erc_violation";
    const sev = asString(violation.severity) ?? "warning";
    const location = asString((violation.location as Record<string, unknown> | null)?.element)
      ? ` (${asString((violation.location as Record<string, unknown> | null)?.element)})`
      : "";
    const baseSeverity = normalizeErcSeverity(sev);
    const severity = adjustErcSeverityForKnownNonBlocking(
      code,
      message,
      baseSeverity,
    );
    findings.push(
      makeDiagnosticFromKicad(
        code,
        `ERC ${code}: ${message}${location}`,
        severity,
      ),
    );
  }

  return { findings, metadata };
}

interface BomResult {
  findings: UnknownRecord[];
  metadata: UnknownRecord;
}

async function runBomAudit(
  kicadSchema: string,
  kicadLib: Record<string, unknown>,
): Promise<BomResult> {
  const findings: UnknownRecord[] = [];
  const metadata: UnknownRecord = {};

  const BOMPropertyAuditor = kicadLib.BOMPropertyAuditor as
    | (new () => {
        auditSchematic: (
          path: string,
          requiredProperties: string[],
          excludeDnp?: boolean,
        ) => UnknownRecord[];
      })
    | undefined;

  if (typeof BOMPropertyAuditor !== "function") return { findings, metadata };

  const auditor = new BOMPropertyAuditor();
  const tempDir = await mkdtemp(join(tmpdir(), "circuitforge-kicad-audit-"));
  const tempFile = join(tempDir, "circuit.kicad_sch");
  try {
    await writeFile(tempFile, kicadSchema, "utf8");
    const issues = auditor.auditSchematic?.(tempFile, BOM_REQUIRED_PROPERTIES, false) ?? [];
    if (Array.isArray(issues)) {
      for (const issue of issues as UnknownRecord[]) {
        const reference = asString(issue.reference) ?? "unknown";
        const missing = Array.isArray(issue.missingProperties)
          ? issue.missingProperties
              .map((value) => asString(value) ?? String(value))
              .filter(Boolean)
          : [];
        if (missing.length === 0) continue;
        findings.push(
          makeDiagnosticFromKicad(
            "kicad_bom_property",
            `${reference} missing required BOM properties: ${missing.join(", ")}`,
            6,
          ),
        );
      }
      metadata.bom_audit_issues = issues.length;
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  return { findings, metadata };
}

async function runKicadSchemaValidations(
  kicadSchema: string,
): Promise<{
  findings: UnknownRecord[];
  connectivity: UnknownRecord | null;
  traceability: UnknownRecord | null;
  metadata: UnknownRecord;
}> {
  const metadata: UnknownRecord = {
    kicad_schema_validated: false,
    kicad_schema_length: kicadSchema.length,
  };

  try {
    const kicadLib = (await import("kicad-sch-ts")) as Record<string, unknown>;
    const schematicCtor = kicadLib.Schematic as
      | { fromString: (input: string) => unknown }
      | undefined;

    if (typeof schematicCtor?.fromString !== "function") {
      throw new Error("kicad-sch-ts Schematic.fromString not available");
    }

    const schematic = schematicCtor.fromString(kicadSchema);
    if (!schematic || typeof schematic !== "object") {
      throw new Error("kicad-sch-ts did not return a schematic object");
    }

    const schematicRecord = schematic as Record<string, unknown>;
    metadata.kicad_schema_title = asString(schematicRecord.title) ?? "untitled";
    metadata.kicad_schema_uuid = asString(schematicRecord.uuid) ?? "unknown";
    metadata.kicad_schema_component_count = Array.isArray(schematicRecord.components)
      ? schematicRecord.components.length
      : typeof (schematicRecord.components as { length?: unknown })?.length === "number"
        ? (schematicRecord.components as { length: number }).length
        : undefined;

    const [connectivityResult, ercResult, bomResult] = await Promise.all([
      Promise.resolve(runConnectivityAnalysis(schematic, kicadLib)),
      Promise.resolve(runErcAnalysis(schematic, kicadLib)),
      runBomAudit(kicadSchema, kicadLib),
    ]);

    const findings = [
      ...connectivityResult.findings,
      ...ercResult.findings,
      ...bomResult.findings,
    ];

    Object.assign(metadata, connectivityResult.metadata, ercResult.metadata, bomResult.metadata);
    metadata.kicad_schema_validated = true;

    return {
      findings,
      connectivity:
        Object.prototype.hasOwnProperty.call(metadata, "connectivity_nets") ||
        Object.prototype.hasOwnProperty.call(metadata, "connectivity_unconnected_pins")
          ? {
              nets: metadata.connectivity_nets ?? 0,
              unconnectedPins: metadata.connectivity_unconnected_pins ?? 0,
              sampledNets: metadata.connectivity_sample_nets ?? [],
            }
          : null,
      traceability: {
        schematic: {
          title: metadata.kicad_schema_title,
          uuid: metadata.kicad_schema_uuid,
          components: metadata.kicad_schema_component_count,
        },
        kicadSchemaValidated: metadata.kicad_schema_validated,
      },
      metadata,
    };
  } catch (error) {
    const findings = [
      makeDiagnosticFromKicad(
        "kicad_schema_analysis_error",
        `Could not parse and validate kicad_sch: ${error instanceof Error ? error.message : String(error)}`,
        8,
      ),
    ];

    return {
      findings,
      connectivity: null,
      traceability: {
        schematic: {
          title: metadata.kicad_schema_title,
          uuid: metadata.kicad_schema_uuid,
          components: metadata.kicad_schema_component_count,
        },
        kicadSchemaValidated: false,
      },
      metadata,
    };
  }
}

function summarizeConnectivity(circuitJson: unknown[]) {
  let components = 0;
  let traces = 0;
  const nets = new Set<string>();
  const pins = new Set<string>();

  for (const row of circuitJson) {
    if (!row || typeof row !== "object") continue;
    const entry = row as UnknownRecord;
    const type = asString(entry.type) ?? "";
    if (!type) continue;

    if (type.includes("component") || type.includes("chip") || type.includes("resistor") || type.includes("capacitor")) {
      components += 1;
    }
    if (type.includes("trace")) traces += 1;
    if (typeof entry.net === "string" && entry.net.trim()) nets.add(entry.net.trim());

    if (typeof entry.name === "string" && entry.name.trim()) {
      pins.add(entry.name.trim());
    }
  }

  return {
    components,
    traces,
    netCount: nets.size,
    sampledNets: Array.from(nets).slice(0, 80),
    componentNameSamples: Array.from(pins).slice(0, 120),
  };
}

function summarizeTraceability(circuitJson: unknown[]) {
  const map: Record<string, string[]> = {};
  for (const row of circuitJson) {
    if (!row || typeof row !== "object") continue;
    const entry = row as UnknownRecord;
    const type = asString(entry.type) ?? "unknown";
    const name = asString(entry.name) ?? asString(entry.id);
    if (!name) continue;
    if (!Array.isArray(map[type])) map[type] = [];
    map[type].push(name);
  }

  return map;
}

export function assessKicadFindingsFromRaw(rawFindings: unknown[]): ValidationDiagnostic[] {
  if (!Array.isArray(rawFindings)) return [];
  const normalized = rawFindings
    .filter((item): item is UnknownRecord => item !== null && typeof item === "object")
    .map((item) => makeDiagnosticFromUnknown(item))
    .concat(
      rawFindings.filter((item) => typeof item === "string").map((line) => ({
        category: "kicad_finding",
        message: line,
        severity: 6,
        signature: `kicad_finding|${line.slice(0, 160)}`,
        family: resolveDiagnosticFamily("kicad_finding", line),
      }))
    );

  const deduped = new Map<string, ValidationDiagnostic>();
  for (const diagnostic of normalized) {
    const key = diagnostic.signature || `${diagnostic.category}|${diagnostic.message.slice(0, 160)}`;
    const prior = deduped.get(key);
    if (!prior || diagnostic.severity > prior.severity) {
      deduped.set(key, diagnostic);
    }
  }
  return Array.from(deduped.values());
}

export async function assessKicadFindings(circuitJson: unknown[]): Promise<KicadValidationResult> {
  const metadata: Record<string, unknown> = {
    source: "kicad-review",
    generatedAt: Date.now(),
    inputEntries: circuitJson.length,
  };

  const conversion = await convertTscircuitCircuitJsonToKicadSchema(circuitJson);
  const findings: unknown[] = [];
  const diagnostics: ValidationDiagnostic[] = [];

  if (!conversion.ok && Array.isArray(conversion.diagnostics) && conversion.diagnostics.length > 0) {
    diagnostics.push(...conversion.diagnostics);
    findings.push(...conversion.diagnostics);
  }

  if (conversion.kicadSchema) {
    const schemaText = conversion.kicadSchema;
    findings.push(...normalizeFindingsFromSchemaText(schemaText));

    const kicadAnalysis = await runKicadSchemaValidations(schemaText);
    findings.push(...normalizeKicadSchemaFindingsFromAnalyses(kicadAnalysis.findings, "kicad_schema"));

    if (kicadAnalysis.connectivity) {
      metadata.kicadConnectivity = kicadAnalysis.connectivity;
    }
    metadata.kicadAnalysis = kicadAnalysis.metadata;
    if (kicadAnalysis.traceability) {
      metadata.kicadTraceability = kicadAnalysis.traceability;
    }
  } else {
    findings.push({
      category: "kicad_schema_missing",
      message: "Kicad schema generation returned no schematic text",
      severity: 8,
      signature: "kicad_schema_missing",
    });
  }

  const normalized = assessKicadFindingsFromRaw(findings);
  return {
    ok: conversion.ok,
    findings: normalized,
    diagnostics,
    connectivity: metadata.kicadConnectivity ?? summarizeConnectivity(circuitJson),
    traceability: metadata.kicadTraceability ?? summarizeTraceability(circuitJson),
    kicadSchema: conversion.kicadSchema,
    metadata: {
      ...metadata,
      conversionOk: conversion.ok,
      conversionMetadata: conversion.metadata,
    },
  };
}

export interface KicadSchemaEdit {
  tool: "manage_component" | "manage_wire";
  args: UnknownRecord;
}

export interface KicadSchemaEditResult {
  ok: boolean;
  kicadSchema?: string;
  operations?: UnknownRecord[];
  error?: string;
}

type KicadMcpToolsModule = {
  setCurrentSchematic: (schematic: unknown) => void;
  getCurrentSchematic: () => unknown;
  handleManageComponent: (args: UnknownRecord) => Promise<UnknownRecord>;
  handleManageWire: (args: UnknownRecord) => Promise<UnknownRecord>;
};

interface KicadComponentCatalogEntry {
  reference?: string;
  libId?: string;
  value?: string;
  position?: UnknownRecord | { x?: unknown; y?: unknown };
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function asNullablePosition(input: unknown): { x: number; y: number } | null {
  if (!input || typeof input !== "object") return null;
  const point = input as Record<string, unknown>;
  const x = asNumber(point.x);
  const y = asNumber(point.y);
  if (x === null || y === null) return null;
  return { x, y };
}

function isPlaceholderReference(reference: string | null | undefined): boolean {
  if (!reference) return true;
  return (
    reference.startsWith("__") ||
    reference.startsWith("AUTO_") ||
    !/^[A-Z]{1,3}\d+[A-Z]?$/.test(reference)
  );
}

function inferComponentPrefix(args: UnknownRecord): string {
  const libId = asString(args.lib_id) ?? "";
  const upperLibId = libId.toUpperCase();

  if (upperLibId.endsWith(":R") || upperLibId.includes("RESISTOR")) return "R";
  if (upperLibId.endsWith(":C") || upperLibId.includes("CAPACITOR")) return "C";
  if (upperLibId.endsWith(":L") || upperLibId.includes("INDUCTOR")) return "L";
  if (upperLibId.includes("LED") || upperLibId.endsWith(":D") || upperLibId.includes("DIODE")) return "D";
  if (upperLibId.endsWith(":Q") || upperLibId.includes("TRANSISTOR")) return "Q";
  return "C";
}

function inferDefaultLibId(args: UnknownRecord): string {
  const prefix = inferComponentPrefix(args);
  return ({
    R: "Device:R",
    C: "Device:C",
    L: "Device:L",
    D: "Device:D",
    Q: "Device:Q",
  })[prefix] ?? "Device:C";
}

function inferDefaultValue(args: UnknownRecord): string {
  if (asString(args.value)) return asString(args.value)!;

  const prefix = inferComponentPrefix(args);
  return ({
    C: "100nF",
    R: "10k",
    L: "10uH",
    D: "1N4148",
    Q: "Q_NMOS_GSD",
  })[prefix] ?? "1";
}

function inferDefaultFootprint(args: UnknownRecord): string {
  const prefix = inferComponentPrefix(args);
  return ({
    C: "0805",
    R: "0805",
    L: "0805",
    D: "sod-123",
    Q: "soic8",
  })[prefix] ?? "0805";
}

function inferNextReference(prefix: string, catalog: KicadComponentCatalogEntry[]): string {
  const targetPrefix = prefix.toUpperCase();
  let nextIndex = 1;

  for (const entry of catalog) {
    const reference = asString(entry.reference)?.toUpperCase();
    if (!reference) continue;
    const match = /^([A-Z]{1,3})(\d+)[A-Z]?$/.exec(reference);
    if (!match || match[1] !== targetPrefix) continue;
    const candidate = Number.parseInt(match[2], 10);
    if (Number.isFinite(candidate) && candidate >= nextIndex) {
      nextIndex = candidate + 1;
    }
  }

  return `${targetPrefix}${nextIndex}`;
}

function pickComponentByReference(
  catalog: KicadComponentCatalogEntry[],
  reference: string,
): KicadComponentCatalogEntry | null {
  const needle = reference.toUpperCase();
  return (
    catalog.find((entry) => asString(entry.reference)?.toUpperCase() === needle) ?? null
  );
}

function referencePosition(
  catalog: KicadComponentCatalogEntry[],
  reference: string | null | undefined,
): { x: number; y: number } | null {
  if (!reference) return null;
  const component = pickComponentByReference(catalog, reference.toUpperCase());
  return asNullablePosition(component?.position) ?? null;
}

function resolveWireEndpointsFromEdit(
  editArgs: UnknownRecord,
  catalog: KicadComponentCatalogEntry[],
) {
  const parsed = {
    action: asString(editArgs.action) ?? "add",
    start: asNullablePosition(editArgs.start),
    end: asNullablePosition(editArgs.end),
  };

  if (parsed.start && parsed.end) return parsed;

  const fromReference = asString(editArgs.fromReference)?.toUpperCase();
  const toReference = asString(editArgs.toReference)?.toUpperCase();

  const fromPos = parsed.start ?? referencePosition(catalog, fromReference);
  const toPos = parsed.end ?? referencePosition(catalog, toReference);

  if (!fromPos && !toPos) return parsed;

  const start = parsed.start ?? fromPos ?? (toPos ? { x: toPos.x + 10, y: toPos.y } : null);
  const end = parsed.end ?? toPos ?? (fromPos ? { x: fromPos.x, y: fromPos.y + 10 } : null);

  return {
    ...parsed,
    start: start,
    end: end,
  };
}

async function loadComponentCatalog(
  listHandler: (args: UnknownRecord) => Promise<UnknownRecord>,
): Promise<KicadComponentCatalogEntry[]> {
  const result = await listHandler({ action: "list" });
  const record =
    result && typeof result === "object" ? (result as Record<string, unknown>) : null;
  const rows = record && Array.isArray(record.components) ? record.components : [];

  return rows
    .map((row) => (row && typeof row === "object" ? (row as KicadComponentCatalogEntry) : null))
    .filter((item): item is KicadComponentCatalogEntry => !!item);
}

function sanitizePositionOffset(input: unknown): { x: number; y: number } {
  const parsed = asNullablePosition(input);
  return parsed ? { x: parsed.x, y: parsed.y } : { x: 8, y: 0 };
}

function sanitizeToolArgs(args: UnknownRecord): UnknownRecord {
  const cleaned: UnknownRecord = {};
  for (const [key, value] of Object.entries(args)) {
    if (
      key === "nearReference" ||
      key === "relativeOffset" ||
      key === "proposedReference" ||
      key === "addHint" ||
      key === "sourceReference"
    ) {
      continue;
    }
    cleaned[key] = value;
  }
  return cleaned;
}

export async function applyKicadMcpEdits(
  kicadSchema: string,
  edits: KicadSchemaEdit[],
): Promise<KicadSchemaEditResult> {
  if (!kicadSchema.trim()) {
    return {
      ok: false,
      error: "No kicad_sch text provided",
    };
  }

  if (!Array.isArray(edits) || edits.length === 0) {
    return { ok: false, error: "No edit operations provided" };
  }

  try {
    const kicadLib = (await import("kicad-sch-ts")) as {
      Schematic?: { fromString: (input: string) => unknown };
    };
    const tools = (await import("kicad-sch-ts/dist/adapters/mcp/tools/index")) as KicadMcpToolsModule;

    if (typeof kicadLib.Schematic?.fromString !== "function") {
      return {
        ok: false,
        error: "kicad-sch-ts Schematic API is not available for MCP editing",
      };
    }

    if (!tools.handleManageComponent || !tools.handleManageWire) {
      return {
        ok: false,
        error: "kicad-sch-ts MCP tools are not available",
      };
    }

    const schematic = kicadLib.Schematic.fromString(kicadSchema);
    tools.setCurrentSchematic(schematic);

    let componentCatalog = await loadComponentCatalog(tools.handleManageComponent);

    const operations: UnknownRecord[] = [];
    for (const edit of edits) {
      if (edit.tool === "manage_component") {
        const action = asString(edit.args?.action) ?? "";
        if (action === "add") {
          const args: UnknownRecord = { ...edit.args };
          if (!args.lib_id) args.lib_id = inferDefaultLibId(args);
          if (!args.footprint) args.footprint = inferDefaultFootprint(args);
          if (!args.value) args.value = inferDefaultValue(args);

          const prefix = inferComponentPrefix(args);
          const requestedReference = asString(args.reference);
          if (isPlaceholderReference(requestedReference)) {
            args.reference = inferNextReference(prefix, componentCatalog);
          }

          const rawPosition = asNullablePosition(args.position);
          const nearReference = asString(args.nearReference)?.toUpperCase();
          const referenceBase = nearReference ? pickComponentByReference(componentCatalog, nearReference) : null;
          const basePosition = asNullablePosition(referenceBase?.position) ?? null;
          const offset = sanitizePositionOffset((args as UnknownRecord).relativeOffset);

          if (rawPosition) {
            args.position = { x: rawPosition.x, y: rawPosition.y };
          } else if (basePosition) {
            args.position = {
              x: basePosition.x + offset.x,
              y: basePosition.y + offset.y,
            };
          } else if (componentCatalog.length > 0) {
            const fallback = asNullablePosition(componentCatalog[0].position) ?? { x: 0, y: 0 };
            args.position = {
              x: fallback.x + 20,
              y: fallback.y + 20,
            };
          } else {
            args.position = { x: 20, y: 20 };
          }

          const normalizedArgs = sanitizeToolArgs(args);
          operations.push(await tools.handleManageComponent(normalizedArgs));
          componentCatalog = await loadComponentCatalog(tools.handleManageComponent);
          continue;
        }

        operations.push(await tools.handleManageComponent(sanitizeToolArgs(edit.args)));
        componentCatalog = await loadComponentCatalog(tools.handleManageComponent);
      } else if (edit.tool === "manage_wire") {
        const resolved = resolveWireEndpointsFromEdit(edit.args, componentCatalog);
        if (!resolved.start || !resolved.end) {
          return {
            ok: false,
            error: `Unable to apply wire edit: missing wire endpoints for ${JSON.stringify(
              edit.args,
            )}`,
          };
        }

        operations.push(
          await tools.handleManageWire({
            action: resolved.action,
            start: resolved.start,
            end: resolved.end,
          }),
        );
      } else {
        return {
          ok: false,
          error: `Unsupported MCP tool: ${edit.tool}`,
        };
      }
    }

    const finalSchematic = tools.getCurrentSchematic();
    const formatter = (finalSchematic as Record<string, unknown>).format;
    if (typeof formatter !== "function") {
      return {
        ok: false,
        error: "MCP pipeline did not return a schematic object",
      };
    }

    const nextSchema = formatter.call(finalSchematic);
    if (typeof nextSchema !== "string" || !nextSchema.trim()) {
      return {
        ok: false,
        error: "Updated schematic could not be serialized",
      };
    }

    return {
      ok: true,
      kicadSchema: nextSchema,
      operations,
    };
  } catch (error) {
    return {
      ok: false,
      error: `Unable to apply MCP edits: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
