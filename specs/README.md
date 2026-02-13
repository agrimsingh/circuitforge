# Specifications Index

| Spec | Status | Verified | Description |
|------|--------|----------|-------------|
| [agent-backend](./agent-backend.md) | Implemented | Yes (2026-02-13) | Agent SDK integration, SSE streaming, retry loop, adaptive memory |
| [frontend-ui](./frontend-ui.md) | Implemented | Yes (2026-02-13) | 3-panel UI with live preview and retry telemetry |
| [parts-search](./parts-search.md) | Implemented | Partial (2026-02-13) | JLCPCB parts search via jlcsearch API |
| [export](./export.md) | In Progress | Partial (2026-02-13) | Circuit JSON → manufacturing files with optional KiCad/review bundle output |
| [five-phase-workflow](./five-phase-workflow.md) | In Progress | Partial (2026-02-13) | Phase contracts, visible phase timeline, checkpoints, and review decisions |
| [kicad-integration](./kicad-integration.md) | In Progress | Partial (2026-02-13) | `circuit-json-to-kicad` + `kicad-sch-ts` conversion, review, and MCP-style edit route |
| [testing-strategy](./testing-strategy.md) | Implemented | Yes (2026-02-13) | Testing approach — 3-tier pyramid with live SDK tests |

## Status Legend
- **Draft**: Initial spec written, not yet implemented
- **In Progress**: Implementation underway
- **Implemented**: Code complete, pending verification
- **Needs Update**: Spec diverges from implementation
- **Planned**: Identified but not yet specified

## Verification Legend
- **Yes (date)**: Verified against implementation
- **Partial**: Some aspects verified
- **No**: Not yet verified
- **Stale**: Was verified but implementation changed
