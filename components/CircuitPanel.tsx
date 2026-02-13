"use client";

import { useRef, useEffect, useCallback } from "react";
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
import { CopyIcon, DownloadIcon } from "lucide-react";

interface CircuitPanelProps {
  code: string;
  onExport: () => void;
  isExporting: boolean;
  title?: string;
  description?: string;
}

function RunFramePreview({ code }: { code: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const readyRef = useRef(false);

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
        sendCode();
      }
    };

    window.addEventListener("message", handleMessage);
    if (readyRef.current) sendCode();

    return () => window.removeEventListener("message", handleMessage);
  }, [code]);

  return (
    <iframe
      ref={iframeRef}
      src="https://runframe.tscircuit.com/iframe.html"
      className="size-full border-0"
      title="Circuit Preview"
    />
  );
}

export function CircuitPanel({
  code,
  onExport,
  isExporting,
  title = "Circuit Preview",
  description = "Generated artifact from the active assistant run",
}: CircuitPanelProps) {
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      alert("Unable to copy code to clipboard.");
    }
  }, [code]);

  return (
    <Artifact className="h-full bg-[#080c14]">
      <ArtifactHeader>
        <div className="space-y-0.5">
          <ArtifactTitle>{title}</ArtifactTitle>
          <ArtifactDescription>{description}</ArtifactDescription>
        </div>

        <ArtifactActions>
          <ArtifactAction
            aria-label="Copy code"
            icon={CopyIcon}
            onClick={handleCopy}
            disabled={!code}
            tooltip="Copy circuit code"
            label="Copy"
          />
          <ArtifactAction
            aria-label={isExporting ? "Exporting" : "Export artifact"}
            icon={DownloadIcon}
            onClick={onExport}
            disabled={!code || isExporting}
            tooltip={isExporting ? "Exporting..." : "Export"}
            label="Export"
          >
            {isExporting ? "Exporting..." : "Export"}
          </ArtifactAction>
        </ArtifactActions>
      </ArtifactHeader>

      <ArtifactContent className="h-full p-0">
        {!code ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-xs text-[#2a3a54]">Circuit preview will appear here</p>
          </div>
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
