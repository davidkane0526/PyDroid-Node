import { parsePythonFunctionSignature } from "./customNode";
import type { NodeSpec, ParameterSpec, PortSpec } from "./nodeCatalog";

function matchesVariant(
  when: Record<string, string | number | boolean | null>,
  parameters: Record<string, unknown>,
): boolean {
  return Object.entries(when).every(([key, expected]) => parameters[key] === expected);
}

function applyParameterPatches(
  parameters: ParameterSpec[],
  patches: Record<string, Partial<ParameterSpec>> | undefined,
): ParameterSpec[] {
  if (!patches) return parameters;
  return parameters.map((parameter) => patches[parameter.key] ? { ...parameter, ...patches[parameter.key] } : parameter);
}


function repeatedInputPorts(base: NodeSpec, parameters: Record<string, unknown>): PortSpec[] {
  const ports: PortSpec[] = [];
  for (const repeat of base.repeatedInputPorts ?? []) {
    if (repeat.when && !matchesVariant(repeat.when, parameters)) continue;
    const raw = Number(parameters[repeat.countParameter] ?? repeat.min ?? 1);
    const minimum = Math.max(1, Math.trunc(repeat.min ?? 1));
    const maximum = Math.max(minimum, Math.trunc(repeat.max ?? 32));
    const count = Math.min(maximum, Math.max(minimum, Number.isFinite(raw) ? Math.trunc(raw) : minimum));
    for (let index = 1; index <= count; index += 1) {
      ports.push({
        id: `${repeat.idPrefix}${index}`,
        label: `${repeat.labelPrefix} ${index}`,
        valueType: repeat.valueType,
        required: repeat.required,
      });
    }
  }
  return ports;
}

/**
 * Resolve the effective node contract from stored node parameters.
 *
 * Dynamic variants are pure NodeSpec declarations: they can change ports and
 * parameter presentation without teaching either runtime about UI state.
 * Custom Python nodes use the same final contract boundary after their
 * signature has been parsed.
 */
export function resolveNodeSpec(base: NodeSpec | undefined, parameters: Record<string, unknown>): NodeSpec | undefined {
  if (!base) return undefined;

  const effectiveParameters: Record<string, unknown> = { ...base.defaults, ...parameters };
  let resolved = base;
  for (const variant of base.dynamicVariants ?? []) {
    if (!matchesVariant(variant.when, effectiveParameters)) continue;
    const hidden = new Set(variant.hiddenParameters ?? []);
    resolved = {
      ...resolved,
      inputPorts: variant.inputPorts ?? resolved.inputPorts,
      outputPorts: variant.outputPorts ?? resolved.outputPorts,
      parameters: applyParameterPatches(resolved.parameters, variant.parameterPatches).filter((parameter) => !hidden.has(parameter.key)),
    };
  }

  const repeated = repeatedInputPorts(base, effectiveParameters);
  if (repeated.length) resolved = { ...resolved, inputPorts: [...resolved.inputPorts, ...repeated] };

  if (base.nodeType !== "custom.python_function") return resolved;
  const signature = parsePythonFunctionSignature(String(effectiveParameters.code ?? ""));
  if (signature.error) return resolved;
  return {
    ...resolved,
    inputPorts: signature.inputPorts,
    outputPorts: signature.outputPorts,
    parameters: [...resolved.parameters, ...signature.parameters],
  };
}
