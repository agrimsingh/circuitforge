# Frontend UI Spec

## Overview
A 3-panel streaming interface that shows chat, live circuit preview, and activity/tool telemetry in real-time.

## Layout
```
┌─────────────────────────────────────────────┐
│  Header: CircuitForge logo + status          │
├──────────────────┬────────────────────────────┤
│                  │  Circuit Panel             │
│  Chat Panel      │  (Live Preview + Export)   │
│                  ├────────────────────────────┤
│  [input bar]     │  Info Panel (tabbed)       │
│                  │  [Activity | Tools]        │
└──────────────────┴────────────────────────────┘
```

## Panels

### Chat Panel (left)
- Message list: user prompts + assistant responses
- Input bar with send button at bottom
- Auto-scroll to latest message
- Markdown rendering for assistant text
- Generated code blocks are stripped from chat and replaced by placeholders
- **TodoQueue**: collapsible task list rendered from agent `TodoWrite` tool events
  - Items show spinning indicator (in_progress), dot indicator (pending), or struck-through (completed/cancelled)
  - Built on `Queue` primitives from `components/ai-elements/queue.tsx` (Radix Collapsible + ScrollArea)
- **Post-validation summary**: final agent message includes human-readable blocking count, auto-fix count, advisory warnings, readiness score, and next-step guidance

### Circuit Panel (top-right)
- Live `@tscircuit/runframe` preview
- Updates live as agent emits code
- Export button to generate manufacturing zip

### Info Panel (bottom-right, tabbed)
- **Activity tab**: thinking stream + retry telemetry summary card
  - attempts used / max
  - total diagnostics
  - first error category
  - per-category counts
  - final retry status
- **Tools tab**: timeline of tool + subagent events
  - running/done state
  - duration
  - expandable input/output payloads

## Resizable Panels
- Built with `react-resizable-panels`
- Horizontal split: chat vs right-side content
- Vertical split inside right-side: circuit preview over info panel

## States
- **Idle**: Input focused, panels empty or showing previous result
- **Streaming**: activity + tool events streaming, stop button visible
- **Complete**: All panels populated, input re-enabled
- **Error**: Error banner with retry option
