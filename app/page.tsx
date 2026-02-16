"use client";

import { Panel, Group, Separator } from "react-resizable-panels";
import { useAgentStream } from "@/lib/stream/useAgentStream";
import { ChatPanel } from "@/components/ChatPanel";
import { InfoPanel } from "@/components/InfoPanel";
import { CircuitPanel } from "@/components/CircuitPanel";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useState, useCallback, useEffect } from "react";
import type { DesignPhase } from "@/lib/stream/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
    iterationDiffs,
    finalSummary,
    timingMetrics,
    repairPlans,
    repairResults,
    sendPrompt,
    stop,
    setReviewDecision,
    systemEvents,
  } = useAgentStream();
  const [isExporting, setIsExporting] = useState(false);
  const [exportStage, setExportStage] = useState<"compiling" | "packaging" | "downloading" | null>(null);
  const [activePhase, setActivePhase] = useState<DesignPhase>("implementation");
  const [isCompact, setIsCompact] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [showExportChecklist, setShowExportChecklist] = useState(false);

  const openCriticalFindings = reviewFindings.filter(
    (finding) => finding.status === "open" && finding.severity === "critical",
  ).length;
  const exportChecks = [
    { label: "Circuit code generated", passed: Boolean(circuitCode) },
    { label: "No open critical findings", passed: openCriticalFindings === 0 },
    { label: "Validation clean", passed: finalSummary ? finalSummary.diagnosticsCount === 0 : false },
    {
      label: "Readiness score >= 70",
      passed: finalSummary ? finalSummary.manufacturingReadinessScore >= 70 : false,
    },
  ];
  const hasExportBlockers = exportChecks.some((item) => !item.passed);

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

  const performExport = useCallback(async (allowRiskyExport: boolean) => {
    if (!circuitCode) return;
    setIsExporting(true);
    setExportStage("compiling");

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

      setExportStage("packaging");

      const exportRes = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          circuit_json,
          formatSet: { kicad: true, reviewBundle: true },
          readiness: {
            criticalFindingsCount: openCriticalFindings,
            allowRiskyExport,
            readinessScore: finalSummary?.manufacturingReadinessScore ?? null,
          },
        }),
      });
      if (!exportRes.ok) {
        const body: Record<string, unknown> = await exportRes.json().catch(() => ({}));
        throw new Error(
          typeof body.error === "string" ? body.error : `Export failed: ${exportRes.status}`
        );
      }

      setExportStage("downloading");

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
      setNotification(`Export error: ${err instanceof Error ? err.message : "Unknown error"}`);
      setTimeout(() => setNotification(null), 5000);
    } finally {
      setIsExporting(false);
      setExportStage(null);
    }
  }, [circuitCode, finalSummary?.manufacturingReadinessScore, openCriticalFindings]);

  const handleExport = useCallback(async () => {
    if (!circuitCode) return;
    if (hasExportBlockers) {
      setShowExportChecklist(true);
      return;
    }
    await performExport(false);
  }, [circuitCode, hasExportBlockers, performExport]);

  const handleExportAnyway = useCallback(async () => {
    setShowExportChecklist(false);
    await performExport(true);
  }, [performExport]);

  const handleFixCriticalAndRerun = useCallback(() => {
    setShowExportChecklist(false);
    handleSend(
      "Fix all open critical findings first, rerun validation, then report readiness for export with minimal design changes.",
    );
  }, [handleSend]);

  return (
    <div className="h-dvh flex flex-col blueprint-grid">
      <header className="flex items-center justify-between px-5 py-2.5 border-b border-border/50 bg-surface/95 backdrop-blur-sm z-10 relative">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-linear-to-r from-transparent via-accent/20 to-transparent" />
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-0.5">
            <span className="text-foreground text-sm font-semibold">Circuit</span>
            <span className="text-accent text-sm font-semibold">Forge</span>
          </div>
          <span className="text-[9px] font-mono text-accent/40 bg-accent/5 border border-accent/10 rounded px-1.5 py-0.5">
            v0.1
          </span>
        </div>

        <div className="flex items-center gap-3">
          {costUsd !== null && (
            <span className="text-[10px] font-mono text-accent/60">
              ${costUsd.toFixed(4)}
            </span>
          )}
          <Select value={activePhase} onValueChange={(value) => setActivePhase(value as DesignPhase)}>
            <SelectTrigger className="h-7 w-auto gap-1 text-[10px] bg-surface-raised border-border text-secondary-foreground">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="requirements">Requirements</SelectItem>
              <SelectItem value="architecture">Architecture</SelectItem>
              <SelectItem value="implementation">Implementation</SelectItem>
              <SelectItem value="review">Review</SelectItem>
              <SelectItem value="export">Export</SelectItem>
            </SelectContent>
          </Select>
          {isStreaming && (
            <div className="flex items-center gap-1.5">
              <span className="inline-block size-1.5 bg-accent rounded-full animate-pulse shadow-[0_0_6px_rgba(6,182,212,0.4)]" />
              <span className="text-[10px] font-mono text-accent/70">Streaming</span>
            </div>
          )}
          {error && (
            <span className="text-[10px] font-mono text-destructive max-w-xs truncate">
              {error}
            </span>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        {isCompact ? (
          <Group orientation="vertical" className="h-full">
            <Panel defaultSize={30} minSize={20}>
              <ErrorBoundary fallbackLabel="Chat">
                <ChatPanel
                  messages={messages}
                  thinkingText={thinkingText}
                  toolEvents={toolEvents}
                  phaseSteps={phaseSteps}
                  gateEvents={gateEvents}
                  isStreaming={isStreaming}
                  onSend={handleSend}
                  onStop={stop}
                  phaseMessage={phaseMessage}
                  phaseProgress={phaseProgress}
                  retryTelemetry={retryTelemetry}
                  systemEvents={systemEvents}
                />
              </ErrorBoundary>
            </Panel>

            <Separator className="h-[3px] hover:bg-foreground/5 transition-colors" />

            <Panel defaultSize={40} minSize={25}>
              <ErrorBoundary fallbackLabel="Circuit">
                <CircuitPanel
                  code={circuitCode}
                  onExport={handleExport}
                  isExporting={isExporting}
                  isStreaming={isStreaming}
                  exportStage={exportStage}
                  title="Artifact"
                  description={phaseMessage ?? `Phase ${phase}`}
                  readinessScore={finalSummary?.manufacturingReadinessScore ?? null}
                  openCriticalFindings={openCriticalFindings}
                />
              </ErrorBoundary>
            </Panel>

            <Separator className="h-[3px] hover:bg-foreground/5 transition-colors" />

            <Panel defaultSize={30} minSize={20} collapsible>
              <ErrorBoundary fallbackLabel="Info">
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
                  iterationDiffs={iterationDiffs}
                  finalSummary={finalSummary}
                  timingMetrics={timingMetrics}
                  repairPlans={repairPlans}
                  repairResults={repairResults}
                  phaseSteps={phaseSteps}
                  gateEvents={gateEvents}
                  onReviewDecision={setReviewDecision}
                  onSend={handleSend}
                />
              </ErrorBoundary>
            </Panel>
          </Group>
        ) : (
          <Group orientation="horizontal" className="h-full">
            <Panel defaultSize={30} minSize={20}>
              <ErrorBoundary fallbackLabel="Chat">
                <ChatPanel
                  messages={messages}
                  thinkingText={thinkingText}
                  toolEvents={toolEvents}
                  phaseSteps={phaseSteps}
                  gateEvents={gateEvents}
                  isStreaming={isStreaming}
                  onSend={handleSend}
                  onStop={stop}
                  phaseMessage={phaseMessage}
                  phaseProgress={phaseProgress}
                  retryTelemetry={retryTelemetry}
                  systemEvents={systemEvents}
                />
              </ErrorBoundary>
            </Panel>

            <Separator className="w-[3px] hover:bg-foreground/5 transition-colors" />

            <Panel defaultSize={70} minSize={40}>
              <Group orientation="vertical" className="h-full">
                <Panel defaultSize={70} minSize={30}>
                  <ErrorBoundary fallbackLabel="Circuit">
                    <CircuitPanel
                      code={circuitCode}
                      onExport={handleExport}
                      isExporting={isExporting}
                      isStreaming={isStreaming}
                      exportStage={exportStage}
                      title="Artifact"
                      description={phaseMessage ?? `Phase ${phase}`}
                      readinessScore={finalSummary?.manufacturingReadinessScore ?? null}
                      openCriticalFindings={openCriticalFindings}
                    />
                  </ErrorBoundary>
                </Panel>

                <Separator className="h-[3px] hover:bg-foreground/5 transition-colors" />

                <Panel defaultSize={30} minSize={10} collapsible>
                  <ErrorBoundary fallbackLabel="Info">
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
                      iterationDiffs={iterationDiffs}
                      finalSummary={finalSummary}
                      timingMetrics={timingMetrics}
                      repairPlans={repairPlans}
                      repairResults={repairResults}
                      phaseSteps={phaseSteps}
                      gateEvents={gateEvents}
                      onReviewDecision={setReviewDecision}
                      onSend={handleSend}
                    />
                  </ErrorBoundary>
                </Panel>
              </Group>
            </Panel>
          </Group>
        )}
      </main>

      {showExportChecklist && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-surface-raised p-4">
            <h3 className="text-sm font-semibold text-foreground">Export readiness checklist</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Resolve blockers for a safer manufacturing bundle, or force export anyway.
            </p>
            <ul className="mt-3 space-y-2">
              {exportChecks.map((item) => (
                <li key={item.label} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{item.label}</span>
                  <span className={item.passed ? "text-success" : "text-warning"}>
                    {item.passed ? "pass" : "block"}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                onClick={() => setShowExportChecklist(false)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-secondary-foreground hover:bg-surface"
              >
                Cancel
              </button>
              <button
                onClick={handleFixCriticalAndRerun}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-info hover:bg-surface"
              >
                Fix critical + rerun
              </button>
              <button
                onClick={handleExportAnyway}
                className="rounded-md bg-accent px-3 py-1.5 text-xs text-accent-foreground hover:opacity-90"
              >
                Export anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {notification && (
        <div role="alert" aria-live="polite" className="fixed bottom-4 right-4 z-40 rounded-lg border border-destructive/30 bg-surface-raised px-4 py-3 text-sm text-destructive">
          {notification}
          <button aria-label="Dismiss" onClick={() => setNotification(null)} className="ml-3 text-muted-foreground hover:text-foreground">✕</button>
        </div>
      )}
    </div>
  );
}
