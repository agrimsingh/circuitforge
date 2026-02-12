import type { SSEEvent } from "@/lib/stream/types";

export async function consumeSSE(response: Response): Promise<SSEEvent[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const events: SSEEvent[] = [];
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const json = line.slice(6);
      if (!json) continue;
      try {
        events.push(JSON.parse(json) as SSEEvent);
      } catch {
        // skip malformed
      }
    }
  }

  return events;
}

export function accumulateText(events: SSEEvent[]): string {
  return events
    .filter((e): e is Extract<SSEEvent, { type: "text" }> => e.type === "text")
    .map((e) => e.content)
    .join("");
}

export function extractCodeFromText(text: string): string | null {
  const codeBlockRegex = /```tsx\n([\s\S]*?)```/g;
  let lastMatch: string | null = null;
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    lastMatch = match[1].trim();
  }
  return lastMatch;
}
