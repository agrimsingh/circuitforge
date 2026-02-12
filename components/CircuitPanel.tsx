"use client";

import { useState, useRef, useEffect } from "react";

type Tab = "code" | "preview";

interface CircuitPanelProps {
  code: string;
  onExport: () => void;
  isExporting: boolean;
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
            entrypoint: "main.tsx",
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
      className="w-full h-full border-0"
      title="Circuit Preview"
    />
  );
}

export function CircuitPanel({ code, onExport, isExporting }: CircuitPanelProps) {
  const [tab, setTab] = useState<Tab>("code");

  return (
    <div className="flex flex-col h-full bg-[#080c14]">
      <div className="flex items-center gap-1 px-4 py-2 border-b border-[#1a2236]">
        <div className="flex items-center gap-1 mr-auto">
          {(["code", "preview"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded text-xs font-mono uppercase tracking-wider transition-colors ${
                tab === t
                  ? "bg-[#1a2a44] text-[#00d4ff] border border-[#00d4ff]/20"
                  : "text-[#4a6080] hover:text-[#94a8c0] border border-transparent"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {code && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => navigator.clipboard.writeText(code)}
              className="px-2 py-1 text-[10px] font-mono text-[#4a6080] hover:text-[#94a8c0] border border-[#1a2236] rounded transition-colors"
            >
              Copy
            </button>
            <button
              onClick={onExport}
              disabled={isExporting}
              className="px-2 py-1 text-[10px] font-mono text-[#b87333] hover:text-[#d4944a] border border-[#b87333]/30 rounded transition-colors disabled:opacity-50"
            >
              {isExporting ? "Exporting..." : "Export"}
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-hidden">
        {!code ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-[#2a3a54] font-mono">
              Circuit code will appear here
            </p>
          </div>
        ) : tab === "code" ? (
          <div className="h-full overflow-auto p-4 scrollbar-thin">
            <pre className="text-xs font-mono text-[#94a8c0] whitespace-pre-wrap leading-relaxed">
              <code>{code}</code>
            </pre>
          </div>
        ) : (
          <div className="h-full w-full bg-white">
            <RunFramePreview code={code} />
          </div>
        )}
      </div>
    </div>
  );
}
