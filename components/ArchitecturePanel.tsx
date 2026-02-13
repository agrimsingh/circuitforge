"use client";

import type { ArchitectureNode } from "@/lib/stream/types";

interface ArchitecturePanelProps {
  blocks: ArchitectureNode[];
}

function asMermaid(nodes: ArchitectureNode[]) {
  if (nodes.length === 0) return "graph TD\n  A[No architecture blocks yet]";
  const lines = ["flowchart TD"];

  for (const block of nodes) {
    const label = `${block.id}: ${block.label}`.replaceAll("\"", "\\\"");
    lines.push(`  ${block.id}["${label}"]`);
  }

  for (const block of nodes) {
    for (const child of block.children ?? []) {
      lines.push(`  ${block.id} --> ${child}`);
    }
  }

  return lines.join("\n");
}

function BlockItem({ block }: { block: ArchitectureNode }) {
  return (
    <div
      className="rounded-md border border-[#1a2236] bg-[#08111d] p-2 text-xs"
      style={{
        borderColor: block.status === "blocked" ? "#603030" : "#1a2236",
      }}
    >
      <div className="font-mono font-semibold text-[#a6bee2] flex items-center justify-between">
        <span>
          {block.id}. {block.label}
        </span>
        <span className="text-[10px] text-[#4a6080] uppercase">{block.status}</span>
      </div>
      {block.notes && <p className="text-[#5a7090] mt-1">{block.notes}</p>}
      {block.kind && (
        <p className="text-[10px] text-[#3a5070] mt-1">Kind: {block.kind}</p>
      )}
      <div className="mt-2">
        {block.portMappings?.map((mapping, index) => (
          <div key={`${block.id}-map-${index}`} className="text-[10px] text-[#4a6080]">
            {mapping.from} → {mapping.to}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ArchitecturePanel({ blocks }: ArchitecturePanelProps) {
  return (
    <div className="border border-[#1a2236] rounded-md p-3 bg-[#0b1322]">
      <div className="text-xs font-mono text-[#4a6080] uppercase tracking-wider mb-2">
        Architecture
      </div>

      <div className="grid grid-cols-1 gap-2">
        {blocks.length === 0 ? (
          <p className="text-xs text-[#2a3a54]">No blocks yet</p>
        ) : (
          blocks.map((block) => <BlockItem key={block.id} block={block} />)
        )}
      </div>

      <details className="mt-3">
        <summary className="text-xs text-[#3a5070] cursor-pointer">Mermaid chart</summary>
        <pre className="mt-2 text-[10px] font-mono bg-[#060d16] border border-[#1a2236] rounded p-2 overflow-x-auto text-[#6f88aa]">
          {asMermaid(blocks)}
        </pre>
      </details>
    </div>
  );
}
