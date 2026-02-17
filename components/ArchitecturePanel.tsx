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

function statusPill(status: ArchitectureNode["status"]) {
  if (status === "blocked") return "text-red-300";
  if (status === "done") return "text-emerald-300";
  if (status === "in_progress") return "text-blue-300";
  return "text-[#6f8eb7]";
}

function roleStyle(role?: string) {
  const value = role?.toLowerCase() ?? "";
  if (value.includes("power")) return "border-amber-400/50 bg-amber-500/10 text-amber-200";
  if (value.includes("control")) return "border-cyan-400/50 bg-cyan-500/10 text-cyan-200";
  if (value.includes("connect") || value.includes("rf")) {
    return "border-violet-400/50 bg-violet-500/10 text-violet-200";
  }
  if (value.includes("sens") || value.includes("analog")) return "border-emerald-400/50 bg-emerald-500/10 text-emerald-200";
  if (value.includes("actuat") || value.includes("io")) return "border-rose-400/50 bg-rose-500/10 text-rose-200";
  return "border-slate-400/40 bg-slate-500/10 text-slate-200";
}

function criticalityStyle(value?: ArchitectureNode["criticality"]) {
  if (value === "high") return "border-red-400/50 text-red-200";
  if (value === "medium") return "border-amber-400/50 text-amber-200";
  if (value === "low") return "border-emerald-400/50 text-emerald-200";
  return "border-slate-500/50 text-slate-300";
}

function compactItems(items?: string[], max = 3): string {
  if (!items || items.length === 0) return "n/a";
  return items.slice(0, max).join(" | ");
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
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {block.role ? (
            <span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${roleStyle(block.role)}`}>
              {block.role}
            </span>
          ) : null}
          {block.criticality ? (
            <span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${criticalityStyle(block.criticality)}`}>
              {block.criticality}
            </span>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">{block.notes}</p>
        <p className="mt-1 text-[11px] text-[#89a7cf]">In: {compactItems(block.inputs)}</p>
        <p className="mt-1 text-[11px] text-[#89a7cf]">Out: {compactItems(block.outputs)}</p>
        <p className="mt-1 text-[11px] text-[#6f8eb7]">IF: {compactItems(block.interfaces)}</p>
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
    <div className="h-full">
      {blocks.length === 0 ? (
        <p className="text-xs text-[#2a3a54]">No architecture blocks yet</p>
      ) : (
        <div className="h-full rounded-md border border-[#1a2236] bg-[#080c14]">
          <Canvas
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            nodes={nodes}
            edges={edges}
            fitView
          />
        </div>
      )}
    </div>
  );
}
