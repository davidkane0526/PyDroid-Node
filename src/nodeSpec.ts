import { parsePythonFunctionSignature } from "./customNode";
import type { NodeSpec, ParameterSpec } from "./nodeCatalog";

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

  let resolved = base;
  for (const variant of base.dynamicVariants ?? []) {
    if (!matchesVariant(variant.when, parameters)) continue;
    const hidden = new Set(variant.hiddenParameters ?? []);
    resolved = {
      ...resolved,
      inputPorts: variant.inputPorts ?? resolved.inputPorts,
      outputPorts: variant.outputPorts ?? resolved.outputPorts,
      parameters: applyParameterPatches(resolved.parameters, variant.parameterPatches).filter((parameter) => !hidden.has(parameter.key)),
    };
  }

  if (base.nodeType !== "custom.python_function") return resolved;
  const signature = parsePythonFunctionSignature(String(parameters.code ?? ""));
  if (signature.error) return resolved;
  return {
    ...resolved,
    inputPorts: signature.inputPorts,
    outputPorts: signature.outputPorts,
    parameters: [...resolved.parameters, ...signature.parameters],
  };
}
