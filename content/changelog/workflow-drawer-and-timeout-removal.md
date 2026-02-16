---
title: Workflow drawer refresh and agent timeout removal
category: features
createdAt: 2026-02-16
---

The app shell and panel composition were refined to improve day-to-day usability. The main page now opens with a chat-first workspace when no circuit is present, introduces a right-side workflow drawer, and moves architecture viewing into a tab inside the circuit panel. Chat and info surfaces were streamlined so evidence, findings, and tool activity remain visible without overwhelming the main authoring flow.

Agent orchestration was also updated to remove the route-level per-attempt timeout in `/api/agent`. Retry attempts now rely on request/session abort signals and upstream abort/timeout-like failures, while preserving `attempt_timeout` diagnostics and existing retry semantics when those upstream conditions occur.

Documentation and quality notes were synchronized with the runtime behavior so timeout handling language now reflects abort/timeout-like retry fallback rather than a fixed per-attempt timer.
