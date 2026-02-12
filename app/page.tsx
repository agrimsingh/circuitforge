"use client";

import {
  Panel,
  Group,
  Separator,
} from "react-resizable-panels";
import { useAgentStream } from "@/lib/stream/useAgentStream";
import { ChatPanel } from "@/components/ChatPanel";
import { ThinkingPanel } from "@/components/ThinkingPanel";
import { ToolPanel } from "@/components/ToolPanel";
import { CircuitPanel } from "@/components/CircuitPanel";
import { useState, useCallback } from "react";

export default function Home() {
  const agent = useAgentStream();
  const [isExporting, setIsExporting] = useState(false);

  const handleSend = useCallback(
    (prompt: string) => {
      agent.sendPrompt(prompt, agent.circuitCode || undefined);
    },
    [agent]
  );

  const handleExport = useCallback(async () => {
    if (!agent.circuitCode) return;
    setIsExporting(true);

    try {
      // Step 1: Compile tscircuit code to Circuit JSON
      const compileRes = await fetch(
        "https://compile.tscircuit.com/api/compile",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fs_map: { "main.tsx": agent.circuitCode },
          }),
        }
      );

      if (!compileRes.ok) {
        throw new Error(`Compile failed: ${compileRes.status}`);
      }

      const { circuit_json } = await compileRes.json();

      // Step 2: Convert to manufacturing files
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

      // Step 3: Download zip
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
      alert(
        `Export error: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    } finally {
      setIsExporting(false);
    }
  }, [agent.circuitCode]);

  return (
    <div className="h-screen flex flex-col blueprint-grid">
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-3 border-b border-[#1a2236] bg-[#060a12]/90 backdrop-blur-sm z-10">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-[#00d4ff] text-lg font-bold tracking-tight">
              Circuit
            </span>
            <span className="text-[#b87333] text-lg font-bold tracking-tight">
              Forge
            </span>
          </div>
          <span className="text-[10px] font-mono text-[#2a3a54] border border-[#1a2236] rounded px-1.5 py-0.5">
            v0.1
          </span>
        </div>

        <div className="flex items-center gap-3">
          {agent.costUsd !== null && (
            <span className="text-[10px] font-mono text-[#3a5070]">
              ${agent.costUsd.toFixed(4)}
            </span>
          )}
          {agent.isStreaming && (
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 bg-[#00d4ff] rounded-full animate-pulse" />
              <span className="text-[10px] font-mono text-[#4a6080]">
                Streaming
              </span>
            </div>
          )}
          {agent.error && (
            <span className="text-[10px] font-mono text-red-400 max-w-xs truncate">
              {agent.error}
            </span>
          )}
        </div>
      </header>

      {/* Main panels */}
      <main className="flex-1 overflow-hidden">
        <Group orientation="horizontal" className="h-full">
          {/* Left: Chat */}
          <Panel defaultSize={38} minSize={25}>
            <ChatPanel
              messages={agent.messages}
              isStreaming={agent.isStreaming}
              onSend={handleSend}
              onStop={agent.stop}
            />
          </Panel>

          <Separator className="w-[3px] hover:bg-[#00d4ff]/10 transition-colors" />

          {/* Right: 3 vertical panels */}
          <Panel defaultSize={62} minSize={35}>
            <Group orientation="vertical" className="h-full">
              {/* Thinking */}
              <Panel defaultSize={25} minSize={10} collapsible>
                <ThinkingPanel
                  text={agent.thinkingText}
                  isStreaming={agent.isStreaming}
                />
              </Panel>

              <Separator className="h-[3px] hover:bg-[#00d4ff]/10 transition-colors" />

              {/* Tool Activity */}
              <Panel defaultSize={25} minSize={10} collapsible>
                <ToolPanel events={agent.toolEvents} />
              </Panel>

              <Separator className="h-[3px] hover:bg-[#00d4ff]/10 transition-colors" />

              {/* Circuit */}
              <Panel defaultSize={50} minSize={20}>
                <CircuitPanel
                  code={agent.circuitCode}
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
