"use client";

import { useCallback } from "react";
import { Conversation, ConversationContent, ConversationEmptyState } from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import type { AgentMessage } from "@/lib/stream/useAgentStream";
import type { ToolEvent } from "@/lib/stream/useAgentStream";
import type { PhaseStepState, GateEvent } from "@/lib/stream/types";
import { ChevronRightIcon, CpuIcon } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

type ChatPanelProps = {
  messages: AgentMessage[];
  thinkingText: string;
  toolEvents: ToolEvent[];
  isStreaming: boolean;
  phaseSteps?: PhaseStepState[];
  gateEvents?: GateEvent[];
  phaseMessage?: string | null;
  phaseProgress?: number;
  retryTelemetry?: {
    attemptsSeen: number;
    maxAttempts: number;
    finalStatus: "clean" | "retrying" | "failed" | null;
  } | null;
  systemEvents?: Array<{
    id: string;
    type:
      | "retry_start"
      | "validation_summary"
      | "retry_result"
      | "gate_passed"
      | "gate_blocked"
      | "repair_result";
    at: number;
    attempt?: number;
    maxAttempts?: number;
    status?: "clean" | "retrying" | "failed";
    diagnosticsCount?: number;
    diagnosticsByCategory?: Record<string, number>;
    message?: string;
    gate?: string;
    phase?: string;
    blockingBefore?: number;
    blockingAfter?: number;
    autoFixedCount?: number;
    demotedCount?: number;
  }>;
  onSend: (prompt: string) => void;
  onStop: () => void;
};

const starterPrompts = [
  "Design a low-power ESP32-based temperature monitor with OLED display",
  "Create a USB-powered STM32 dev board with SWD header and status LEDs",
  "Build a Bluetooth BLE pulse oximeter with LiPo battery charge circuit",
  "Give me a simple single-sided LED blink board with mounting holes",
];

function toolStateFromEvent(status: ToolEvent["status"]) {
  return status === "running" ? "input-streaming" : "output-available";
}

function formatToolTime(startedAt: number, finishedAt?: number) {
  if (!finishedAt) return null;
  return `${((finishedAt - startedAt) / 1000).toFixed(1)}s`;
}

type SystemEventItem = NonNullable<ChatPanelProps["systemEvents"]>[number];

function StatusBanner({
  phaseMessage,
  phaseProgress,
  retryTelemetry,
}: {
  phaseMessage?: string | null;
  phaseProgress?: number;
  retryTelemetry?: ChatPanelProps["retryTelemetry"];
}) {
  const showAttempt = retryTelemetry && retryTelemetry.attemptsSeen > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
      className="mx-3 mb-2 rounded-lg border border-border/40 bg-surface-raised/80 backdrop-blur-sm px-3 py-2 shadow-sm"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-block size-1.5 rounded-full bg-accent animate-pulse shrink-0" />
          <span className="text-xs text-muted-foreground truncate">
            {phaseMessage || "Working…"}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {showAttempt && (
            <span className="text-[10px] font-mono text-muted-foreground/70 rounded border border-border/30 px-1.5 py-0.5">
              A{retryTelemetry!.attemptsSeen}/{retryTelemetry!.maxAttempts || "?"}
            </span>
          )}
          {typeof phaseProgress === "number" && phaseProgress > 0 && (
            <span className="text-[10px] font-mono text-accent/80">
              {phaseProgress}%
            </span>
          )}
        </div>
      </div>
      {typeof phaseProgress === "number" && phaseProgress > 0 && (
        <div className="mt-1.5 h-0.5 w-full rounded-full bg-border/30 overflow-hidden">
          <motion.div
            className="h-full bg-accent/60 origin-left rounded-full"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: phaseProgress / 100 }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
          />
        </div>
      )}
    </motion.div>
  );
}

function SystemEventCard({ event }: { event: SystemEventItem }) {
  let borderColor = "border-border/40";
  let icon = "●";
  let content: React.ReactNode = null;

  switch (event.type) {
    case "retry_start":
      borderColor = "border-amber-500/40";
      icon = "↻";
      content = (
        <>
          <span className="font-mono text-amber-400/90">Attempt {event.attempt}/{event.maxAttempts || "?"}</span>
          <span className="text-muted-foreground"> — re-evaluating circuit</span>
        </>
      );
      break;
    case "validation_summary":
      borderColor = "border-red-500/30";
      icon = "⚠";
      content = (
        <>
          <span className="font-mono text-red-400/80">{event.diagnosticsCount} issue{event.diagnosticsCount !== 1 ? "s" : ""} found</span>
          {event.diagnosticsByCategory && Object.keys(event.diagnosticsByCategory).length > 0 && (
            <span className="text-muted-foreground/60"> · {Object.entries(event.diagnosticsByCategory).map(([k, v]) => `${k}: ${v}`).join(", ")}</span>
          )}
        </>
      );
      break;
    case "retry_result":
      borderColor = event.status === "clean" ? "border-emerald-500/40" : event.status === "failed" ? "border-red-500/40" : "border-amber-500/40";
      icon = event.status === "clean" ? "✓" : event.status === "failed" ? "✗" : "↻";
      content = (
        <>
          <span className={`font-mono ${event.status === "clean" ? "text-emerald-400/90" : event.status === "failed" ? "text-red-400/90" : "text-amber-400/90"}`}>
            {event.status === "clean" ? "Clean compile" : event.status === "failed" ? "Attempt failed" : "Retrying"}
          </span>
          {event.diagnosticsCount != null && (
            <span className="text-muted-foreground"> · {event.diagnosticsCount} remaining</span>
          )}
        </>
      );
      break;
    case "repair_result":
      borderColor = "border-cyan-500/30";
      icon = "🔧";
      content = (
        <>
          <span className="font-mono text-cyan-400/80">Repair: {event.blockingBefore} → {event.blockingAfter} blocking</span>
          {(event.autoFixedCount ?? 0) > 0 && <span className="text-muted-foreground"> · auto-fixed {event.autoFixedCount}</span>}
        </>
      );
      break;
    case "gate_passed":
      borderColor = "border-emerald-500/40";
      icon = "✅";
      content = <span className="font-mono text-emerald-400/90">Gate passed: {event.gate}</span>;
      break;
    case "gate_blocked":
      borderColor = "border-red-500/40";
      icon = "🛑";
      content = <span className="font-mono text-red-400/90">Gate blocked: {event.gate}</span>;
      break;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      className={`border-l-2 ${borderColor} bg-surface-raised/50 rounded-r-md px-3 py-2 text-xs`}
    >
      <span className="mr-1.5">{icon}</span>
      {content}
    </motion.div>
  );
}

export function ChatPanel({
  messages,
  thinkingText,
  toolEvents,
  isStreaming,
  phaseMessage,
  phaseProgress,
  retryTelemetry,
  systemEvents,
  onSend,
  onStop,
}: ChatPanelProps) {
  const handleSubmit = useCallback(
    ({ text }: { text: string }) => {
      const prompt = text.trim();
      if (!prompt || isStreaming) return;
      onSend(prompt);
    },
    [isStreaming, onSend]
  );

  return (
    <div className="flex h-full flex-col bg-surface">
      <Conversation className="flex-1 bg-surface">
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState>
              <div className="space-y-8 max-w-md mx-auto">
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold text-foreground tracking-tight text-balance">
                    What are you building?
                  </h3>
                  <p className="text-[13px] text-muted-foreground/70 text-pretty">
                    Describe your circuit and the agent will handle the rest.
                  </p>
                </div>
                <div className="grid gap-2">
                  {starterPrompts.map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => onSend(suggestion)}
                      disabled={isStreaming}
                      className="group flex w-full items-center gap-3 rounded-lg border border-border/40 bg-surface-raised/50 px-4 py-3 text-left text-[13px] text-secondary-foreground/70 transition-all duration-200 ease-out hover:border-accent/20 hover:bg-surface-raised hover:text-foreground hover:shadow-[0_0_15px_rgba(6,182,212,0.06)] disabled:opacity-40"
                    >
                      <CpuIcon className="size-3.5 shrink-0 text-accent/30 transition-colors group-hover:text-accent/60" />
                      <span className="flex-1 text-pretty">{suggestion}</span>
                      <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/30 transition-all group-hover:text-accent/40 group-hover:translate-x-0.5" />
                    </button>
                  ))}
                </div>
              </div>
            </ConversationEmptyState>
          ) : (
            <>
              {messages.map((message) => (
                <Message key={message.id} from={message.role}>
                  <MessageContent>
                    <MessageResponse>
                      {message.content || (message.role === "assistant" ? "…" : "")}
                    </MessageResponse>
                  </MessageContent>
                </Message>
              ))}

              {thinkingText && (
                <Reasoning isStreaming={isStreaming} defaultOpen={isStreaming} className="not-prose">
                  <ReasoningTrigger>Agent reasoning</ReasoningTrigger>
                  <ReasoningContent>{thinkingText}</ReasoningContent>
                </Reasoning>
              )}

              {toolEvents.length > 0 && (
                <div className="space-y-2">
                  {toolEvents.map((event) => {
                const duration = formatToolTime(event.startedAt, event.finishedAt);
                    return (
                      <Tool key={event.id} defaultOpen={isStreaming && event.status === "running"}>
                        <ToolHeader
                          title={event.tool}
                          type="dynamic-tool"
                          toolName={event.tool}
                          state={toolStateFromEvent(event.status)}
                        />
                        <ToolContent>
                          <ToolInput
                            input={
                              event.input ?? {
                                message: "No input payload",
                              }
                            }
                          />
                          {duration && <p className="text-xs text-muted-foreground">{duration}</p>}
                          <ToolOutput
                            output={
                              event.output ??
                              (event.status === "running" ? "Running…" : "No output")
                            }
                            errorText={undefined}
                          />
                        </ToolContent>
                      </Tool>
                    );
                  })}
                </div>
              )}

              {systemEvents && systemEvents.length > 0 && (
                <div className="space-y-1.5 px-1">
                  {systemEvents.map((ev) => (
                    <SystemEventCard key={ev.id} event={ev} />
                  ))}
                </div>
              )}
            </>
          )}
        </ConversationContent>
      </Conversation>

      <AnimatePresence>
        {isStreaming && (
          <StatusBanner
            phaseMessage={phaseMessage}
            phaseProgress={phaseProgress}
            retryTelemetry={retryTelemetry}
          />
        )}
      </AnimatePresence>

      <div className="border-t border-border p-3">
        <PromptInput
          className="relative rounded-xl border border-border/40 bg-surface-raised/80 transition-all duration-200 focus-within:border-accent/25 focus-within:shadow-[0_0_20px_rgba(6,182,212,0.06)]"
          onSubmit={handleSubmit}
        >
          <PromptInputTextarea
            aria-label="Circuit description"
            placeholder="Describe your circuit…"
            disabled={isStreaming}
            className="max-h-32"
          />
          <PromptInputSubmit
            status={isStreaming ? "streaming" : "ready"}
            onStop={onStop}
          />
        </PromptInput>
      </div>
    </div>
  );
}
