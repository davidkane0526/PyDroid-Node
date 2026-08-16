import type { WorkflowNode } from "../workflow";
import type { RuntimeAdapter, RuntimeId, RuntimePreference } from "./types";

const adapters = new Map<RuntimeId, RuntimeAdapter>();

export function registerRuntime(adapter: RuntimeAdapter): void {
  adapters.set(adapter.descriptor.id, adapter);
}

export function getRuntime(id: RuntimeId): RuntimeAdapter {
  const runtime = adapters.get(id);
  if (!runtime) throw new Error(`运行时 ${id} 尚未注册`);
  return runtime;
}

export function listRuntimes(): RuntimeAdapter[] {
  return [...adapters.values()];
}

export function resolveRuntime(preference: RuntimePreference, nodes: WorkflowNode[]): RuntimeAdapter {
  if (preference !== "auto") return getRuntime(preference);
  const javascript = adapters.get("javascript");
  if (javascript) {
    const support = javascript.canExecute?.(nodes) ?? { supported: true };
    if (support.supported) return javascript;
  }
  return getRuntime("python");
}
