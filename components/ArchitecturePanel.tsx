"use client";

import { useMemo } from "react";
import {
  Canvas,
} from "@/components/ai-elements/canvas";
import {
  Node,
  NodeHeader,
  NodeContent,
  NodeDescription,
  NodeFooter,
  NodeTitle,
} from "@/components/ai-elements/node";
import { Edge } from "@/components/ai-elements/edge";
import type { ArchitectureNode } from "@/lib/stream/types";

interface ArchitecturePanelProps {
  blocks: ArchitectureNode[];
}

function asMermaid(nodes: ArchitectureNode[]) {
  if (nodes.length === 0) return "graph TD\n  A[No architecture blocks yet]";

  const lines = ["flowchart TD"];

  for (const block of nodes) {
    const label = `${block.id}: ${block.label}`.replaceAll('"', '\\"');
    lines.push(`  ${block.id}["${label}"]`);
  }

  for (const block of nodes) {
    for (const child of block.children ?? []) {
      lines.push(`  ${block.id} --> ${child}`);
    }
  }

  return lines.join("\n");
}

function statusPill(status: ArchitectureNode["status"]) {
  if (status === "blocked") return "text-red-300";
  if (status === "done") return "text-emerald-300";
  if (status === "in_progress") return "text-blue-300";
  return "text-[#6f8eb7]";
}

function ArchitectureGraphNode({ data }: { data: { block: ArchitectureNode } }) {
  const { block } = data;

  return (
    <Node
      handles={{ source: true, target: true }}
      className="min-w-56 border-[#1a2236] bg-[#0b1322]"
    >
      <NodeHeader>
        <NodeTitle>{block.label}</NodeTitle>
        <NodeDescription>{block.kind}</NodeDescription>
      </NodeHeader>
      <NodeContent>
        <p className="text-xs text-muted-foreground">{block.notes}</p>
        <p className={`mt-1 text-xs ${statusPill(block.status)}`}>Status: {block.status}</p>
        {block.portMappings?.length ? (
          <ul className="mt-2 text-xs text-[#4a6080]">
            {block.portMappings.map((mapping, index) => (
              <li key={`${block.id}-${mapping.from}-${index}`}>
                {mapping.from} → {mapping.to}
              </li>
            ))}
          </ul>
        ) : null}
      </NodeContent>
      <NodeFooter>{block.id}</NodeFooter>
    </Node>
  );
}

export function ArchitecturePanel({ blocks }: ArchitecturePanelProps) {
  const { nodes, edges } = useMemo(() => {
    const nodeIds = new Set(blocks.map((block) => block.id));
    const graphNodes = blocks.map((block, index) => ({
      id: block.id,
      type: "architecture",
      position: {
        x: 40 + (index % 4) * 260,
        y: 40 + Math.floor(index / 4) * 220,
      },
      data: { block },
    }));

    const graphEdges: Array<{
      id: string;
      type: "animated";
      source: string;
      target: string;
    }> = [];

    const edgeSet = new Set<string>();
    for (const block of blocks) {
      for (const child of block.children ?? []) {
        if (!nodeIds.has(child)) continue;
        const key = `${block.id}->${child}`;
        if (edgeSet.has(key)) continue;
        edgeSet.add(key);
        graphEdges.push({
          id: key,
          source: block.id,
          target: child,
          type: "animated",
        });
      }
    }

    return { nodes: graphNodes, edges: graphEdges };
  }, [blocks]);

  const nodeTypes = useMemo(
    () => ({
      architecture: ArchitectureGraphNode,
    }),
    []
  );

  const edgeTypes = useMemo(
    () => ({
      animated: Edge.Animated,
      temporary: Edge.Temporary,
    }),
    []
  );

  return (
    <div className="space-y-2">
      {blocks.length === 0 ? (
        <p className="text-xs text-[#2a3a54]">No architecture blocks yet</p>
      ) : (
        <div className="h-72 rounded-md border border-[#1a2236] bg-[#080c14]">
          <Canvas
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            nodes={nodes}
            edges={edges}
            fitView
          />
        </div>
      )}

      <details>
        <summary className="cursor-pointer text-xs text-[#3a5070]">Mermaid fallback</summary>
        <pre className="mt-2 max-h-48 overflow-x-auto overflow-y-auto rounded-md border border-[#1a2236] bg-[#060d16] p-2 text-[10px] text-[#6f88aa]">
          {asMermaid(blocks)}
        </pre>
      </details>
    </div>
  );
}
