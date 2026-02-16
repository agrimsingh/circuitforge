"use client";

import { Panel, Group, Separator } from "react-resizable-panels";
import { useAgentStream } from "@/lib/stream/useAgentStream";
import { ChatPanel } from "@/components/ChatPanel";
import { InfoPanel } from "@/components/InfoPanel";
import { CircuitPanel } from "@/components/CircuitPanel";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useState, useCallback } from "react";
import { PanelRightIcon } from "lucide-react";
import { motion } from "motion/react";

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
  const [showDrawer, setShowDrawer] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [showExportChecklist, setShowExportChecklist] = useState(false);

  const hasCode = Boolean(circuitCode) || architecture.length > 0;

  const openCriticalFindings = reviewFindings.filter(
    (finding) => finding.status === "open" && finding.severity === "critical",
  ).length;

  const openFindingsCount = reviewFindings.filter((f) => f.status === "open").length;

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

  const handleSend = useCallback(
    (prompt: string) => {
      sendPrompt(prompt, circuitCode || undefined, { phase });
    },
    [sendPrompt, circuitCode, phase]
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

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <span className="text-foreground text-sm font-semibold tracking-tight">Circuit</span>
            <span className="text-accent text-sm font-semibold tracking-tight">Forge</span>
          </div>
          <span className="text-[9px] font-mono text-accent/40 bg-accent/5 border border-accent/10 rounded px-1.5 py-0.5">
            v0.1
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-muted-foreground/70 uppercase tracking-wider">
            {phase}
          </span>
          {isStreaming && phaseProgress > 0 && (
            <div className="w-16 h-1 rounded-full bg-border/40 overflow-hidden">
              <motion.div
                className="h-full bg-accent/60 rounded-full"
                animate={{ width: `${phaseProgress}%` }}
                transition={{ type: "spring", damping: 25, stiffness: 200 }}
              />
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {costUsd !== null && (
            <span className="text-[10px] font-mono text-accent/60">
              ${costUsd.toFixed(4)}
            </span>
          )}
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
          <button
            onClick={() => setShowDrawer(true)}
            className="relative flex items-center justify-center size-8 rounded-md border border-border/40 bg-surface-raised/50 text-muted-foreground transition-colors hover:text-foreground hover:border-accent/20"
            aria-label="Open workflow details"
          >
            <PanelRightIcon className="size-4" />
            {openFindingsCount > 0 && (
              <span className="absolute -top-1 -right-1 flex items-center justify-center size-4 rounded-full bg-accent text-[9px] font-mono text-accent-foreground font-medium">
                {openFindingsCount > 9 ? "9+" : openFindingsCount}
              </span>
            )}
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        {!hasCode ? (
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
        ) : (
          <Group orientation="horizontal" className="h-full">
            <Panel defaultSize={40} minSize={25}>
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

            <Panel defaultSize={60} minSize={35}>
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
                  architecture={architecture}
                />
              </ErrorBoundary>
            </Panel>
          </Group>
        )}
      </main>

      <Sheet open={showDrawer} onOpenChange={setShowDrawer}>
        <SheetContent side="right" className="overflow-hidden flex flex-col">
          <SheetHeader>
            <SheetTitle>Workflow</SheetTitle>
            <SheetDescription>
              Phase progress, tools, requirements, and review findings
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-hidden">
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
          </div>
        </SheetContent>
      </Sheet>

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
