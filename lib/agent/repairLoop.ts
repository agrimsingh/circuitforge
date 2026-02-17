import type { ValidationDiagnostic } from "@/lib/stream/types";
import {
  type KicadValidationResult,
  assessKicadFindings,
  assessKicadFindingsFromRaw,
  resolveDiagnosticFamily,
} from "@/lib/kicad/review";
import { compileWithFallback } from "@/lib/compile/local";
import {
  buildTraceRebuildResultFromNetIntent,
  collectConnectivityPreflightDiagnostics,
} from "@/lib/agent/connectivityPreflight";

interface KicadDiagnostics {
  findings: ValidationDiagnostic[];
  connectivity?: unknown;
  traceability?: unknown;
}

export interface SourceCodeGuardrailResult {
  code: string;
  actions: string[];
}

export type RepairStrategy =
  | "normal"
  | "structural_trace_rebuild"
  | "structural_layout_spread"
  | "targeted_congestion_relief";

const PREFLIGHT_FOOTPRINT_COMPONENTS = new Set([
  "chip",
  "resistor",
  "capacitor",
  "inductor",
  "fuse",
  "diode",
  "led",
  "transistor",
  "mosfet",
  "crystal",
  "pinheader",
]);

const PREFLIGHT_ALLOWED_FOOTPRINTS = new Set([
  "0402",
  "0603",
  "0805",
  "1206",
  "1210",
  "soic8",
  "soic16",
  "qfp16",
  "qfp32",
  "qfp48",
  "qfn16",
  "qfn20",
  "tssop8",
  "tssop16",
  "ssop",
  "sot23",
  "sot23_5",
  "sot223",
  "to92",
  "to220",
  "dip8",
  "dip16",
  "axial",
  "hc49",
  "pinrow2",
  "pinrow4",
  "pinrow6",
  "pinrow8",
  "stampboard",
  "bga64",
  "bga256",
]);

export interface CompileResult {
  ok: boolean;
  source: string;
  circuitJson: unknown[] | null;
  errorMessage: string | null;
}

function preflightDiagnostic(
  category: string,
  message: string,
  signature: string,
  severity = 9,
): ValidationDiagnostic {
  return {
    category,
    message,
    severity,
    signature,
    source: "tscircuit",
    family: resolveDiagnosticFamily(category, message),
  };
}

function isLikelyValidFootprint(footprint: string): boolean {
  const value = footprint.trim().toLowerCase();
  if (!value) return false;
  if (PREFLIGHT_ALLOWED_FOOTPRINTS.has(value)) return true;
  if (/^(soic|qfp|qfn|tssop|sot|to|dip|pinrow|stampboard|bga)\d+[a-z0-9_.-]*$/.test(value)) {
    return true;
  }
  return false;
}

function parseAttr(attrs: string, key: string): string | null {
  const match = new RegExp(`\\b${key}="([^"]+)"`, "i").exec(attrs);
  return match?.[1]?.trim() ?? null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isValidNetName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

function normalizeNetName(name: string): string {
  const cleaned = name.trim().replace(/[^A-Za-z0-9_]/g, "_");
  const withPrefix = cleaned.length === 0 ? "NET" : cleaned;
  if (/^[A-Za-z_]/.test(withPrefix)) return withPrefix;
  return `V${withPrefix}`;
}

function isValidTraceEndpoint(endpoint: string): boolean {
  if (endpoint.startsWith("net.")) return true;
  if (!endpoint.startsWith(".")) return false;
  return endpoint.includes(" > .");
}

export function applySourceCodeGuardrails(code: string): SourceCodeGuardrailResult {
  if (!code.trim()) {
    return { code, actions: [] };
  }

  let nextCode = code;
  const actions: string[] = [];
  const renamedNets = new Map<string, string>();

  nextCode = nextCode.replace(/<net\b([^>]*)>/g, (fullTag) => {
    const nameMatch = /\bname="([^"]+)"/i.exec(fullTag);
    if (!nameMatch?.[1]) return fullTag;
    const originalName = nameMatch[1].trim();
    if (isValidNetName(originalName)) return fullTag;

    const normalizedName = normalizeNetName(originalName);
    renamedNets.set(originalName, normalizedName);
    actions.push(`normalize_net_name:${originalName}->${normalizedName}`);
    return fullTag.replace(
      /\bname="([^"]+)"/i,
      `name="${normalizedName}"`,
    );
  });

  for (const [from, to] of renamedNets.entries()) {
    const netRefRegex = new RegExp(`net\\.${escapeRegExp(from)}(?=[^A-Za-z0-9_]|$)`, "g");
    nextCode = nextCode.replace(netRefRegex, `net.${to}`);
  }

  let dedupedNetDeclarationCount = 0;
  const seenNetDeclarations = new Set<string>();
  const dedupedNetLines = nextCode.split("\n").filter((line) => {
    if (!line.includes("<net")) return true;
    const netName = parseAttr(line, "name");
    if (!netName) return true;
    const normalized = netName.trim();
    if (!normalized) return true;
    if (seenNetDeclarations.has(normalized)) {
      dedupedNetDeclarationCount += 1;
      return false;
    }
    seenNetDeclarations.add(normalized);
    return true;
  });
  nextCode = dedupedNetLines.join("\n");
  if (dedupedNetDeclarationCount > 0) {
    actions.push(`dedupe_net_declaration:${dedupedNetDeclarationCount}`);
  }

  let removedMalformedTraceCount = 0;
  const normalizedLines = nextCode.split("\n").filter((line) => {
    if (!line.includes("<trace")) return true;
    if (!line.includes("/>")) return true;
    const from = parseAttr(line, "from");
    const to = parseAttr(line, "to");
    if (!from || !to) {
      removedMalformedTraceCount += 1;
      return false;
    }
    if (!isValidTraceEndpoint(from) || !isValidTraceEndpoint(to)) {
      removedMalformedTraceCount += 1;
      return false;
    }
    return true;
  });
  nextCode = normalizedLines.join("\n");
  if (removedMalformedTraceCount > 0) {
    actions.push(`remove_malformed_trace:${removedMalformedTraceCount}`);
  }

  return { code: nextCode, actions: Array.from(new Set(actions)) };
}

export function collectPreValidationDiagnostics(code: string): ValidationDiagnostic[] {
  const diagnostics: ValidationDiagnostic[] = [];
  if (!code.trim()) return diagnostics;

  const componentRegex = /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)\/?>/g;
  let componentMatch: RegExpExecArray | null;
  while ((componentMatch = componentRegex.exec(code)) !== null) {
    const tag = (componentMatch[1] ?? "").toLowerCase();
    const attrs = componentMatch[2] ?? "";
    const name = parseAttr(attrs, "name") ?? `${tag}@${componentMatch.index}`;
    const footprint = parseAttr(attrs, "footprint");

    if (PREFLIGHT_FOOTPRINT_COMPONENTS.has(tag) && !footprint) {
      diagnostics.push(
        preflightDiagnostic(
          "pcb_missing_footprint_error",
          `${name} (${tag}) is missing a footprint.`,
          `preflight|pcb_missing_footprint_error|${name}`,
        ),
      );
    }

    if (footprint && !isLikelyValidFootprint(footprint)) {
      diagnostics.push(
        preflightDiagnostic(
          "pcb_missing_footprint_error",
          `${name} uses invalid footprint "${footprint}".`,
          `preflight|pcb_missing_footprint_error|${name}|${footprint}`,
        ),
      );
    }

    if (tag === "chip" && !/\bpinLabels=\{/.test(attrs)) {
      diagnostics.push(
        preflightDiagnostic(
          "source_failed_to_create_component_error",
          `${name} is missing pinLabels mapping, which can break component/pin binding.`,
          `preflight|source_failed_to_create_component_error|${name}`,
        ),
      );
    }

    if (tag === "net") {
      const netName = parseAttr(attrs, "name");
      if (netName && !isValidNetName(netName)) {
        diagnostics.push(
          preflightDiagnostic(
            "source_invalid_net_name_error",
            `Net name "${netName}" is invalid. Net names must start with a letter or underscore.`,
            `preflight|source_invalid_net_name_error|${netName}`,
          ),
        );
      }
    }
  }

  return diagnostics;
}

function ensureBoardTag(code: string): string {
  const boardRegex = /<board\b([^>]*)>/i;
  const match = boardRegex.exec(code);
  if (!match) return code;
  return code;
}

function formatNumeric(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function spreadCoordinateAttrs(code: string, attr: "pcbX" | "pcbY", multiplier: number): string {
  const regex = new RegExp(`\\b${attr}="(-?\\d+(?:\\.\\d+)?)mm"`, "g");
  return code.replace(regex, (_full, raw) => {
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value)) return _full;
    const next = Number(formatNumeric(value * multiplier));
    return `${attr}="${next}mm"`;
  });
}

export interface TargetedCongestionReliefOptions {
  boardScale?: number;
  maxBoardGrowthPct?: number;
  componentShiftMm?: number;
  componentShiftCapMm?: number;
}

export function applyTargetedCongestionRelief(
  code: string,
  options?: TargetedCongestionReliefOptions,
): SourceCodeGuardrailResult {
  let nextCode = ensureBoardTag(code);
  const actions: string[] = [];

  const boardGrowthCapPct = Math.max(0, options?.maxBoardGrowthPct ?? 20);
  const boardScaleLimit = 1 + boardGrowthCapPct / 100;
  const requestedBoardScale = options?.boardScale ?? boardScaleLimit;
  const cappedBoardScale = Math.min(boardScaleLimit, Math.max(1, requestedBoardScale));
  const componentShiftCapMm = Math.max(0, options?.componentShiftCapMm ?? 3);
  const requestedShiftMm = Math.max(0, options?.componentShiftMm ?? componentShiftCapMm);
  const appliedShiftMm = Math.min(componentShiftCapMm, requestedShiftMm);

  nextCode = nextCode.replace(
    /<board\b([^>]*)>/i,
    (fullTag, attrs: string) => {
      let updated = fullTag;
      const widthMatch = /\bwidth="(\d+(?:\.\d+)?)mm"/i.exec(attrs);
      const heightMatch = /\bheight="(\d+(?:\.\d+)?)mm"/i.exec(attrs);

      if (widthMatch) {
        const current = Number.parseFloat(widthMatch[1]);
        const next = Number(formatNumeric(current * cappedBoardScale));
        updated = updated.replace(widthMatch[0], `width="${next}mm"`);
      }
      if (heightMatch) {
        const current = Number.parseFloat(heightMatch[1]);
        const next = Number(formatNumeric(current * cappedBoardScale));
        updated = updated.replace(heightMatch[0], `height="${next}mm"`);
      }

      return updated;
    },
  );

  let coordinateSeed = 0;
  let componentsAdjusted = 0;
  nextCode = nextCode.replace(
    /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g,
    (fullTag, tagName: string, attrs: string) => {
      const normalizedTag = tagName.toLowerCase();
      if (normalizedTag === "board" || normalizedTag === "trace" || normalizedTag === "net") {
        return fullTag;
      }
      if (!/\bpcb[XY]="-?\d+(?:\.\d+)?mm"/.test(attrs)) return fullTag;

      let changed = false;
      let nextTag = fullTag;
      const localSeed = coordinateSeed++;

      nextTag = nextTag.replace(
        /\bpcbX="(-?\d+(?:\.\d+)?)mm"/,
        (_full, raw) => {
          const value = Number.parseFloat(raw);
          if (!Number.isFinite(value)) return _full;
          const direction = value === 0 ? (localSeed % 2 === 0 ? 1 : -1) : Math.sign(value);
          const nextValue = Number(formatNumeric(value + direction * appliedShiftMm));
          changed = true;
          return `pcbX="${nextValue}mm"`;
        },
      );

      nextTag = nextTag.replace(
        /\bpcbY="(-?\d+(?:\.\d+)?)mm"/,
        (_full, raw) => {
          const value = Number.parseFloat(raw);
          if (!Number.isFinite(value)) return _full;
          const direction = value === 0 ? (localSeed % 2 === 0 ? -1 : 1) : Math.sign(value);
          const nextValue = Number(formatNumeric(value + direction * appliedShiftMm));
          changed = true;
          return `pcbY="${nextValue}mm"`;
        },
      );

      if (changed) {
        componentsAdjusted += 1;
      }
      return nextTag;
    },
  );

  actions.push(`congestion_relief:board_scale_${formatNumeric(cappedBoardScale)}`);
  actions.push(`congestion_relief:max_move_mm_${formatNumeric(componentShiftCapMm)}`);
  actions.push(`congestion_relief:components_adjusted_${componentsAdjusted}`);

  return { code: nextCode, actions };
}

export function applyStructuralLayoutSpread(code: string): SourceCodeGuardrailResult {
  let nextCode = ensureBoardTag(code);
  const actions: string[] = [];

  nextCode = nextCode.replace(
    /<board\b([^>]*)>/i,
    (fullTag, attrs: string) => {
      let updated = fullTag;
      const widthMatch = /\bwidth="(\d+(?:\.\d+)?)mm"/i.exec(attrs);
      const heightMatch = /\bheight="(\d+(?:\.\d+)?)mm"/i.exec(attrs);

      if (widthMatch) {
        const current = Number.parseFloat(widthMatch[1]);
        const next = Number(formatNumeric(current * 1.2));
        updated = updated.replace(widthMatch[0], `width="${next}mm"`);
      }
      if (heightMatch) {
        const current = Number.parseFloat(heightMatch[1]);
        const next = Number(formatNumeric(current * 1.2));
        updated = updated.replace(heightMatch[0], `height="${next}mm"`);
      }

      return updated;
    },
  );

  nextCode = spreadCoordinateAttrs(nextCode, "pcbX", 1.2);
  nextCode = spreadCoordinateAttrs(nextCode, "pcbY", 1.2);
  actions.push("layout_spread:board_scale_1.2");
  actions.push("layout_spread:component_pcb_coordinates_1.2");
  return { code: nextCode, actions };
}

export function applyStructuralTraceRebuild(code: string): {
  code: string;
  actions: string[];
  diagnostics: ValidationDiagnostic[];
} {
  const plan = buildTraceRebuildResultFromNetIntent(code);
  if (!plan.traces.length) {
    return {
      code,
      actions: [],
      diagnostics: [
        preflightDiagnostic(
          "source_trace_rebuild_insufficient_intent",
          "Unable to rebuild traces from net intent; no valid net-linked pin intents were found.",
          `preflight|source_trace_rebuild_insufficient_intent|${plan.reason ?? "unknown"}`,
        ),
      ],
    };
  }

  const lines = code
    .split("\n")
    .filter((line) => {
      if (!line.includes("<trace")) return true;
      if (!line.includes("/>")) return true;
      return false;
    });

  const boardCloseIndex = lines.findIndex((line) => line.includes("</board>"));
  if (boardCloseIndex === -1) {
    return {
      code,
      actions: [],
      diagnostics: [
        preflightDiagnostic(
          "source_trace_rebuild_insufficient_intent",
          "Unable to rebuild traces because board container was not found.",
          "preflight|source_trace_rebuild_insufficient_intent|missing_board",
        ),
      ],
    };
  }

  const indentedTraces = plan.traces.map((trace) => `    ${trace}`);
  const rebuilt = [
    ...lines.slice(0, boardCloseIndex),
    ...indentedTraces,
    ...lines.slice(boardCloseIndex),
  ].join("\n");

  return {
    code: rebuilt,
    actions: [`rebuild_traces:${plan.traces.length}`],
    diagnostics: [],
  };
}

/**
 * Compile tscircuit code for validation. Uses local @tscircuit/eval first,
 * falls back to remote compile.tscircuit.com API.
 */
export async function compileForValidation(code: string, signal?: AbortSignal): Promise<CompileResult> {
  const guarded = applySourceCodeGuardrails(code);
  const result = await compileWithFallback({ "main.tsx": guarded.code }, signal);
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
    category.includes("trace") ||
    category.includes("via") ||
    category.includes("clearance") ||
    category.includes("out_of_bounds")
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
  const sourceComponentNames = new Map<string, string>();
  const pcbComponents: Array<{
    id: string;
    sourceComponentId: string | null;
    center: { x: number; y: number } | null;
    width: number | null;
    height: number | null;
  }> = [];
  let board: { center: { x: number; y: number }; width: number; height: number } | null = null;

  for (const item of circuitJson) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const type = typeof entry.type === "string" ? entry.type : "";

    if (type === "source_component") {
      const sourceComponentId =
        typeof entry.source_component_id === "string" ? entry.source_component_id : null;
      const sourceName = typeof entry.name === "string" ? entry.name : null;
      if (sourceComponentId && sourceName) {
        sourceComponentNames.set(sourceComponentId, sourceName);
      }
    }

    if (type === "pcb_board") {
      const width = typeof entry.width === "number" ? entry.width : null;
      const height = typeof entry.height === "number" ? entry.height : null;
      const centerCandidate =
        entry.center && typeof entry.center === "object"
          ? (entry.center as Record<string, unknown>)
          : null;
      const centerX = centerCandidate && typeof centerCandidate.x === "number" ? centerCandidate.x : 0;
      const centerY = centerCandidate && typeof centerCandidate.y === "number" ? centerCandidate.y : 0;
      if (width && height) {
        board = {
          center: { x: centerX, y: centerY },
          width,
          height,
        };
      }
    }

    if (type === "pcb_component") {
      const pcbComponentId =
        typeof entry.pcb_component_id === "string" ? entry.pcb_component_id : "unknown_pcb_component";
      const sourceComponentId =
        typeof entry.source_component_id === "string" ? entry.source_component_id : null;
      const centerCandidate =
        entry.center && typeof entry.center === "object"
          ? (entry.center as Record<string, unknown>)
          : null;
      const center =
        centerCandidate &&
        typeof centerCandidate.x === "number" &&
        typeof centerCandidate.y === "number"
          ? { x: centerCandidate.x, y: centerCandidate.y }
          : null;
      const width = typeof entry.width === "number" ? entry.width : null;
      const height = typeof entry.height === "number" ? entry.height : null;
      pcbComponents.push({
        id: pcbComponentId,
        sourceComponentId,
        center,
        width,
        height,
      });
    }

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

  if (board) {
    const boardHalfWidth = board.width / 2;
    const boardHalfHeight = board.height / 2;
    const boardMinX = board.center.x - boardHalfWidth;
    const boardMaxX = board.center.x + boardHalfWidth;
    const boardMinY = board.center.y - boardHalfHeight;
    const boardMaxY = board.center.y + boardHalfHeight;
    const epsilon = 0.0001;

    for (const component of pcbComponents) {
      if (!component.center) continue;
      const halfWidth = component.width ? component.width / 2 : 0;
      const halfHeight = component.height ? component.height / 2 : 0;
      const compMinX = component.center.x - halfWidth;
      const compMaxX = component.center.x + halfWidth;
      const compMinY = component.center.y - halfHeight;
      const compMaxY = component.center.y + halfHeight;

      if (
        compMinX >= boardMinX - epsilon &&
        compMaxX <= boardMaxX + epsilon &&
        compMinY >= boardMinY - epsilon &&
        compMaxY <= boardMaxY + epsilon
      ) {
        continue;
      }

      const sourceName =
        (component.sourceComponentId ? sourceComponentNames.get(component.sourceComponentId) : null) ??
        component.id;
      const message = `${sourceName} (${component.id}) extends outside board boundary ${board.width.toFixed(
        2
      )}mm x ${board.height.toFixed(2)}mm centered at (${board.center.x.toFixed(2)}, ${board.center.y.toFixed(
        2
      )}).`;
      diagnostics.push({
        category: "pcb_component_out_of_bounds_error",
        message,
        severity: 9,
        signature: `pcb_component_out_of_bounds_error|${component.id}|${component.center.x.toFixed(
          2
        )},${component.center.y.toFixed(2)}`,
        source: "tscircuit",
        family: resolveDiagnosticFamily("pcb_component_out_of_bounds_error", message),
      });
    }
  }

  return diagnostics;
}

export function createCompileFailureDiagnostics(errorMessage: string): ValidationDiagnostic[] {
  const message = errorMessage.trim() || "Compilation failed with unknown error";
  const normalized = message.toLowerCase();
  const isAutorouterExhaustion =
    normalized.includes("all solvers failed") ||
    normalized.includes("ran out of candidates") ||
    normalized.includes("capacity-autorouter") ||
    normalized.includes("capacity-mesh-autorouting");
  const category = isAutorouterExhaustion ? "pcb_autorouter_exhaustion" : "compile_error";

  return [
    {
      category,
      message,
      severity: 10,
      signature: `${category}|${message.slice(0, 300)}`,
      source: "tscircuit",
      family: resolveDiagnosticFamily(category, message),
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
  options?: {
    enableConnectivityPreflight?: boolean;
  },
): Promise<{
  compileResult: CompileResult;
  kicadResult: KicadValidationResult | null;
  allDiagnostics: ValidationDiagnostic[];
}> {
  const guarded = applySourceCodeGuardrails(code);
  const preflightDiagnostics = collectPreValidationDiagnostics(guarded.code);
  const connectivityDiagnostics =
    options?.enableConnectivityPreflight === false
      ? []
      : collectConnectivityPreflightDiagnostics(guarded.code);
  const combinedPreflight = [...preflightDiagnostics, ...connectivityDiagnostics];
  if (combinedPreflight.length > 0) {
    return {
      compileResult: {
        ok: false,
        source: "preflight",
        circuitJson: null,
        errorMessage: "Pre-validation checks failed",
      },
      kicadResult: null,
      allDiagnostics: combinedPreflight,
    };
  }

  const compileResult = await compileForValidation(guarded.code, signal);
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
