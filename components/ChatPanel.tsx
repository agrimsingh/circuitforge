"use client";

import { useCallback } from "react";
import { Conversation, ConversationContent, ConversationEmptyState } from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  Suggestion,
  Suggestions,
} from "@/components/ai-elements/suggestion";
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import {
  ChainOfThought,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
} from "@/components/ai-elements/chain-of-thought";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import type { AgentMessage } from "@/lib/stream/useAgentStream";
import type { ToolEvent } from "@/lib/stream/useAgentStream";
import type { PhaseStepState, GateEvent } from "@/lib/stream/types";

type ChatPanelProps = {
  messages: AgentMessage[];
  thinkingText: string;
  toolEvents: ToolEvent[];
  isStreaming: boolean;
  phaseSteps?: PhaseStepState[];
  gateEvents?: GateEvent[];
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

function statusToPhaseStatus(
  status: PhaseStepState["status"]
): "pending" | "active" | "complete" {
  return status === "pending" ? "pending" : status === "blocked" ? "active" : status;
}

function formatToolTime(startedAt: number, finishedAt?: number) {
  if (!finishedAt) return null;
  return `${((finishedAt - startedAt) / 1000).toFixed(1)}s`;
}

export function ChatPanel({
  messages,
  thinkingText,
  toolEvents,
  isStreaming,
  phaseSteps,
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
    <div className="flex h-full flex-col bg-[#080c14]">
      <Conversation className="flex-1 bg-[#080c14]">
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState>
              <h3 className="text-lg font-semibold">What circuit are you building?</h3>
              <p className="text-sm text-[#4a6080]">
                Describe constraints and parts, then let the agent derive requirements, architecture,
                and code.
              </p>
              <Suggestions>
                {starterPrompts.map((suggestion) => (
                  <Suggestion
                    key={suggestion}
                    onClick={() => onSend(suggestion)}
                    suggestion={suggestion}
                    disabled={isStreaming}
                    className="bg-[#0b1322] text-[#94a8c0]"
                  />
                ))}
              </Suggestions>
            </ConversationEmptyState>
          ) : (
            <>
              {phaseSteps && phaseSteps.length > 0 && (
                <ChainOfThought defaultOpen className="mb-6 pr-1">
                  <ChainOfThoughtHeader>Workflow</ChainOfThoughtHeader>
                  {phaseSteps.map((step) => (
                    <ChainOfThoughtStep
                      key={step.phase}
                      label={
                        <span className="font-medium uppercase tracking-wide text-xs">
                          {step.phase}
                        </span>
                      }
                      status={statusToPhaseStatus(step.status)}
                      description={step.reason ? <span>{step.reason}</span> : undefined}
                    />
                  ))}
                </ChainOfThought>
              )}

              {messages.map((message) => (
                <Message key={message.id} from={message.role}>
                  <MessageContent>
                    <MessageResponse>
                      {message.content || (message.role === "assistant" ? "..." : "")}
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
                              (event.status === "running" ? "Running..." : "No output")
                            }
                            errorText={undefined}
                          />
                        </ToolContent>
                      </Tool>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </ConversationContent>
      </Conversation>

      <div className="border-t border-[#1a2236] p-3">
        <PromptInput
          className="relative rounded-xl border border-[#1a2236] bg-[#0d1520]"
          onSubmit={handleSubmit}
        >
          <PromptInputTextarea
            placeholder="Describe your circuit requirement"
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
