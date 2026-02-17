import { query } from "@anthropic-ai/claude-agent-sdk";
import { MODELS } from "@/lib/agent/models";
import type { ArchitectureNode } from "@/lib/stream/types";

const ARCHITECTURE_SYSTEM_PROMPT = `You are a hardware system architect.
Return only valid JSON. Do not include markdown.

Output schema:
{
  "blocks": [
    {
      "id": "A0",
      "label": "Controller",
      "kind": "component|block|interface|power|net",
      "status": "proposed|approved|in_progress|done|blocked",
      "role": "control|power|connectivity|sensing|actuation|io|safety|clock|storage|debug|analog|mechanical",
      "criticality": "high|medium|low",
      "notes": "what this block does for this device",
      "inputs": ["..."],
      "outputs": ["..."],
      "interfaces": ["..."],
      "keyComponents": ["..."],
      "constraints": ["..."],
      "failureModes": ["..."]
    }
  ],
  "connections": [
    { "from": "A0", "to": "A1", "signalType": "power|control|data|analog|clock|rf|debug|mechanical", "notes": "optional" }
  ]
}

Rules:
- Make the architecture device-specific and functional, not generic.
- Include 3-8 blocks that reflect the actual product behavior.
- Include meaningful signal/power/control flow between blocks.
- Keep list fields concise (max ~5 items each).
- Ensure IDs referenced by connections exist in blocks.`;

interface LlmArchitectureConnection {
  from?: unknown;
  to?: unknown;
  signalType?: unknown;
  notes?: unknown;
}

interface LlmArchitectureBlock {
  id?: unknown;
  label?: unknown;
  kind?: unknown;
  status?: unknown;
  role?: unknown;
  criticality?: unknown;
  notes?: unknown;
  inputs?: unknown;
  outputs?: unknown;
  interfaces?: unknown;
  keyComponents?: unknown;
  constraints?: unknown;
  failureModes?: unknown;
}

interface LlmArchitecturePayload {
  blocks?: unknown;
  connections?: unknown;
}

function normalizeKind(raw: unknown): ArchitectureNode["kind"] {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (value === "component" || value === "interface" || value === "power" || value === "net") {
    return value;
  }
  return "block";
}

function normalizeStatus(raw: unknown): ArchitectureNode["status"] {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (
    value === "proposed" ||
    value === "approved" ||
    value === "in_progress" ||
    value === "done" ||
    value === "blocked"
  ) {
    return value;
  }
  return "proposed";
}

function normalizeCriticality(raw: unknown): ArchitectureNode["criticality"] {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (value === "high" || value === "medium" || value === "low") return value;
  return undefined;
}

function sanitizeItem(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.slice(0, 140);
}

function sanitizeList(raw: unknown, maxItems = 5): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const normalized = sanitizeItem(item);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
    if (out.length >= maxItems) break;
  }
  return out.length > 0 ? out : undefined;
}

function sanitizeRole(raw: unknown): string | undefined {
  const normalized = sanitizeItem(raw);
  if (!normalized) return undefined;
  return normalized.toLowerCase();
}

function sanitizeLabel(raw: unknown, fallback: string): string {
  const normalized = sanitizeItem(raw);
  return normalized ?? fallback;
}

function sanitizeNotes(raw: unknown): string | undefined {
  return sanitizeItem(raw) ?? undefined;
}

function sanitizeBlockId(raw: unknown, index: number): string {
  if (typeof raw !== "string") return `A${index}`;
  const compact = raw.trim().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 16);
  if (!compact) return `A${index}`;
  return compact;
}

function extractJsonCandidate(text: string): string | null {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseLlmArchitecture(text: string): LlmArchitecturePayload {
  const candidate = extractJsonCandidate(text);
  if (!candidate) throw new Error("No JSON payload detected in architecture response.");
  const parsed = JSON.parse(candidate) as unknown;
  const record = asRecord(parsed);
  if (!record) throw new Error("Architecture payload is not an object.");
  return record as LlmArchitecturePayload;
}

function toArchitectureNodes(payload: LlmArchitecturePayload): ArchitectureNode[] {
  if (!Array.isArray(payload.blocks)) return [];

  const blocks = payload.blocks as LlmArchitectureBlock[];
  const nodes: ArchitectureNode[] = [];
  const idMap = new Map<string, string>();
  const childrenById = new Map<string, Set<string>>();

  for (let i = 0; i < blocks.length && i < 8; i += 1) {
    const block = blocks[i];
    const baseId = sanitizeBlockId(block?.id, i);
    const id = idMap.has(baseId) ? `A${i}` : baseId;
    idMap.set(baseId, id);
    idMap.set(id, id);

    const label = sanitizeLabel(block?.label, `Block ${i + 1}`);
    nodes.push({
      id,
      label,
      kind: normalizeKind(block?.kind),
      status: normalizeStatus(block?.status ?? "proposed"),
      role: sanitizeRole(block?.role),
      criticality: normalizeCriticality(block?.criticality),
      notes: sanitizeNotes(block?.notes),
      inputs: sanitizeList(block?.inputs),
      outputs: sanitizeList(block?.outputs),
      interfaces: sanitizeList(block?.interfaces),
      keyComponents: sanitizeList(block?.keyComponents),
      constraints: sanitizeList(block?.constraints),
      failureModes: sanitizeList(block?.failureModes),
    });
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const rawConnections = Array.isArray(payload.connections)
    ? (payload.connections as LlmArchitectureConnection[])
    : [];
  for (const connection of rawConnections) {
    const fromRaw = sanitizeItem(connection?.from);
    const toRaw = sanitizeItem(connection?.to);
    if (!fromRaw || !toRaw) continue;
    const from = idMap.get(fromRaw) ?? fromRaw;
    const to = idMap.get(toRaw) ?? toRaw;
    if (!nodeIds.has(from) || !nodeIds.has(to) || from === to) continue;
    const current = childrenById.get(from) ?? new Set<string>();
    current.add(to);
    childrenById.set(from, current);
  }

  for (const node of nodes) {
    const children = childrenById.get(node.id);
    if (children && children.size > 0) {
      node.children = Array.from(children);
    }
  }

  return nodes;
}

export async function generateArchitectureWithHaiku(params: {
  apiKey: string;
  prompt: string;
  signal?: AbortSignal;
}): Promise<ArchitectureNode[]> {
  let fullText = "";
  const sdkAbort = new AbortController();
  const onAbort = () => sdkAbort.abort();
  if (params.signal) {
    if (params.signal.aborted) onAbort();
    else params.signal.addEventListener("abort", onAbort, { once: true });
  }

  const agentQuery = query({
    prompt: `Generate a device-specific architecture for this project:\n${params.prompt}`,
    options: {
      model: MODELS.SCOUT,
      systemPrompt: ARCHITECTURE_SYSTEM_PROMPT,
      includePartialMessages: true,
      persistSession: false,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      abortController: sdkAbort,
      maxTurns: 1,
      env: { ...process.env, ANTHROPIC_API_KEY: params.apiKey },
    },
  });

  try {
    for await (const message of agentQuery) {
      if (message.type === "result") {
        const result = message as Record<string, unknown>;
        const resultText = typeof result.result === "string" ? result.result : "";
        if (resultText) fullText = resultText;
        break;
      }
      if (message.type === "stream_event" && "event" in message) {
        const event = (message as { event: Record<string, unknown> }).event;
        if (event.type === "content_block_delta") {
          const delta = event.delta as Record<string, unknown> | undefined;
          if (delta?.type === "text_delta" && typeof delta.text === "string") {
            fullText += delta.text;
          }
        }
      }
    }
  } finally {
    if (params.signal) params.signal.removeEventListener("abort", onAbort);
    agentQuery.close?.();
  }

  if (!fullText.trim()) {
    throw new Error("Architecture model returned an empty response.");
  }

  const parsed = parseLlmArchitecture(fullText);
  const nodes = toArchitectureNodes(parsed);
  if (nodes.length === 0) {
    throw new Error("Architecture model returned no valid blocks.");
  }

  return nodes;
}
