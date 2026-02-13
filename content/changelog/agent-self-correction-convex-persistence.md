---
title: Agent self-correction loop and Convex-backed persistent error memory
category: features
createdAt: 2025-02-13
---

Agent backend now runs a compile validation + retry loop with up to 3 repair attempts. Failed attempts produce diagnostics (trace/via DRC errors) that feed targeted fix prompts. Preventive routing guardrails are injected up front to reduce recurring PCB violations.

Adaptive error memory records failure categories and surfaces learned guardrails in subsequent prompts. Memory persists via Convex HTTP actions (`/error-memory/record`, `/error-memory/guardrails`) when env is configured; otherwise falls back to in-memory storage. InfoPanel activity tab now shows retry telemetry (attempt count, diagnostics summary).

Vercel Sandbox SDK scaffold added with smoke-test endpoint `POST /api/sandbox/quickstart`. Root README documents setup, optional Convex persistence, and sandbox auth.
