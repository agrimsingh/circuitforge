---
title: Deterministic repair routing, evidence stream, and live smoke hardening
category: features
createdAt: 2026-02-16
---

CircuitForge now applies deterministic diagnostic routing inside the `/api/agent` repair loop. Diagnostics are classified into `auto_fixable`, `should_demote`, and `must_repair` families, then surfaced through new SSE evidence events (`repair_plan`, `repair_result`) that the frontend consumes in InfoPanel alongside existing workflow telemetry.

Convergence behavior was tightened with stricter active-pin handling for `kicad_unconnected_pin`, improved timeout/abort normalization in retry flow, and blocker-first attempt selection. Session persistence and retry instrumentation remain visible through final summaries and timing/event streams, with export readiness controls unchanged.

Live endpoint verification now includes fixture-backed deterministic smoke prompts, a dedicated pin-conflict probe for `PIN_CONFLICT_WARNING`, and stricter startup validation for selected prompt sets. Integration coverage was expanded for retry semantics, streaming contract behavior, deterministic repair outcomes, and KiCad edit/export gate paths.
