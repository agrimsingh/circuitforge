"use client";

import { Panel, Group, Separator } from "react-resizable-panels";
import { useAgentStream } from "@/lib/stream/useAgentStream";
import { ChatPanel } from "@/components/ChatPanel";
import { ThinkingPanel } from "@/components/ThinkingPanel";
import { ToolPanel } from "@/components/ToolPanel";
import { CircuitPanel } from "@/components/CircuitPanel";
import { useState, useCallback } from "react";

export default function Home() {
  const {
    messages,
    thinkingText,
    toolEvents,
    circuitCode,
    isStreaming,
    error,
    costUsd,
    sendPrompt,
    stop,
  } = useAgentStream();
  const [isExporting, setIsExporting] = useState(false);

  const handleSend = useCallback(
    (prompt: string) => {
      sendPrompt(prompt, circuitCode || undefined);
    },
    [sendPrompt, circuitCode]
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
        body: JSON.stringify({ circuit_json }),
      });
      if (!exportRes.ok) {
        const err = await exportRes.json().catch(() => ({}));
        throw new Error(
          (err as { error?: string }).error ?? `Export failed: ${exportRes.status}`
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
        <Group orientation="horizontal" className="h-full">
          <Panel defaultSize={38} minSize={25}>
            <ChatPanel
              messages={messages}
              isStreaming={isStreaming}
              onSend={handleSend}
              onStop={stop}
            />
          </Panel>

          <Separator className="w-[3px] hover:bg-[#00d4ff]/10 transition-colors" />

          <Panel defaultSize={62} minSize={35}>
            <Group orientation="vertical" className="h-full">
              <Panel defaultSize={25} minSize={10} collapsible>
                <ThinkingPanel text={thinkingText} isStreaming={isStreaming} />
              </Panel>

              <Separator className="h-[3px] hover:bg-[#00d4ff]/10 transition-colors" />

              <Panel defaultSize={25} minSize={10} collapsible>
                <ToolPanel events={toolEvents} />
              </Panel>

              <Separator className="h-[3px] hover:bg-[#00d4ff]/10 transition-colors" />

              <Panel defaultSize={50} minSize={20}>
                <CircuitPanel
                  code={circuitCode}
                  onExport={handleExport}
                  isExporting={isExporting}
                />
              </Panel>
            </Group>
          </Panel>
        </Group>
      </main>
    </div>
  );
}
