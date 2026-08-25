import type { ExecutionContext, NodeOutput } from "./nodes/support/types";

export type JavascriptNodeProviderRequest = {
  nodeType: string;
  params: Record<string, unknown>;
  upstream: unknown;
  context: ExecutionContext;
};

export type JavascriptNodeProvider = (request: JavascriptNodeProviderRequest) => NodeOutput;

const providers = new Map<string, JavascriptNodeProvider>();

export function registerJavascriptNodeProvider(nodeType: string, provider: JavascriptNodeProvider): () => boolean {
  const key = nodeType.trim();
  if (!key) throw new Error("JavaScript Provider nodeType 不能为空");
  if (providers.has(key)) throw new Error(`JavaScript Provider already registered: ${key}`);
  providers.set(key, provider);
  let active = true;
  return () => {
    if (!active) return false;
    active = false;
    return providers.delete(key);
  };
}

export function unregisterJavascriptNodeProvider(nodeType: string): boolean {
  return providers.delete(nodeType);
}

export function getJavascriptNodeProvider(nodeType: string): JavascriptNodeProvider | undefined {
  return providers.get(nodeType);
}

export function hasJavascriptNodeProvider(nodeType: string): boolean {
  return providers.has(nodeType);
}
