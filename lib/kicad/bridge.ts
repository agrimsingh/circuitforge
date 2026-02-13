interface KicadLibraryFacade {
  // The concrete package exports are not strongly typed in this repository.
  // We keep access generic and feature-detect runtime methods.
  [key: string]: unknown;
  __source?: "circuit-json-to-kicad" | "kicad-sch-ts";
}

const KICAD_LIBRARY_CACHE = {
  module: null as KicadLibraryFacade | null,
  loaded: false,
  error: null as Error | null,
};

export async function loadKicadLibrary(): Promise<KicadLibraryFacade | null> {
  if (KICAD_LIBRARY_CACHE.loaded) {
    return KICAD_LIBRARY_CACHE.module;
  }

  KICAD_LIBRARY_CACHE.loaded = true;
  let primaryError: Error | null = null;
  let fallbackError: Error | null = null;

  try {
    const imported = (await import("circuit-json-to-kicad")) as KicadLibraryFacade;
    if (typeof imported?.CircuitJsonToKicadSchConverter === "function") {
      KICAD_LIBRARY_CACHE.module = {
        ...imported,
        __source: "circuit-json-to-kicad",
      };
      return KICAD_LIBRARY_CACHE.module;
    }
    throw new Error("circuit-json-to-kicad loaded but CircuitJsonToKicadSchConverter is missing");
  } catch (error) {
    primaryError = error instanceof Error ? error : new Error(String(error));
  }

  try {
    const imported = (await import("kicad-sch-ts")) as KicadLibraryFacade;
    KICAD_LIBRARY_CACHE.module = {
      ...imported,
      __source: "kicad-sch-ts",
    };
    return imported ?? null;
  } catch (error) {
    fallbackError = error instanceof Error ? error : new Error(String(error));
  }

  KICAD_LIBRARY_CACHE.error = new Error(
    `Unable to load circuit-json-to-kicad (${primaryError?.message ?? "unknown"}); fallback kicad-sch-ts (${fallbackError?.message ?? "unknown"})`,
  );
  return null;
}

export function getKicadLibraryError(): Error | null {
  return KICAD_LIBRARY_CACHE.error;
}

export function clearKicadLibraryCache() {
  KICAD_LIBRARY_CACHE.module = null;
  KICAD_LIBRARY_CACHE.loaded = false;
  KICAD_LIBRARY_CACHE.error = null;
}
