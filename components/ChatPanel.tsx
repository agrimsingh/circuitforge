"use client";

import { useRef, useEffect, type FormEvent, useState } from "react";
import type { AgentMessage } from "@/lib/stream/useAgentStream";

interface ChatPanelProps {
  messages: AgentMessage[];
  isStreaming: boolean;
  onSend: (prompt: string) => void;
  onStop: () => void;
}

export function ChatPanel({ messages, isStreaming, onSend, onStop }: ChatPanelProps) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    setInput("");
    onSend(trimmed);
  };

  return (
    <div className="flex flex-col h-full bg-[#0a0e17]">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a2236]">
        <div className="w-2 h-2 rounded-full bg-[#00d4ff] animate-pulse" />
        <span className="text-xs font-mono uppercase tracking-widest text-[#4a6080]">
          Chat
        </span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <div className="text-5xl mb-4 opacity-20">⚡</div>
            <h2 className="text-lg font-semibold text-[#c0d0e0] mb-2">
              What do you want to build?
            </h2>
            <p className="text-sm text-[#4a6080] max-w-xs">
              Describe your circuit and CircuitForge will design it with real parts from JLCPCB.
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-4 py-3 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-[#1a2a44] text-[#c0d8f0] border border-[#2a3a54]"
                  : "bg-[#0d1520] text-[#94a8c0] border border-[#152030]"
              }`}
            >
              <pre className="whitespace-pre-wrap font-sans wrap-break-word">
                {msg.content}
              </pre>
            </div>
          </div>
        ))}

        {isStreaming && (
          <div className="flex items-center gap-2 text-xs text-[#00d4ff]">
            <span className="inline-block w-1.5 h-1.5 bg-[#00d4ff] rounded-full animate-pulse" />
            CircuitForge is thinking...
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-[#1a2236]">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Describe your circuit..."
            disabled={isStreaming}
            className="flex-1 bg-[#0d1520] border border-[#1a2a44] rounded-lg px-4 py-2.5 text-sm text-[#c0d8f0] placeholder-[#3a5070] focus:outline-none focus:border-[#00d4ff] focus:ring-1 focus:ring-[#00d4ff]/20 transition-colors disabled:opacity-50"
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={onStop}
              className="px-4 py-2.5 bg-[#ff4444]/10 border border-[#ff4444]/30 text-[#ff4444] rounded-lg text-sm font-medium hover:bg-[#ff4444]/20 transition-colors"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="px-4 py-2.5 bg-[#00d4ff]/10 border border-[#00d4ff]/30 text-[#00d4ff] rounded-lg text-sm font-medium hover:bg-[#00d4ff]/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Send
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
