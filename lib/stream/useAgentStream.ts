"use client";

import { useState, useCallback, useRef } from "react";
import type { SSEEvent } from "./types";

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ToolEvent {
  id: string;
  tool: string;
  status: "running" | "done";
  input?: unknown;
  output?: unknown;
  startedAt: number;
  finishedAt?: number;
}

export interface AgentStreamState {
  messages: AgentMessage[];
  thinkingText: string;
  toolEvents: ToolEvent[];
  circuitCode: string;
  isStreaming: boolean;
  error: string | null;
  costUsd: number | null;
}

const initialState: AgentStreamState = {
  messages: [],
  thinkingText: "",
  toolEvents: [],
  circuitCode: "",
  isStreaming: false,
  error: null,
  costUsd: null,
};

const CODE_BLOCK_RE = /```tsx\n([\s\S]*?)```/g;

function extractCodeFromText(text: string): string | null {
  let lastMatch: string | null = null;
  let match;
  while ((match = CODE_BLOCK_RE.exec(text)) !== null) {
    lastMatch = match[1].trim();
  }
  CODE_BLOCK_RE.lastIndex = 0;
  return lastMatch;
}

export function useAgentStream() {
  const [state, setState] = useState<AgentStreamState>(initialState);
  const abortRef = useRef<AbortController | null>(null);
  const accumulatedTextRef = useRef("");
  const toolCounterRef = useRef(0);

  const sendPrompt = useCallback(
    async (prompt: string, previousCode?: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      accumulatedTextRef.current = "";
      toolCounterRef.current = 0;

      setState((prev) => ({
        ...prev,
        messages: [...prev.messages, { role: "user", content: prompt }],
        thinkingText: "",
        toolEvents: [],
        isStreaming: true,
        error: null,
        costUsd: null,
      }));

      try {
        const response = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, previousCode }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errBody = await response.json().catch(() => ({}));
          throw new Error(
            (errBody as { error?: string }).error ??
              `Agent request failed: ${response.status}`
          );
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6);
            if (!jsonStr) continue;

            let event: SSEEvent;
            try {
              event = JSON.parse(jsonStr);
            } catch {
              continue;
            }

            switch (event.type) {
              case "text": {
                accumulatedTextRef.current += event.content;
                const code = extractCodeFromText(accumulatedTextRef.current);

                setState((prev) => {
                  const msgs = [...prev.messages];
                  const lastMsg = msgs[msgs.length - 1];
                  if (lastMsg?.role === "assistant") {
                    msgs[msgs.length - 1] = {
                      ...lastMsg,
                      content: accumulatedTextRef.current,
                    };
                  } else {
                    msgs.push({
                      role: "assistant",
                      content: accumulatedTextRef.current,
                    });
                  }
                  return {
                    ...prev,
                    messages: msgs,
                    circuitCode: code ?? prev.circuitCode,
                  };
                });
                break;
              }

              case "tool_start": {
                const id = `tool-${toolCounterRef.current++}`;
                setState((prev) => ({
                  ...prev,
                  toolEvents: [
                    ...prev.toolEvents,
                    {
                      id,
                      tool: event.tool,
                      status: "running",
                      input: event.input,
                      startedAt: Date.now(),
                    },
                  ],
                }));
                break;
              }

              case "tool_result": {
                setState((prev) => {
                  const events = [...prev.toolEvents];
                  for (let i = events.length - 1; i >= 0; i--) {
                    if (events[i].tool === event.tool && events[i].status === "running") {
                      events[i] = {
                        ...events[i],
                        status: "done",
                        output: event.output,
                        finishedAt: Date.now(),
                      };
                      break;
                    }
                  }
                  return { ...prev, toolEvents: events };
                });
                break;
              }

              case "subagent_start": {
                const id = `tool-${toolCounterRef.current++}`;
                setState((prev) => ({
                  ...prev,
                  toolEvents: [
                    ...prev.toolEvents,
                    {
                      id,
                      tool: `Subagent: ${event.agent}`,
                      status: "running",
                      startedAt: Date.now(),
                    },
                  ],
                }));
                break;
              }

              case "subagent_stop": {
                setState((prev) => {
                  const events = [...prev.toolEvents];
                  for (let i = events.length - 1; i >= 0; i--) {
                    if (events[i].tool.includes(event.agent) && events[i].status === "running") {
                      events[i] = {
                        ...events[i],
                        status: "done",
                        finishedAt: Date.now(),
                      };
                      break;
                    }
                  }
                  return { ...prev, toolEvents: events };
                });
                break;
              }

              case "error": {
                setState((prev) => ({
                  ...prev,
                  error: event.message,
                  isStreaming: false,
                }));
                break;
              }

              case "done": {
                setState((prev) => ({
                  ...prev,
                  isStreaming: false,
                  costUsd: event.usage?.total_cost_usd ?? null,
                }));
                break;
              }
            }
          }
        }

        setState((prev) =>
          prev.isStreaming ? { ...prev, isStreaming: false } : prev
        );
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setState((prev) => ({
          ...prev,
          error: err instanceof Error ? err.message : "Unknown error",
          isStreaming: false,
        }));
      }
    },
    []
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setState((prev) => ({ ...prev, isStreaming: false }));
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    accumulatedTextRef.current = "";
    setState(initialState);
  }, []);

  return { ...state, sendPrompt, stop, reset };
}
