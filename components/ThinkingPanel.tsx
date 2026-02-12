"use client";

import { useRef, useEffect } from "react";

interface ThinkingPanelProps {
  text: string;
  isStreaming: boolean;
}

export function ThinkingPanel({ text, isStreaming }: ThinkingPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
    });
  }, [text]);

  return (
    <div className="flex flex-col h-full bg-[#080c14]">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a2236]">
        <div
          className={`size-2 rounded-full ${
            isStreaming && text ? "bg-amber-400 animate-pulse" : "bg-[#2a3a54]"
          }`}
        />
        <span className="text-xs font-mono uppercase tracking-widest text-[#4a6080]">
          Reasoning
        </span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 scrollbar-thin">
        {text ? (
          <pre className="text-xs font-mono text-[#5a7090] whitespace-pre-wrap leading-relaxed">
            {text}
          </pre>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-[#2a3a54] font-mono">
              {isStreaming ? "Waiting for reasoning..." : "No reasoning data yet"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
