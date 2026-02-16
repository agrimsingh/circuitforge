---
title: One-shot export, phase-scoped tools, and UX clarity pass
category: enhancement
createdAt: 2026-02-17
---

Big optimization and UX clarity sweep across the agent pipeline and frontend.

**Backend:** Removed the duplicate deterministic-revalidation compile pass in the retry loop, made adaptive guardrails lazy (only fetched when a retry prompt is actually needed), added phase-scoped tool and subagent gating so each design phase only sees relevant capabilities, added `callId` correlation IDs to `tool_start`/`tool_result` SSE events, and tightened the speculative compile trigger to require a complete TSX fence before firing. The export route now accepts `tscircuit_code` directly (compile + artifact generation in one call, with independent steps parallelized via `Promise.all`). Review findings lifecycle is synced: resolved findings emit `review_decision` dismissal events, and client upserts preserve prior accepted/dismissed state.

**Frontend:** Chat now includes rolling progress narration (phase, retry, repair, gate, summary) so users always see where the agent is without relying only on chain-of-thought. Completed runs append an explicit assistant recap (readiness, diagnostics, auto-fix totals, concrete follow-up prompts). InfoPanel tools section replaced with a grouped pipeline activity summary with average timing, plus a drill-down toggle for raw tool calls. Export flow simplified from two-step (compile → export) to a single `/api/export` call.
