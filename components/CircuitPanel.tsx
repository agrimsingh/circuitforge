"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import dynamic from "next/dynamic";
import {
  Artifact,
  ArtifactAction,
  ArtifactActions,
  ArtifactContent,
  ArtifactDescription,
  ArtifactHeader,
  ArtifactTitle,
} from "@/components/ai-elements/artifact";
import { WebPreview } from "@/components/ai-elements/web-preview";
import { CheckIcon, CopyIcon, DownloadIcon, CpuIcon } from "lucide-react";
import type { ArchitectureNode } from "@/lib/stream/types";

const ArchitecturePanel = dynamic(
  () => import("./ArchitecturePanel").then((m) => ({ default: m.ArchitecturePanel })),
  { ssr: false }
);

interface CircuitPanelProps {
  code: string;
  onExport: () => void;
  isExporting: boolean;
  isStreaming?: boolean;
  exportStage?: "compiling" | "packaging" | "downloading" | null;
  title?: string;
  description?: string;
  readinessScore?: number | null;
  openCriticalFindings?: number;
  architecture?: ArchitectureNode[];
}

function RunFramePreview({ code }: { code: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const readyRef = useRef(false);
  const [iframeReady, setIframeReady] = useState(false);

  useEffect(() => {
    function sendCode() {
      iframeRef.current?.contentWindow?.postMessage(
        {
          runframe_type: "runframe_props_changed",
          runframe_props: {
            fsMap: { "main.tsx": code },
            mainComponentPath: "main.tsx",
          },
        },
        "*"
      );
    }

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.runframe_type === "runframe_ready_to_receive") {
        readyRef.current = true;
        setIframeReady(true);
        sendCode();
      }
    };

    setIframeReady(false);

    window.addEventListener("message", handleMessage);
    if (readyRef.current) {
      sendCode();
      setIframeReady(true);
    }

    return () => window.removeEventListener("message", handleMessage);
  }, [code]);

  return (
    <div className="relative size-full">
      <iframe
        ref={iframeRef}
        src="https://runframe.tscircuit.com/iframe.html"
        className="size-full border-0"
        title="Circuit Preview"
      />
      {!iframeReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface/80 backdrop-blur-sm">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-block size-3 rounded-full border-2 border-accent/40 border-t-accent animate-spin" />
            Rendering preview…
          </div>
        </div>
      )}
    </div>
  );
}

export function CircuitPanel({
  code,
  onExport,
  isExporting,
  isStreaming,
  exportStage,
  title = "Circuit Preview",
  description = "Generated artifact from the active assistant run",
  readinessScore = null,
  openCriticalFindings = 0,
  architecture = [],
}: CircuitPanelProps) {
  const [copied, setCopied] = useState(false);
  const [userTab, setUserTab] = useState<"circuit" | "architecture" | null>(null);
  const activeTab =
    userTab ?? (architecture.length > 0 && !code ? "architecture" : "circuit");

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      console.warn("Unable to copy code to clipboard.");
    }
  }, [code]);

  const exportLabel = exportStage
    ? exportStage === "compiling"
      ? "Compiling…"
      : exportStage === "packaging"
        ? "Packaging…"
        : "Downloading…"
    : isExporting
      ? "Exporting…"
      : "Export";

  return (
    <Artifact className="h-full bg-surface">
      <ArtifactHeader>
        <div className="space-y-0.5">
          <ArtifactTitle>{title}</ArtifactTitle>
          <ArtifactDescription>{description}</ArtifactDescription>
          {(readinessScore !== null || openCriticalFindings > 0) && (
            <div className="flex items-center gap-2 pt-1 text-[10px]">
              {readinessScore !== null && (
                <span className="rounded border border-border px-1.5 py-0.5 text-info">
                  readiness {readinessScore}/100
                </span>
              )}
              <span className="rounded border border-border px-1.5 py-0.5 text-warning">
                critical open {openCriticalFindings}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-surface p-0.5 border border-border/30">
          <button
            onClick={() => setUserTab("circuit")}
            className={`text-xs px-3 py-1 rounded-md transition-colors ${
              activeTab === "circuit"
                ? "bg-accent/15 text-accent font-medium"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Circuit
          </button>
          {architecture.length > 0 && (
            <button
              onClick={() => setUserTab("architecture")}
              className={`text-xs px-3 py-1 rounded-md transition-colors ${
                activeTab === "architecture"
                  ? "bg-accent/15 text-accent font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Architecture
            </button>
          )}
        </div>

        <ArtifactActions>
          <ArtifactAction
            aria-label={copied ? "Copied" : "Copy code"}
            icon={copied ? CheckIcon : CopyIcon}
            onClick={handleCopy}
            disabled={!code}
            tooltip={copied ? "Copied!" : "Copy circuit code"}
            label={copied ? "Copied!" : "Copy"}
          />
          <ArtifactAction
            aria-label={exportLabel === "Export" ? "Export artifact" : exportLabel}
            icon={DownloadIcon}
            onClick={onExport}
            disabled={!code || isExporting || !!exportStage}
            tooltip={exportLabel}
            label={exportLabel}
          >
            {exportLabel}
          </ArtifactAction>
        </ArtifactActions>
      </ArtifactHeader>

      <ArtifactContent className="h-full p-0">
        {activeTab === "architecture" && architecture.length > 0 ? (
          <div className="h-full">
            <ArchitecturePanel blocks={architecture} />
          </div>
        ) : !code ? (
          isStreaming ? (
            <div className="flex h-full flex-col items-center justify-center gap-5 animate-pulse">
              <div className="relative">
                <CpuIcon className="size-12 text-accent/25" />
                <div className="absolute -inset-4 rounded-full border border-accent/10" />
              </div>
              <div className="text-center space-y-1.5">
                <p className="text-sm font-medium text-accent/50 tracking-tight">Generating circuit...</p>
                <p className="text-xs text-muted-foreground/30 text-pretty">Components will appear as they are placed</p>
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-5 text-muted-foreground/30">
              <div className="relative">
                <CpuIcon className="size-12 text-accent/15" />
                <div className="absolute -inset-4 rounded-full border border-accent/[0.07] animate-[ping_3s_ease-in-out_infinite]" />
                <div className="absolute -inset-8 rounded-full border border-accent/3" />
              </div>
              <div className="text-center space-y-1.5">
                <p className="text-sm font-medium text-foreground/40 tracking-tight">No circuit yet</p>
                <p className="text-xs text-muted-foreground/30 text-pretty max-w-[220px]">
                  Describe your circuit in the chat to see a live preview
                </p>
              </div>
            </div>
          )
        ) : (
          <WebPreview className="size-full">
            <div className="h-full bg-white">
              <RunFramePreview code={code} />
            </div>
          </WebPreview>
        )}
      </ArtifactContent>
    </Artifact>
  );
}
