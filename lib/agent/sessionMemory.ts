import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type {
  ArchitectureNode,
  DesignPhase,
  RequirementItem,
  ReviewFinding,
} from "@/lib/stream/types";

export interface SessionContextData {
  projectId?: string;
  requirements: RequirementItem[];
  architecture: ArchitectureNode[];
  reviewFindings: ReviewFinding[];
  lastPhase?: DesignPhase;
  lastKicadSchema?: string;
  lastGeneratedCode?: string;
}

interface SessionEntry {
  context: SessionContextData;
  createdAt: number;
  updatedAt: number;
  lastAccessAt: number;
}

interface PersistedStoreShape {
  version: 1;
  savedAt: number;
  entries: Array<{ sessionId: string; entry: SessionEntry }>;
}

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MAX_SESSIONS = 200;
const DEFAULT_FLUSH_DEBOUNCE_MS = 350;
const STORE_PATH =
  process.env.CIRCUITFORGE_SESSION_STORE_PATH?.trim() ||
  join(tmpdir(), "circuitforge-session-memory-v1.json");

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const SESSION_TTL_MS = parsePositiveInt(
  process.env.CIRCUITFORGE_SESSION_TTL_MS,
  DEFAULT_TTL_MS,
);
const MAX_SESSIONS = parsePositiveInt(
  process.env.CIRCUITFORGE_SESSION_MAX_ENTRIES,
  DEFAULT_MAX_SESSIONS,
);
const FLUSH_DEBOUNCE_MS = parsePositiveInt(
  process.env.CIRCUITFORGE_SESSION_FLUSH_DEBOUNCE_MS,
  DEFAULT_FLUSH_DEBOUNCE_MS,
);

const sessionStore = new Map<string, SessionEntry>();
let loadPromise: Promise<void> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushPromise: Promise<void> | null = null;

function isSessionContextData(value: unknown): value is SessionContextData {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.requirements) &&
    Array.isArray(record.architecture) &&
    Array.isArray(record.reviewFindings)
  );
}

function sanitizeSessionEntry(raw: unknown): SessionEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (!isSessionContextData(record.context)) return null;
  const createdAt =
    typeof record.createdAt === "number" && Number.isFinite(record.createdAt)
      ? record.createdAt
      : Date.now();
  const updatedAt =
    typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)
      ? record.updatedAt
      : createdAt;
  const lastAccessAt =
    typeof record.lastAccessAt === "number" && Number.isFinite(record.lastAccessAt)
      ? record.lastAccessAt
      : updatedAt;
  return {
    context: record.context,
    createdAt,
    updatedAt,
    lastAccessAt,
  };
}

async function ensureLoaded() {
  if (loadPromise) {
    await loadPromise;
    return;
  }

  loadPromise = (async () => {
    try {
      const raw = await fs.readFile(STORE_PATH, "utf8");
      const parsed = JSON.parse(raw) as PersistedStoreShape;
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.entries)) return;

      for (const row of parsed.entries) {
        if (!row || typeof row !== "object") continue;
        const record = row as { sessionId?: unknown; entry?: unknown };
        if (typeof record.sessionId !== "string" || !record.sessionId.trim()) continue;
        const entry = sanitizeSessionEntry(record.entry);
        if (!entry) continue;
        sessionStore.set(record.sessionId, entry);
      }

      pruneStore();
    } catch {
      // ignore read/parse errors; store starts empty
    }
  })();

  await loadPromise;
}

function pruneStore(now = Date.now()) {
  for (const [sessionId, entry] of sessionStore) {
    if (now - entry.lastAccessAt > SESSION_TTL_MS) {
      sessionStore.delete(sessionId);
    }
  }

  if (sessionStore.size <= MAX_SESSIONS) return;
  const sorted = Array.from(sessionStore.entries()).sort(
    (a, b) => a[1].lastAccessAt - b[1].lastAccessAt,
  );
  const overflow = sorted.length - MAX_SESSIONS;
  for (let i = 0; i < overflow; i += 1) {
    const stale = sorted[i];
    if (!stale) continue;
    sessionStore.delete(stale[0]);
  }
}

function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushStoreToDisk();
  }, FLUSH_DEBOUNCE_MS);
}

async function flushStoreToDisk() {
  if (flushPromise) {
    await flushPromise;
    return;
  }

  const payload: PersistedStoreShape = {
    version: 1,
    savedAt: Date.now(),
    entries: Array.from(sessionStore.entries()).map(([sessionId, entry]) => ({
      sessionId,
      entry,
    })),
  };

  flushPromise = (async () => {
    const tmpPath = `${STORE_PATH}.tmp`;
    try {
      await fs.writeFile(tmpPath, JSON.stringify(payload), "utf8");
      await fs.rename(tmpPath, STORE_PATH);
    } catch {
      // swallow write errors; in-memory store remains valid
      await fs.rm(tmpPath, { force: true }).catch(() => {});
    } finally {
      flushPromise = null;
    }
  })();

  await flushPromise;
}

export async function getSessionContext(sessionId: string): Promise<SessionContextData | null> {
  await ensureLoaded();
  pruneStore();

  const entry = sessionStore.get(sessionId);
  if (!entry) return null;

  entry.lastAccessAt = Date.now();
  scheduleFlush();
  return entry.context;
}

export async function persistSessionContext(
  sessionId: string,
  context: SessionContextData,
): Promise<void> {
  await ensureLoaded();
  const now = Date.now();
  const existing = sessionStore.get(sessionId);
  sessionStore.set(sessionId, {
    context,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastAccessAt: now,
  });
  pruneStore(now);
  scheduleFlush();
}

export async function touchSessionContext(sessionId: string): Promise<void> {
  await ensureLoaded();
  const entry = sessionStore.get(sessionId);
  if (!entry) return;
  entry.lastAccessAt = Date.now();
  scheduleFlush();
}

export async function flushSessionStoreForTests(): Promise<void> {
  await ensureLoaded();
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flushStoreToDisk();
}

export async function resetSessionStoreForTests(): Promise<void> {
  await ensureLoaded();
  sessionStore.clear();
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await fs.rm(STORE_PATH, { force: true }).catch(() => {});
}

