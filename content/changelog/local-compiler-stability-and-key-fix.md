---
title: Local compiler stability and TodoQueue key fix
category: fix
createdAt: 2026-02-17
---

Stabilized the local `@tscircuit/eval` compiler: marked it as a server external package in `next.config.ts` so Turbopack doesn't try to bundle it, and added a file-URL fallback loader in `lib/compile/local.ts` so compilation survives import-path regressions. The README now documents how the self-learning error memory works.

Also fixed a React "missing key" console warning in the `TodoQueue` component where `todo.id` could be undefined at runtime due to an `as` cast on incoming SSE data.
