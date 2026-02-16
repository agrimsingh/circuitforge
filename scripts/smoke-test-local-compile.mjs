/**
 * Smoke test for local tscircuit compilation via @tscircuit/eval.
 *
 * Test 1: Simple LED circuit (should complete in seconds)
 * Test 2: Complex STM32 dev board (would time out at 90s on remote API)
 */

import { CircuitRunner } from "@tscircuit/eval";

const SIMPLE_CIRCUIT = `
circuit.add(
  <board width="20mm" height="20mm">
    <resistor name="R1" resistance="220" footprint="0402" pcbX={-3} pcbY={0} />
    <led name="LED1" footprint="0603" color="red" pcbX={3} pcbY={0} />
    <trace from=".R1 > .pin2" to=".LED1 > .anode" />
  </board>
)
`;

const COMPLEX_STM32_CIRCUIT = `
circuit.add(
  <board width="60mm" height="40mm">
    <chip
      name="U1"
      footprint="lqfp48"
      pinLabels={{
        pin1: "VBAT",
        pin2: "PC13",
        pin3: "PC14",
        pin4: "PC15",
        pin5: "PD0",
        pin6: "PD1",
        pin7: "NRST",
        pin8: "VSSA",
        pin9: "VDDA",
        pin10: "PA0",
        pin11: "PA1",
        pin12: "PA2",
        pin13: "PA3",
        pin14: "PA4",
        pin15: "PA5",
        pin16: "PA6",
        pin17: "PA7",
        pin18: "PB0",
        pin19: "PB1",
        pin20: "PB2",
        pin23: "VSS1",
        pin24: "VDD1",
        pin35: "VSS2",
        pin36: "VDD2",
        pin47: "VSS3",
        pin48: "VDD3",
      }}
      pcbX={0}
      pcbY={0}
    />

    <resistor name="R1" resistance="10k" footprint="0402" pcbX={-15} pcbY={-10} />
    <resistor name="R2" resistance="10k" footprint="0402" pcbX={-15} pcbY={-8} />
    <resistor name="R3" resistance="220" footprint="0402" pcbX={15} pcbY={-10} />
    <resistor name="R4" resistance="220" footprint="0402" pcbX={15} pcbY={-8} />
    <resistor name="R5" resistance="4.7k" footprint="0402" pcbX={-15} pcbY={-6} />
    <resistor name="R6" resistance="4.7k" footprint="0402" pcbX={-15} pcbY={-4} />

    <capacitor name="C1" capacitance="100nF" footprint="0402" pcbX={-10} pcbY={12} />
    <capacitor name="C2" capacitance="100nF" footprint="0402" pcbX={-7} pcbY={12} />
    <capacitor name="C3" capacitance="100nF" footprint="0402" pcbX={-4} pcbY={12} />
    <capacitor name="C4" capacitance="4.7uF" footprint="0805" pcbX={0} pcbY={12} />
    <capacitor name="C5" capacitance="20pF" footprint="0402" pcbX={4} pcbY={12} />
    <capacitor name="C6" capacitance="20pF" footprint="0402" pcbX={7} pcbY={12} />

    <led name="LED1" footprint="0603" color="green" pcbX={20} pcbY={-10} />
    <led name="LED2" footprint="0603" color="red" pcbX={20} pcbY={-6} />

    <trace from=".U1 > .PA5" to=".R3 > .pin1" />
    <trace from=".R3 > .pin2" to=".LED1 > .anode" />
    <trace from=".U1 > .PA6" to=".R4 > .pin1" />
    <trace from=".R4 > .pin2" to=".LED2 > .anode" />
  </board>
)
`;

async function runTest(name, code) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`TEST: ${name}`);
  console.log("=".repeat(60));

  const start = performance.now();
  try {
    const runner = new CircuitRunner();
    await runner.executeWithFsMap({
      fsMap: { "main.tsx": code },
      entrypoint: "main.tsx",
    });
    await runner.renderUntilSettled();
    const circuitJson = await runner.getCircuitJson();
    const elapsed = ((performance.now() - start) / 1000).toFixed(1);

    if (Array.isArray(circuitJson) && circuitJson.length > 0) {
      const types = [...new Set(circuitJson.map((e) => e.type))];
      const errorEntries = circuitJson.filter(
        (e) => typeof e.type === "string" && e.type.includes("error"),
      );
      console.log(`  PASS in ${elapsed}s — ${circuitJson.length} circuit_json entries`);
      console.log(`  Types: ${types.join(", ")}`);
      if (errorEntries.length > 0) {
        console.log(`  (${errorEntries.length} error entries in circuit_json)`);
      }
    } else {
      console.log(`  WARN in ${elapsed}s — no circuit_json entries returned`);
    }
  } catch (error) {
    const elapsed = ((performance.now() - start) / 1000).toFixed(1);
    console.log(`  ERROR in ${elapsed}s — ${error.message || error}`);
  }
}

async function main() {
  console.log("Local tscircuit compile smoke test");
  console.log(`Node ${process.version}`);

  await runTest("Simple LED circuit", SIMPLE_CIRCUIT);
  await runTest(
    "Complex STM32 dev board (would timeout at 90s remote)",
    COMPLEX_STM32_CIRCUIT,
  );

  console.log("\nDone.");
}

main().catch(console.error);
