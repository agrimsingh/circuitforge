import ts from "typescript";
import type { ValidationDiagnostic } from "@/lib/stream/types";

type ParsedEndpoint =
  | { kind: "net"; netName: string }
  | { kind: "selector"; component: string; pin: string }
  | { kind: "invalid" };

interface ComponentInfo {
  name: string;
  pins: Set<string> | null;
}

interface TraceInfo {
  from: string | null;
  to: string | null;
  line: number;
}

interface NetIntent {
  netName: string;
  endpoint: string;
}

const PIN_DEFAULTS_BY_TAG: Record<string, string[]> = {
  resistor: ["pin1", "pin2"],
  capacitor: ["pin1", "pin2"],
  inductor: ["pin1", "pin2"],
  diode: ["pin1", "pin2", "anode", "cathode", "pos", "neg"],
  led: ["pin1", "pin2", "anode", "cathode", "pos", "neg"],
  fuse: ["pin1", "pin2"],
  crystal: ["pin1", "pin2"],
  battery: ["pin1", "pin2", "anode", "cathode", "pos", "neg", "positive", "negative"],
  switch: ["pin1", "pin2"],
  pushbutton: ["pin1", "pin2", "pin3", "pin4"],
  transistor: ["pin1", "pin2", "pin3"],
  mosfet: ["pin1", "pin2", "pin3"],
  pinheader: [],
  chip: null as unknown as string[],
};

function parseStringLike(
  expr: ts.Expression | ts.JsxAttributeValue | undefined,
): string | null {
  if (!expr) return null;
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    return expr.text;
  }
  if (ts.isJsxExpression(expr) && expr.expression) {
    const value = expr.expression;
    if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
      return value.text;
    }
    if (ts.isTemplateExpression(value) && value.templateSpans.length === 0) {
      return value.head.text;
    }
  }
  return null;
}

function parseObjectLiteral(expr: ts.Expression | undefined): ts.ObjectLiteralExpression | null {
  if (!expr) return null;
  if (ts.isObjectLiteralExpression(expr)) return expr;
  if (ts.isParenthesizedExpression(expr) && ts.isObjectLiteralExpression(expr.expression)) {
    return expr.expression;
  }
  return null;
}

function getJsxAttributes(
  node: ts.JsxAttributes,
): Map<string, ts.JsxAttribute["initializer"] | undefined> {
  const attrs = new Map<string, ts.JsxAttribute["initializer"] | undefined>();
  for (const prop of node.properties) {
    if (!ts.isJsxAttribute(prop)) continue;
    attrs.set(prop.name.text, prop.initializer);
  }
  return attrs;
}

function parsePinLabels(
  initializer: ts.JsxAttribute["initializer"] | undefined,
): Set<string> | null {
  if (!initializer || !ts.isJsxExpression(initializer) || !initializer.expression) return null;
  const obj = parseObjectLiteral(initializer.expression);
  if (!obj) return null;
  const labels = new Set<string>();
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const value = prop.initializer;
    if (!ts.isStringLiteral(value) && !ts.isNoSubstitutionTemplateLiteral(value)) continue;
    labels.add(value.text.trim());
  }
  return labels.size > 0 ? labels : null;
}

function parseConnectionsToNetIntents(
  componentName: string,
  initializer: ts.JsxAttribute["initializer"] | undefined,
): NetIntent[] {
  if (!initializer || !ts.isJsxExpression(initializer) || !initializer.expression) return [];
  const obj = parseObjectLiteral(initializer.expression);
  if (!obj) return [];
  const intents: NetIntent[] = [];

  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const pinName =
      ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)
        ? prop.name.text.trim()
        : null;
    if (!pinName) continue;
    const value =
      ts.isStringLiteral(prop.initializer) || ts.isNoSubstitutionTemplateLiteral(prop.initializer)
        ? prop.initializer.text.trim()
        : null;
    if (!value || !value.startsWith("net.")) continue;
    const netName = value.slice(4).trim();
    if (!netName) continue;
    intents.push({
      netName,
      endpoint: `.${componentName} > .${pinName}`,
    });
  }

  return intents;
}

function parseEndpoint(raw: string): ParsedEndpoint {
  if (raw.startsWith("net.")) {
    const netName = raw.slice(4).trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(netName)) {
      return { kind: "net", netName };
    }
    return { kind: "invalid" };
  }
  const match = /^\.([A-Za-z_][A-Za-z0-9_]*)\s*>\s*\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(raw.trim());
  if (!match) return { kind: "invalid" };
  return { kind: "selector", component: match[1], pin: match[2] };
}

function extractConnectivityModel(code: string) {
  const sourceFile = ts.createSourceFile(
    "main.tsx",
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  const components = new Map<string, ComponentInfo>();
  const traces: TraceInfo[] = [];
  const netIntents: NetIntent[] = [];

  const visitJsx = (tag: string, attrs: ts.JsxAttributes, line: number) => {
    const attrMap = getJsxAttributes(attrs);
    if (tag === "trace") {
      traces.push({
        from: parseStringLike(attrMap.get("from")),
        to: parseStringLike(attrMap.get("to")),
        line,
      });
      return;
    }

    const name = parseStringLike(attrMap.get("name"));
    if (!name) return;
    const pinLabels = parsePinLabels(attrMap.get("pinLabels"));
    const defaults = PIN_DEFAULTS_BY_TAG[tag];
    const defaultPins = Array.isArray(defaults) ? new Set(defaults) : null;
    const pins = pinLabels ?? defaultPins;
    components.set(name, { name, pins });

    const intents = parseConnectionsToNetIntents(name, attrMap.get("connections"));
    for (const intent of intents) {
      netIntents.push(intent);
    }
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node)) {
      visitJsx(node.tagName.getText(sourceFile).toLowerCase(), node.attributes, sourceFile.getLineAndCharacterOfPosition(node.pos).line + 1);
    } else if (ts.isJsxElement(node)) {
      visitJsx(node.openingElement.tagName.getText(sourceFile).toLowerCase(), node.openingElement.attributes, sourceFile.getLineAndCharacterOfPosition(node.pos).line + 1);
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);

  return { components, traces, netIntents };
}

function hasPinMatch(pins: Set<string>, pin: string): boolean {
  if (pins.has(pin)) return true;
  const needle = pin.trim().toLowerCase();
  if (!needle) return false;
  for (const candidate of pins) {
    if (candidate.trim().toLowerCase() === needle) return true;
  }
  return false;
}

function diagnostic(
  category: string,
  message: string,
  signature: string,
  severity = 9,
): ValidationDiagnostic {
  return {
    category,
    message,
    signature,
    severity,
    source: "tscircuit",
    family: category,
  };
}

export function collectConnectivityPreflightDiagnostics(code: string): ValidationDiagnostic[] {
  if (!code.trim()) return [];
  const { components, traces } = extractConnectivityModel(code);
  const diagnostics: ValidationDiagnostic[] = [];
  let traceIndex = 0;

  for (const trace of traces) {
    traceIndex += 1;
    const traceLabel = `trace@${trace.line}:${traceIndex}`;
    if (!trace.from || !trace.to) {
      diagnostics.push(
        diagnostic(
          "source_trace_missing_endpoint",
          "Trace is missing from/to endpoint.",
          `connectivity|source_trace_missing_endpoint|${traceLabel}`,
        ),
      );
      continue;
    }

    const parsedFrom = parseEndpoint(trace.from);
    const parsedTo = parseEndpoint(trace.to);
    if (parsedFrom.kind === "invalid") {
      diagnostics.push(
        diagnostic(
          "source_trace_invalid_selector",
          `Trace endpoint "${trace.from}" has invalid selector syntax.`,
          `connectivity|source_trace_invalid_selector|${traceLabel}|from`,
        ),
      );
    }
    if (parsedTo.kind === "invalid") {
      diagnostics.push(
        diagnostic(
          "source_trace_invalid_selector",
          `Trace endpoint "${trace.to}" has invalid selector syntax.`,
          `connectivity|source_trace_invalid_selector|${traceLabel}|to`,
        ),
      );
    }

    for (const parsed of [parsedFrom, parsedTo]) {
      if (parsed.kind !== "selector") continue;
      const component = components.get(parsed.component);
      if (!component) {
        diagnostics.push(
          diagnostic(
            "source_trace_unknown_component",
            `Trace references unknown component "${parsed.component}".`,
            `connectivity|source_trace_unknown_component|${traceLabel}|${parsed.component}`,
          ),
        );
        continue;
      }
      if (!component.pins) continue;
      if (!hasPinMatch(component.pins, parsed.pin)) {
        diagnostics.push(
          diagnostic(
            "source_trace_unknown_pin",
            `Trace references unknown pin "${parsed.pin}" on component "${parsed.component}".`,
            `connectivity|source_trace_unknown_pin|${traceLabel}|${parsed.component}|${parsed.pin}`,
          ),
        );
      }
    }
  }

  const deduped = new Map<string, ValidationDiagnostic>();
  for (const entry of diagnostics) {
    if (!deduped.has(entry.signature)) deduped.set(entry.signature, entry);
  }
  return Array.from(deduped.values());
}

export function buildTraceRebuildResultFromNetIntent(code: string): {
  traces: string[];
  reason: string | null;
} {
  if (!code.trim()) {
    return { traces: [], reason: "empty_code" };
  }
  const { netIntents } = extractConnectivityModel(code);
  const endpointsByNet = new Map<string, Set<string>>();
  for (const intent of netIntents) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(intent.netName)) continue;
    const set = endpointsByNet.get(intent.netName) ?? new Set<string>();
    set.add(intent.endpoint);
    endpointsByNet.set(intent.netName, set);
  }

  const traces: string[] = [];
  for (const [netName, endpointSet] of endpointsByNet.entries()) {
    const endpoints = Array.from(endpointSet);
    if (endpoints.length < 2) continue;
    const anchor = endpoints[0];
    for (let i = 1; i < endpoints.length; i++) {
      traces.push(`<trace from="${anchor}" to="${endpoints[i]}" />`);
    }
    traces.push(`<trace from="${anchor}" to="net.${netName}" />`);
  }

  if (traces.length === 0) {
    return { traces: [], reason: "insufficient_net_intent" };
  }
  return { traces, reason: null };
}
