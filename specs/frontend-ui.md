# Frontend UI Spec

## Overview
A 4-panel streaming interface that shows the agent's reasoning, tool activity, and generated circuit in real-time.

## Layout
```
┌─────────────────────────────────────────────┐
│  Header: CircuitForge logo + status          │
├──────────────────┬──────────────────────────┤
│                  │  Thinking Panel           │
│  Chat Panel      ├──────────────────────────┤
│                  │  Tool Activity Panel      │
│                  ├──────────────────────────┤
│  [input bar]     │  Circuit Panel            │
│                  │  [Code | Preview tabs]    │
└──────────────────┴──────────────────────────┘
```

## Panels

### Chat Panel (left)
- Message list: user prompts + assistant responses
- Input bar with send button at bottom
- Auto-scroll to latest message
- Markdown rendering for assistant text

### Thinking Panel (top-right)
- Streams the agent's internal reasoning
- Collapsible when not active
- Monospace font, dimmed styling

### Tool Activity Panel (mid-right)
- Timeline of tool calls and subagent events
- Each entry: tool name, status (running/done), duration
- Expandable to show input/output details

### Circuit Panel (bottom-right)
- Tabbed: **Code** | **Schematic** | **PCB** | **3D** | **BOM**
- Code tab: syntax-highlighted tscircuit code (read-only)
- Preview tabs: `@tscircuit/runframe` RunFrame component
- Updates live as agent emits code

## Resizable Panels
- Use `react-resizable-panels` for adjustable splits
- Left/right split: default 40%/60%
- Right column: 3-way vertical split

## Aesthetic Direction
- Dark "blueprint-noir" theme
- Blueprint grid background with subtle noise texture
- Copper (#B87333) and cyan (#00D4FF) accent colors
- Display font for headers, monospace for code/data
- Subtle animations for streaming state transitions

## States
- **Idle**: Input focused, panels empty or showing previous result
- **Streaming**: Panels filling, input disabled, stop button visible
- **Complete**: All panels populated, input re-enabled
- **Error**: Error banner with retry option
