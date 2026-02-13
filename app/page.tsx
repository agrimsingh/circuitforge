"use client";

import { Panel, Group, Separator } from "react-resizable-panels";
import { useAgentStream } from "@/lib/stream/useAgentStream";
import { ChatPanel } from "@/components/ChatPanel";
import { InfoPanel } from "@/components/InfoPanel";
import { CircuitPanel } from "@/components/CircuitPanel";
import { useState, useCallback, useEffect } from "react";
import type { DesignPhase } from "@/lib/stream/types";

export default function Home() {
  const {
    messages,
    thinkingText,
    toolEvents,
    phaseSteps,
    gateEvents,
    circuitCode,
    isStreaming,
    error,
    costUsd,
    retryTelemetry,
    phase,
    phaseProgress,
    phaseMessage,
    requirements,
    architecture,
    reviewFindings,
    sendPrompt,
    stop,
    setReviewDecision,
  } = useAgentStream();
  const [isExporting, setIsExporting] = useState(false);
  const [activePhase, setActivePhase] = useState<DesignPhase>("implementation");
  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const handleChange = (event: MediaQueryListEvent) => setIsCompact(event.matches);
    setIsCompact(media.matches);

    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  const handleSend = useCallback(
    (prompt: string) => {
      sendPrompt(prompt, circuitCode || undefined, { phase: activePhase });
    },
    [sendPrompt, circuitCode, activePhase]
  );

  const handleExport = useCallback(async () => {
    if (!circuitCode) return;
    setIsExporting(true);

    try {
      const compileRes = await fetch(
        "https://compile.tscircuit.com/api/compile",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fs_map: { "main.tsx": circuitCode } }),
        }
      );
      if (!compileRes.ok) throw new Error(`Compile failed: ${compileRes.status}`);
      const { circuit_json } = await compileRes.json();

      const exportRes = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ circuit_json, formatSet: { kicad: true, reviewBundle: true } }),
      });
      if (!exportRes.ok) {
        const body: Record<string, unknown> = await exportRes.json().catch(() => ({}));
        throw new Error(
          typeof body.error === "string" ? body.error : `Export failed: ${exportRes.status}`
        );
      }

      const blob = await exportRes.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "circuitforge-export.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`Export error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setIsExporting(false);
    }
  }, [circuitCode]);

  return (
    <div className="h-dvh flex flex-col blueprint-grid">
      <header className="flex items-center justify-between px-5 py-3 border-b border-[#1a2236] bg-[#060a12]/90 backdrop-blur-sm z-10">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-[#00d4ff] text-lg font-bold tracking-tight">Circuit</span>
            <span className="text-[#b87333] text-lg font-bold tracking-tight">Forge</span>
          </div>
          <span className="text-[10px] font-mono text-[#2a3a54] border border-[#1a2236] rounded px-1.5 py-0.5">
            v0.1
          </span>
        </div>

        <div className="flex items-center gap-3">
          {costUsd !== null && (
            <span className="text-[10px] font-mono text-[#3a5070]">
              ${costUsd.toFixed(4)}
            </span>
          )}
          <select
            value={activePhase}
            onChange={(event) => setActivePhase(event.target.value as DesignPhase)}
            className="text-[10px] bg-[#0b1322] border border-[#1a2236] rounded px-2 py-1 text-[#94a8c0]"
          >
            <option value="requirements">Requirements</option>
            <option value="architecture">Architecture</option>
            <option value="implementation">Implementation</option>
            <option value="review">Review</option>
            <option value="export">Export</option>
          </select>
          {isStreaming && (
            <div className="flex items-center gap-1.5">
              <span className="inline-block size-1.5 bg-[#00d4ff] rounded-full animate-pulse" />
              <span className="text-[10px] font-mono text-[#4a6080]">Streaming</span>
            </div>
          )}
          {error && (
            <span className="text-[10px] font-mono text-red-400 max-w-xs truncate">
              {error}
            </span>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        {isCompact ? (
          <Group orientation="vertical" className="h-full">
            <Panel defaultSize={30} minSize={20}>
              <ChatPanel
                messages={messages}
                thinkingText={thinkingText}
                toolEvents={toolEvents}
                phaseSteps={phaseSteps}
                gateEvents={gateEvents}
                isStreaming={isStreaming}
                onSend={handleSend}
                onStop={stop}
              />
            </Panel>

            <Separator className="h-[3px] hover:bg-[#00d4ff]/10 transition-colors" />

            <Panel defaultSize={40} minSize={25}>
              <CircuitPanel
                code={circuitCode}
                onExport={handleExport}
                isExporting={isExporting}
                title="Artifact"
                description={phaseMessage ?? `Phase ${phase}`}
              />
            </Panel>

            <Separator className="h-[3px] hover:bg-[#00d4ff]/10 transition-colors" />

            <Panel defaultSize={30} minSize={20} collapsible>
              <InfoPanel
                activityText={thinkingText}
                toolEvents={toolEvents}
                isStreaming={isStreaming}
                retryTelemetry={retryTelemetry}
                phase={phase}
                phaseProgress={phaseProgress}
                phaseMessage={phaseMessage}
                requirements={requirements}
                architecture={architecture}
                reviewFindings={reviewFindings}
                phaseSteps={phaseSteps}
                gateEvents={gateEvents}
                onReviewDecision={setReviewDecision}
                onSend={handleSend}
              />
            </Panel>
          </Group>
        ) : (
          <Group orientation="horizontal" className="h-full">
            <Panel defaultSize={30} minSize={20}>
              <ChatPanel
                messages={messages}
                thinkingText={thinkingText}
                toolEvents={toolEvents}
                phaseSteps={phaseSteps}
                gateEvents={gateEvents}
                isStreaming={isStreaming}
                onSend={handleSend}
                onStop={stop}
              />
            </Panel>

            <Separator className="w-[3px] hover:bg-[#00d4ff]/10 transition-colors" />

            <Panel defaultSize={70} minSize={40}>
              <Group orientation="vertical" className="h-full">
                <Panel defaultSize={70} minSize={30}>
                  <CircuitPanel
                    code={circuitCode}
                    onExport={handleExport}
                    isExporting={isExporting}
                    title="Artifact"
                    description={phaseMessage ?? `Phase ${phase}`}
                  />
                </Panel>

                <Separator className="h-[3px] hover:bg-[#00d4ff]/10 transition-colors" />

                <Panel defaultSize={30} minSize={10} collapsible>
                  <InfoPanel
                    activityText={thinkingText}
                    toolEvents={toolEvents}
                    isStreaming={isStreaming}
                    retryTelemetry={retryTelemetry}
                    phase={phase}
                    phaseProgress={phaseProgress}
                    phaseMessage={phaseMessage}
                    requirements={requirements}
                    architecture={architecture}
                    reviewFindings={reviewFindings}
                    phaseSteps={phaseSteps}
                    gateEvents={gateEvents}
                    onReviewDecision={setReviewDecision}
                    onSend={handleSend}
                  />
                </Panel>
              </Group>
            </Panel>
          </Group>
        )}
      </main>
    </div>
  );
}
