import { describe, expect, it } from "vitest";
import {
  buildTraceRebuildResultFromNetIntent,
  collectConnectivityPreflightDiagnostics,
} from "../connectivityPreflight";

describe("connectivityPreflight", () => {
  it("detects missing trace endpoints", () => {
    const diagnostics = collectConnectivityPreflightDiagnostics(
      [
        "export default () => (",
        '  <board width="60mm" height="40mm">',
        '    <trace from=".U1 > .OUT" />',
        "  </board>",
        ")",
      ].join("\n"),
    );

    expect(diagnostics.some((d) => d.category === "source_trace_missing_endpoint")).toBe(true);
  });

  it("detects invalid selector syntax", () => {
    const diagnostics = collectConnectivityPreflightDiagnostics(
      [
        "export default () => (",
        '  <board width="60mm" height="40mm">',
        '    <trace from=".U1 .OUT" to=".U2 > .IN" />',
        "  </board>",
        ")",
      ].join("\n"),
    );

    expect(diagnostics.some((d) => d.category === "source_trace_invalid_selector")).toBe(true);
  });

  it("detects unknown components and pins", () => {
    const diagnostics = collectConnectivityPreflightDiagnostics(
      [
        "export default () => (",
        '  <board width="60mm" height="40mm">',
        '    <chip name="U1" footprint="soic8" pinLabels={{ pin1: "OUT", pin2: "IN" }} />',
        '    <trace from=".U2 > .OUT" to=".U1 > .MISSING" />',
        "  </board>",
        ")",
      ].join("\n"),
    );

    expect(diagnostics.some((d) => d.category === "source_trace_unknown_component")).toBe(true);
    expect(diagnostics.some((d) => d.category === "source_trace_unknown_pin")).toBe(true);
  });

  it("accepts LED anode/cathode aliases as valid pins", () => {
    const diagnostics = collectConnectivityPreflightDiagnostics(
      [
        "export default () => (",
        '  <board width="60mm" height="40mm">',
        '    <led name="LED1" color="red" footprint="0603" />',
        '    <trace from=".LED1 > .anode" to="net.V3V3" />',
        '    <trace from=".LED1 > .cathode" to="net.GND" />',
        "  </board>",
        ")",
      ].join("\n"),
    );

    expect(diagnostics.some((d) => d.category === "source_trace_unknown_pin")).toBe(false);
  });

  it("builds rebuild traces from component net intent", () => {
    const result = buildTraceRebuildResultFromNetIntent(
      [
        "export default () => (",
        '  <board width="60mm" height="40mm">',
        '    <chip name="U1" footprint="soic8" pinLabels={{ pin1: "OUT" }} connections={{ OUT: "net.SIG" }} />',
        '    <chip name="U2" footprint="soic8" pinLabels={{ pin1: "IN" }} connections={{ IN: "net.SIG" }} />',
        "  </board>",
        ")",
      ].join("\n"),
    );

    expect(result.reason).toBeNull();
    expect(result.traces.some((line) => line.includes('from=".U1 > .OUT" to=".U2 > .IN"'))).toBe(true);
  });
});
