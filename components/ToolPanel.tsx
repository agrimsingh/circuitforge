"use client";

import { useRef, useEffect, useState } from "react";
import type { ToolEvent } from "@/lib/stream/useAgentStream";

interface ToolPanelProps {
  events: ToolEvent[];
}

function ToolEntry({ event }: { event: ToolEvent }) {
  const [expanded, setExpanded] = useState(false);
  const duration =
    event.finishedAt && event.startedAt
      ? ((event.finishedAt - event.startedAt) / 1000).toFixed(1)
      : null;

  return (
    <div
      className="border border-[#1a2236] rounded-lg overflow-hidden cursor-pointer hover:border-[#2a3a54] transition-colors"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-center gap-3 px-3 py-2">
        <div
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            event.status === "running"
              ? "bg-amber-400 animate-pulse"
              : "bg-emerald-400"
          }`}
        />
        <span className="text-xs font-mono text-[#94a8c0] truncate flex-1">
          {event.tool}
        </span>
        {duration && (
          <span className="text-[10px] font-mono text-[#3a5070] shrink-0">
            {duration}s
          </span>
        )}
        <span className="text-[10px] text-[#3a5070]">
          {expanded ? "▲" : "▼"}
        </span>
      </div>

      {expanded && event.input != null && (
        <div className="border-t border-[#1a2236] px-3 py-2">
          <pre className="text-[10px] font-mono text-[#4a6080] whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
            {String(
              typeof event.input === "string"
                ? event.input
                : JSON.stringify(event.input, null, 2)
            )}
          </pre>
        </div>
      )}

      {expanded && event.output != null && (
        <div className="border-t border-[#1a2236] px-3 py-2">
          <pre className="text-[10px] font-mono text-[#5a8060] whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
            {String(
              typeof event.output === "string"
                ? event.output.slice(0, 500)
                : JSON.stringify(event.output, null, 2).slice(0, 500)
            )}
          </pre>
        </div>
      )}
    </div>
  );
}

export function ToolPanel({ events }: ToolPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [events]);

  return (
    <div className="flex flex-col h-full bg-[#080c14]">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a2236]">
        <div
          className={`w-2 h-2 rounded-full ${
            events.some((e) => e.status === "running")
              ? "bg-amber-400 animate-pulse"
              : "bg-[#2a3a54]"
          }`}
        />
        <span className="text-xs font-mono uppercase tracking-widest text-[#4a6080]">
          Tools
        </span>
        {events.length > 0 && (
          <span className="text-[10px] font-mono text-[#3a5070] ml-auto">
            {events.length}
          </span>
        )}
      </div>

      {/* Events */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 scrollbar-thin">
        {events.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-[#2a3a54] font-mono">No tool activity yet</p>
          </div>
        ) : (
          events.map((event) => <ToolEntry key={event.id} event={event} />)
        )}
      </div>
    </div>
  );
}
