---
title: Structural repair strategies, connectivity preflight, and convergence hardening
category: enhancement
createdAt: 2026-02-17
---

Major repair-loop convergence overhaul with three new subsystems and deep test coverage.

**Configurable repair runtime:** All retry budget knobs (max attempts, stagnation/signature/autorouter limits, structural repair budget, status pulse interval) are now environment-driven via `RepairRuntimeConfig` with separate test vs production defaults. Per-attempt compile/validate timeout (`CIRCUITFORGE_COMPILE_VALIDATE_TIMEOUT_MS`) emits non-terminal `compile_validate_timeout` diagnostics instead of killing the stream. Long-running generation and validation stages emit periodic status pulse heartbeats so the UI never appears stalled.

**Structural repair strategies:** When the retry loop detects repeated same-family blockers or no blocking-count reduction, it auto-switches through an escalation ladder: `targeted_congestion_relief` (constrained board growth + bounded component nudges, tunable via `CIRCUITFORGE_MINOR_RELIEF_PASSES`) → `structural_trace_rebuild` (discard legacy traces, rebuild from net-intent pairs) → `structural_layout_spread` (1.2x board/coordinate scaling). Board-fit validation now emits blocking `pcb_component_out_of_bounds_error` and routes into layout-spread recovery. Autorouter exhaustion fast-cutoff is gated behind at least one minor relief pass.

**Connectivity preflight and reference hints:** New `connectivityPreflight.ts` validates trace endpoints, selector syntax, component existence, and pin references before compile. `tscircuitReference.ts` fetches diagnostic-targeted snippets from `docs.tscircuit.com/ai.txt` (cached, feature-flagged) for retrieval-augmented retry prompts. Source code guardrails normalize invalid net names and strip malformed traces. Advisory diagnostics split into actionable vs low-signal for readiness scoring. Code-writer defaults to Opus with Sonnet override. Architecture synthesis via Haiku with enriched block semantics. ArchitecturePanel renders role/criticality pills and I/O summaries. InfoPanel fix action now repairs all open findings.
