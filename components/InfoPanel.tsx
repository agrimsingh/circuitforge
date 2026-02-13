"use client";

import { useRef, useEffect, useState } from "react";
import type { ToolEvent } from "@/lib/stream/useAgentStream";

type Tab = "activity" | "tools";

interface InfoPanelProps {
  activityText: string;
  toolEvents: ToolEvent[];
  isStreaming: boolean;
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
          className={`size-1.5 rounded-full shrink-0 ${
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

export function InfoPanel({
  activityText,
  toolEvents,
  isStreaming,
}: InfoPanelProps) {
  const [tab, setTab] = useState<Tab>("activity");
  const activityScrollRef = useRef<HTMLDivElement>(null);
  const toolScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    activityScrollRef.current?.scrollTo({
      top: activityScrollRef.current.scrollHeight,
    });
  }, [activityText]);

  useEffect(() => {
    toolScrollRef.current?.scrollTo({
      top: toolScrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [toolEvents]);

  const activityActive = isStreaming && activityText;
  const toolsActive = toolEvents.some((e) => e.status === "running");

  return (
    <div className="flex flex-col h-full bg-[#080c14]">
      <div className="flex items-center gap-1 px-4 py-2 border-b border-[#1a2236]">
        {(["activity", "tools"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono uppercase tracking-wider transition-colors ${
              tab === t
                ? "bg-[#1a2a44] text-[#00d4ff] border border-[#00d4ff]/20"
                : "text-[#4a6080] hover:text-[#94a8c0] border border-transparent"
            }`}
          >
            <div
              className={`size-1.5 rounded-full ${
                t === "activity"
                  ? activityActive
                    ? "bg-amber-400 animate-pulse"
                    : "bg-[#2a3a54]"
                  : toolsActive
                    ? "bg-amber-400 animate-pulse"
                    : "bg-[#2a3a54]"
              }`}
            />
            {t}
            {t === "tools" && toolEvents.length > 0 && (
              <span className="text-[10px] font-mono text-[#3a5070]">
                {toolEvents.length}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden">
        {tab === "activity" ? (
          <div
            ref={activityScrollRef}
            className="h-full overflow-y-auto p-4 scrollbar-thin"
          >
            {activityText ? (
              <pre className="text-xs font-mono text-[#5a7090] whitespace-pre-wrap leading-relaxed">
                {activityText}
              </pre>
            ) : (
              <div className="flex items-center justify-center h-full">
                <p className="text-xs text-[#2a3a54] font-mono">
                  {isStreaming ? "Waiting for activity..." : "No activity yet"}
                </p>
              </div>
            )}
          </div>
        ) : (
          <div
            ref={toolScrollRef}
            className="h-full overflow-y-auto p-3 space-y-2 scrollbar-thin"
          >
            {toolEvents.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-xs text-[#2a3a54] font-mono">
                  No tool activity yet
                </p>
              </div>
            ) : (
              toolEvents.map((event) => (
                <ToolEntry key={event.id} event={event} />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
