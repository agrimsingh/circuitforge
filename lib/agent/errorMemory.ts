import type { ValidationDiagnostic } from "@/lib/stream/types";

const MAX_SAMPLES = 100;
const GLOBAL_KEY = "__circuitforge_error_memory_v1";

interface ErrorMemorySample {
  categories: string[];
  createdAt: number;
}

interface ErrorMemoryState {
  samples: ErrorMemorySample[];
}

export interface ErrorMemoryStats {
  sampleCount: number;
  categoryCounts: Record<string, number>;
  topCategories: Array<{ category: string; count: number }>;
}

function getState(): ErrorMemoryState {
  const globalRecord = globalThis as unknown as Record<string, unknown>;
  if (!globalRecord[GLOBAL_KEY]) {
    globalRecord[GLOBAL_KEY] = { samples: [] } satisfies ErrorMemoryState;
  }
  return globalRecord[GLOBAL_KEY] as ErrorMemoryState;
}

function normalizeCategories(diagnostics: ValidationDiagnostic[]) {
  return [...new Set(
    diagnostics
      .map((d) => d.category?.trim())
      .filter((category): category is string => Boolean(category))
  )].sort();
}

function getHintForCategory(category: string) {
  if (category.includes("trace")) {
    return "prioritize channel separation and avoid crossing/overlapping routes around dense pins.";
  }
  if (category.includes("via_clearance") || category.includes("via")) {
    return "spread different-net vias apart and avoid placing multiple vias at the same fanout choke point.";
  }
  if (category.includes("clearance")) {
    return "increase spacing around this area and reduce local routing density.";
  }
  if (category.includes("autorouter_exhaustion")) {
    return "increase board/routing margin and spread dense component clusters so the autorouter has alternate paths.";
  }
  if (category.includes("compile")) {
    return "re-check pin labels, selector syntax, and only use valid tscircuit footprint strings.";
  }
  return "treat this as a hotspot and keep the local layout less dense.";
}

export function recordDiagnosticsSample(diagnostics: ValidationDiagnostic[]) {
  const categories = normalizeCategories(diagnostics);
  if (categories.length === 0) return;

  const state = getState();
  state.samples.push({
    categories,
    createdAt: Date.now(),
  });

  if (state.samples.length > MAX_SAMPLES) {
    state.samples.splice(0, state.samples.length - MAX_SAMPLES);
  }
}

export function getErrorMemoryStats(): ErrorMemoryStats {
  const state = getState();
  const categoryCounts: Record<string, number> = {};

  for (const sample of state.samples) {
    for (const category of sample.categories) {
      categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;
    }
  }

  const topCategories = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => ({ category, count }));

  return {
    sampleCount: state.samples.length,
    categoryCounts,
    topCategories,
  };
}

export function getAdaptiveGuardrails(maxCategories = 3) {
  const stats = getErrorMemoryStats();
  if (stats.sampleCount < 2 || stats.topCategories.length === 0) return "";

  const lines = stats.topCategories
    .slice(0, maxCategories)
    .map(
      ({ category, count }) =>
        `- ${category}: seen in ${count}/${stats.sampleCount} recent failed attempts; ${getHintForCategory(category)}`
    );

  return [
    `Adaptive guardrails from recent failed attempts (${stats.sampleCount} samples):`,
    ...lines,
  ].join("\n");
}

export function __resetErrorMemoryForTests() {
  const state = getState();
  state.samples = [];
}
