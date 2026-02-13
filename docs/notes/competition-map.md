# CircuitForge Competition Map

Comparison against the landscape described in `competitive_research.md` and `circuit-synth`-style AI hardware generators.

## Side-by-Side Matrix

| Dimension | `circuit-synth` | Diode/Zener | `atopile` | `tscircuit` | `kicad-sch-ts` |
|---|---|---|---|---|---|
| Positioning | CLI + Claude Code agents | DSL-first + Claude workflow | DSL-first + AI-assisted code generation | Browser-first preview + AI prompt guidance | KiCad schema library + tooling |
| Entry point | Python code base | Starlark (`.zener`) | `.ato` modules | React JSX (`tscircuit`) | KiCad v7/v8 schematic model |
| Primary artifact | KiCad files + Python output | KiCad files from Zener compile | KiCad via `.ato` compile | Circuit JSON + preview (current) | KiCad schematic objects / round-trip operations |
| Human loop depth | Strong for engineers | Moderate; still code-first | Moderate; module-first | Strong in runframe UX, weaker in validation | Human not in UI layer by itself |
| Browser UX | No | No (developer oriented) | Limited | Yes (RunFrame) | No built-in browser app |
| Multi-phase workflow | Not native | Not native | Not native | Not native | Not native |
| Manufacturing grounding | Native KiCad outputs | Native KiCad outputs | Native KiCad outputs | Preview focused; weak export story | Strong KiCad interoperability |
| Review/rules | Internal validation tools | Validation exists but not always enterprise flow | Validation and compile checks | Few structured ERC/DFM signals | ERC/DFM via analyzers when wired |
| Traceability | Emerging | Emerging | Module-level | Partial chat/context history | Strong object-level history when integrated |
| Sourcing loop | Optional | Optional | Optional | Web search + MCP tool | Depends on integrator |
| Differentiation potential | Niche toolchain | Anthropic-partner stack | Mature engineering language | Great accessibility | Deep KiCad fidelity |

## What differentiates CircuitForge V2

1. **Web-first orchestrated workflow**
   - From prompt to structured progress in a browser, not a terminal.

2. **Five-phase human-in-the-loop model**
   - Explicit checkpointing for requirements, architecture, implementation, review, export.

3. **Bidirectional KiCad path (`kicad-sch-ts` backbone)**
   - Round-trip validation and output path rather than preview-only JSON.

4. **Phase-gated validation + review surface**
   - DRC/DFM findings are surfaced as explicit actions (accept/dismiss).

5. **Design decision traceability**
   - Requirements, architecture nodes, gate events, review findings all emitted as canonical SSE events.

## Proof surfaces tied to each phase

- **Requirements**: `requirements_item` events + checklist rendered in `InfoPanel`.
- **Architecture**: `architecture_block` events + Mermaid-style structure in `ArchitecturePanel`.
- **Implementation**: `text`, `tool_*`, `phase_progress` events + stream retries.
- **Review**: `validation_errors` + `review_finding` + accept/dismiss workflow.
- **Export**: `formatSet.kicad` and `formatSet.reviewBundle` in `/api/export` payload.

## Why this map matters

`kicad-sch-ts` is the differentiator that upgrades CircuitForge from a generation assistant into a manufacturable design environment. The roadmap should force every phase to either produce or consume a real KiCad-anchored artifact path so the platform is auditable, reviewable, and order-ready.
