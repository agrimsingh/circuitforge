"use client";

import { useRef, useEffect, useMemo, useState } from "react";
import type { ToolEvent, RetryTelemetry } from "@/lib/stream/useAgentStream";
import type {
  DesignPhase,
  RequirementItem,
  ArchitectureNode,
  ReviewFinding,
} from "@/lib/stream/types";
import { ArchitecturePanel } from "./ArchitecturePanel";

type Tab = "activity" | "tools" | "status" | "review";

interface InfoPanelProps {
  activityText: string;
  toolEvents: ToolEvent[];
  isStreaming: boolean;
  retryTelemetry: RetryTelemetry | null;
  phase: DesignPhase;
  phaseProgress: number;
  phaseMessage: string | null;
  requirements: RequirementItem[];
  architecture: ArchitectureNode[];
  reviewFindings: ReviewFinding[];
  onReviewDecision: (
    findingId: string,
    decision: "accept" | "dismiss",
    reason?: string
  ) => void;
}

function formatCategoryLabel(category: string) {
  return category.replaceAll("_", " ");
}

function phaseLabel(phase: DesignPhase) {
  return phase.charAt(0).toUpperCase() + phase.slice(1);
}

function phaseBadgeClass(phase: DesignPhase) {
  if (phase === "requirements") return "bg-[#2a7bf6]/20 text-[#7aa9ff] border-[#7aa9ff]/30";
  if (phase === "architecture") return "bg-[#2ab0d4]/20 text-[#6fd8ff] border-[#6fd8ff]/30";
  if (phase === "implementation") return "bg-[#2ad486]/20 text-[#8df5b9] border-[#8df5b9]/30";
  if (phase === "review") return "bg-[#d4c52a]/20 text-[#f4e38a] border-[#f4e38a]/30";
  return "bg-[#ff9a46]/20 text-[#ffd08c] border-[#ffd08c]/30";
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
  retryTelemetry,
  phase,
  phaseProgress,
  phaseMessage,
  requirements,
  architecture,
  reviewFindings,
  onReviewDecision,
}: InfoPanelProps) {
  const [tab, setTab] = useState<Tab>("activity");
  const activityScrollRef = useRef<HTMLDivElement>(null);
  const toolScrollRef = useRef<HTMLDivElement>(null);
  const statusScrollRef = useRef<HTMLDivElement>(null);
  const openFindings = useMemo(
    () => reviewFindings.filter((finding) => finding.status === "open"),
    [reviewFindings]
  );

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

  return (
    <div className="flex flex-col h-full bg-[#080c14]">
      <div className="flex items-center gap-1 px-4 py-2 border-b border-[#1a2236] overflow-x-auto">
        {(
          [
            "activity",
            "tools",
            "status",
            "review",
          ] as Tab[]
        ).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono uppercase tracking-wider whitespace-nowrap transition-colors ${
              tab === t
                ? "bg-[#1a2a44] text-[#00d4ff] border border-[#00d4ff]/20"
                : "text-[#4a6080] hover:text-[#94a8c0] border border-transparent"
            }`}
          >
            <div
              className={`size-1.5 rounded-full ${
                t === "activity"
                  ? activityText
                    ? "bg-amber-400 animate-pulse"
                    : "bg-[#2a3a54]"
                  : t === "tools"
                    ? toolEvents.some((event) => event.status === "running")
                      ? "bg-amber-400 animate-pulse"
                      : "bg-[#2a3a54]"
                    : t === "review"
                      ? openFindings.length > 0
                        ? "bg-amber-400 animate-pulse"
                        : "bg-[#2a3a54]"
                      : "bg-[#2a3a54]"
              }`}
            />
            {t}
            {t === "tools" && toolEvents.length > 0 && (
              <span className="text-[10px] font-mono text-[#3a5070]">{toolEvents.length}</span>
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
              <div className="space-y-3">
                {retryTelemetry && retryTelemetry.attemptsSeen > 0 && (
                  <div className="border border-[#1a2236] rounded-md p-2 bg-[#0b1322]">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-[#4a6080] mb-1">
                      Retry Telemetry
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] font-mono text-[#88a3c5]">
                      <span>
                        Attempts: {retryTelemetry.attemptsSeen}/
                        {retryTelemetry.maxAttempts || "?"}
                      </span>
                      <span>Status: {retryTelemetry.finalStatus ?? "running"}</span>
                      <span>Total diagnostics: {retryTelemetry.diagnosticsTotal}</span>
                      <span>
                        First error:{" "}
                        {retryTelemetry.firstErrorCategory
                          ? formatCategoryLabel(retryTelemetry.firstErrorCategory)
                          : "none"}
                      </span>
                      {retryTelemetry.finalReason && (
                        <span className="col-span-2">
                          Stop reason: {retryTelemetry.finalReason}
                        </span>
                      )}
                      {Object.keys(retryTelemetry.diagnosticsByCategory).length > 0 && (
                        <span className="col-span-2">
                          Categories:{" "}
                          {Object.entries(retryTelemetry.diagnosticsByCategory)
                            .sort((a, b) => b[1] - a[1])
                            .map(
                              ([category, count]) =>
                                `${formatCategoryLabel(category)} (${count})`
                            )
                            .join(", ")}
                        </span>
                      )}
                    </div>
                  </div>
                )}
                <pre className="text-xs font-mono text-[#5a7090] whitespace-pre-wrap leading-relaxed">
                  {activityText}
                </pre>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full">
                <p className="text-xs text-[#2a3a54] font-mono">
                  {isStreaming ? "Waiting for activity..." : "No activity yet"}
                </p>
              </div>
            )}
          </div>
        ) : tab === "tools" ? (
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
              toolEvents.map((event) => <ToolEntry key={event.id} event={event} />)
            )}
          </div>
        ) : tab === "status" ? (
          <div
            ref={statusScrollRef}
            className="h-full overflow-y-auto p-4 space-y-3 scrollbar-thin"
          >
            <div className="border border-[#1a2236] rounded-md p-2 bg-[#0b1322]">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-[#4a6080] uppercase tracking-wider">
                  Current phase
                </span>
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${phaseBadgeClass(phase)}`}
                >
                  {phaseLabel(phase)}
                </span>
              </div>
              <div className="text-[11px] text-[#88a3c5] mt-2">{phaseMessage || ""}</div>
              <div className="h-2 bg-[#101a28] rounded-full mt-2 overflow-hidden">
                <div
                  className="h-full bg-[#00d4ff] transition-all"
                  style={{ width: `${phaseProgress}%` }}
                />
              </div>
            </div>

            <div className="border border-[#1a2236] rounded-md p-2 bg-[#0b1322]">
              <div className="text-xs font-mono text-[#4a6080] uppercase tracking-wider">
                Requirements
              </div>
              {requirements.length === 0 ? (
                <p className="text-xs text-[#2a3a54] mt-2">
                  No requirements captured yet
                </p>
              ) : (
                <ul className="mt-2 text-xs text-[#88a3c5] space-y-1">
                  {requirements.map((item) => (
                    <li key={item.id}>• {item.title}</li>
                  ))}
                </ul>
              )}
            </div>

            <ArchitecturePanel blocks={architecture} />
          </div>
        ) : (
          <div className="h-full overflow-y-auto p-3 space-y-2">
            {openFindings.length === 0 ? (
              <div className="text-xs text-[#2a3a54] font-mono">No open findings</div>
            ) : (
              openFindings.map((finding) => (
                <div
                  key={finding.id}
                  className="border border-[#1a2236] rounded-lg bg-[#0b1322] px-3 py-2"
                >
                  <div className="text-xs font-mono text-[#88a3c5]">
                    {finding.category} · {finding.phase}
                  </div>
                  <p className="text-xs mt-1 text-[#5a7090]">{finding.message}</p>
                  {finding.suggestion && (
                    <p className="text-[11px] mt-1 text-[#5f7ea0]">
                      Suggestion: {finding.suggestion}
                    </p>
                  )}
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => onReviewDecision(finding.id, "accept")}
                      className="px-2 py-1 text-[10px] border border-[#2a3a54] text-[#4fc77a] rounded"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => onReviewDecision(finding.id, "dismiss")}
                      className="px-2 py-1 text-[10px] border border-[#2a3a54] text-[#d4a85f] rounded"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

