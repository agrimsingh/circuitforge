"use client";

import { useCallback, memo } from "react";
import { Conversation, ConversationContent, ConversationEmptyState } from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import {
  ChainOfThought,
  ChainOfThoughtHeader,
  ChainOfThoughtContent,
  ChainOfThoughtStep,
} from "@/components/ai-elements/chain-of-thought";
import type { AgentMessage, ToolEvent, TodoItem } from "@/lib/stream/useAgentStream";
import type { PhaseStepState, GateEvent } from "@/lib/stream/types";
import {
  Queue,
  QueueItem,
  QueueItemContent,
  QueueItemIndicator,
  QueueSection,
  QueueSectionContent,
  QueueSectionLabel,
  QueueSectionTrigger,
} from "@/components/ai-elements/queue";
import {
  ChevronRightIcon,
  CpuIcon,
  SearchIcon,
  WrenchIcon,
  CheckCircleIcon,
  AlertTriangleIcon,
  ZapIcon,
  CircleDotIcon,
  ListChecksIcon,
} from "lucide-react";

type ChatPanelProps = {
  messages: AgentMessage[];
  thinkingText: string;
  toolEvents: ToolEvent[];
  todos: TodoItem[];
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

const listChecksIcon = <ListChecksIcon className="size-4" />;

const TodoQueue = memo(function TodoQueue({ todos }: { todos: TodoItem[] }) {
  if (todos.length === 0) return null;
  return (
    <Queue className="mx-1">
      <QueueSection defaultOpen>
        <QueueSectionTrigger>
          <QueueSectionLabel
            label={`task${todos.length !== 1 ? "s" : ""}`}
            count={todos.length}
            icon={listChecksIcon}
          />
        </QueueSectionTrigger>
        <QueueSectionContent>
          <ul className="mt-2 -mb-1">
            {todos.map((todo, i) => {
              const done =
                todo.status === "completed" || todo.status === "cancelled";
              return (
                <QueueItem key={todo.id || `todo-${i}`}>
                  <div className="flex items-start gap-2">
                    {todo.status === "in_progress" ? (
                      <span className="mt-0.5 inline-block size-2.5 rounded-full border-2 border-accent/50 border-t-accent animate-spin" />
                    ) : (
                      <QueueItemIndicator completed={done} />
                    )}
                    <QueueItemContent completed={done}>
                      {todo.content}
                    </QueueItemContent>
                  </div>
                </QueueItem>
              );
            })}
          </ul>
        </QueueSectionContent>
      </QueueSection>
    </Queue>
  );
});

const starterPrompts = [
  "Design a low-power ESP32-based temperature monitor with OLED display",
  "Create a USB-powered STM32 dev board with SWD header and status LEDs",
  "Build a Bluetooth BLE pulse oximeter with LiPo battery charge circuit",
  "Give me a simple single-sided LED blink board with mounting holes",
];

type SystemEventItem = NonNullable<ChatPanelProps["systemEvents"]>[number];

type CoTStep = {
  id: string;
  label: string;
  description?: string;
  status: "complete" | "active" | "pending";
  icon?: import("lucide-react").LucideIcon;
  at: number;
};

const INTERNAL_TOOLS = new Set([
  "Grep",
  "Read",
  "Glob",
  "Write",
  "StrReplace",
  "SemanticSearch",
  "ReadLints",
  "Shell",
  "Delete",
  "EditNotebook",
  "TodoWrite",
  "Bash",
]);

function humanizeToolName(tool: string, input?: unknown): string | null {
  if (INTERNAL_TOOLS.has(tool)) return null;
  const inp = input as Record<string, unknown> | undefined;
  if (tool.includes("search_parts"))
    return `Searching parts${inp?.q ? `: ${inp.q}` : ""}`;
  if (tool.includes("WebSearch") || tool === "WebSearch")
    return `Looking up${inp?.query ? `: ${String(inp.query).slice(0, 60)}` : " reference data"}`;
  if (tool.includes("validate") || tool.includes("Validate"))
    return "Running circuit validator";
  if (tool.includes("compile") || tool.includes("Compile"))
    return "Compiling circuit";
  if (tool.includes("Task"))
    return `Running sub-task${inp?.description ? `: ${inp.description}` : ""}`;
  if (tool.startsWith("Subagent: ")) {
    const agent = tool.replace("Subagent: ", "");
    if (agent === "Explore") return null;
    if (agent.includes("parts")) return "Searching component databases";
    if (agent.includes("code")) return "Writing circuit code";
    if (agent.includes("review") || agent.includes("valid"))
      return "Reviewing design";
    return `Running ${agent}`;
  }
  return tool.replace(/^mcp_[^_]+__/, "").replace(/_/g, " ");
}

function toolEventToStep(ev: ToolEvent): CoTStep | null {
  const label = humanizeToolName(ev.tool, ev.input);
  if (label === null) return null;
  return {
    id: ev.id,
    label,
    description: ev.finishedAt
      ? `${((ev.finishedAt - ev.startedAt) / 1000).toFixed(1)}s`
      : undefined,
    status: ev.status === "running" ? "active" : "complete",
    icon:
      ev.tool.includes("search") || ev.tool.includes("Search")
        ? SearchIcon
        : ev.tool.includes("Task")
          ? CircleDotIcon
          : undefined,
    at: ev.startedAt,
  };
}

function systemEventToStep(ev: SystemEventItem): CoTStep | null {
  switch (ev.type) {
    case "retry_start":
      return {
        id: ev.id,
        label: `Validating circuit (attempt ${ev.attempt}/${ev.maxAttempts || "?"})`,
        status: "active",
        icon: ZapIcon,
        at: ev.at,
      };
    case "validation_summary": {
      const count = ev.diagnosticsCount ?? 0;
      const cats = ev.diagnosticsByCategory
        ? Object.entries(ev.diagnosticsByCategory)
            .map(
              ([k, v]) =>
                `${v} ${k.replace(/^kicad_/, "").replace(/_/g, " ")}`
            )
            .join(", ")
        : undefined;
      return {
        id: ev.id,
        label:
          count === 0
            ? "No issues found"
            : `${count} issue${count !== 1 ? "s" : ""} found`,
        description: cats,
        status: "complete",
        icon: count > 0 ? AlertTriangleIcon : CheckCircleIcon,
        at: ev.at,
      };
    }
    case "retry_result":
      return {
        id: ev.id,
        label:
          ev.status === "clean"
            ? "Design validated successfully"
            : ev.status === "failed"
              ? `Attempt failed${ev.diagnosticsCount ? ` — ${ev.diagnosticsCount} issues remain` : ""}`
              : "Retrying validation",
        status: "complete",
        icon:
          ev.status === "clean"
            ? CheckCircleIcon
            : ev.status === "failed"
              ? AlertTriangleIcon
              : ZapIcon,
        at: ev.at,
      };
    case "repair_result": {
      const fixed = ev.autoFixedCount ?? 0;
      return {
        id: ev.id,
        label:
          fixed > 0
            ? `Auto-fixed ${fixed} issue${fixed !== 1 ? "s" : ""}`
            : `Repaired: ${ev.blockingBefore} → ${ev.blockingAfter} blocking`,
        status: "complete",
        icon: WrenchIcon,
        at: ev.at,
      };
    }
    case "gate_passed":
      return {
        id: ev.id,
        label: "Circuit validated successfully",
        status: "complete",
        icon: CheckCircleIcon,
        at: ev.at,
      };
    case "gate_blocked":
      return {
        id: ev.id,
        label: `Auto-repairing — ${ev.message || "validation issues"}`,
        status: "active",
        icon: WrenchIcon,
        at: ev.at,
      };
    default:
      return null;
  }
}

export function ChatPanel({
  messages,
  thinkingText,
  toolEvents,
  todos,
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
              <div className="space-y-8 max-w-lg mx-auto">
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
                  <MessageContent
                    className={
                      message.role === "system"
                        ? "rounded-md border border-accent/20 bg-accent/5 px-3 py-2 text-[13px]"
                        : undefined
                    }
                  >
                    <MessageResponse>
                      {message.content || (message.role === "assistant" ? "…" : "")}
                    </MessageResponse>
                  </MessageContent>
                </Message>
              ))}

              {(toolEvents.length > 0 ||
                (systemEvents && systemEvents.length > 0)) &&
                (() => {
                  const steps: CoTStep[] = [
                    ...toolEvents
                      .map(toolEventToStep)
                      .filter((s): s is CoTStep => s !== null),
                    ...(systemEvents ?? [])
                      .map(systemEventToStep)
                      .filter((s): s is CoTStep => s !== null),
                  ].sort((a, b) => a.at - b.at);

                  if (steps.length === 0) return null;

                  return (
                    <ChainOfThought
                      defaultOpen={isStreaming}
                      open={isStreaming}
                    >
                      <ChainOfThoughtHeader>
                        {isStreaming
                          ? "Working on your circuit…"
                          : "Pipeline activity"}
                      </ChainOfThoughtHeader>
                      <ChainOfThoughtContent>
                        {steps.map((step) => (
                          <ChainOfThoughtStep
                            key={step.id}
                            label={
                              <span className="font-medium text-xs">
                                {step.label}
                              </span>
                            }
                            description={step.description}
                            status={step.status}
                            icon={step.icon}
                          />
                        ))}
                      </ChainOfThoughtContent>
                    </ChainOfThought>
                  );
                })()}

              <TodoQueue todos={todos} />
            </>
          )}
        </ConversationContent>
      </Conversation>

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
