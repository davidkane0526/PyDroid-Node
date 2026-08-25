export type PythonNodeProviderDescriptor = {
  nodeType: string;
  source: string;
  entrypoint?: string;
};

const providers = new Map<string, Required<PythonNodeProviderDescriptor>>();

function normalizeDescriptor(descriptor: PythonNodeProviderDescriptor): Required<PythonNodeProviderDescriptor> {
  const nodeType = descriptor.nodeType.trim();
  const source = descriptor.source.trim();
  const entrypoint = (descriptor.entrypoint ?? "execute").trim();
  if (!nodeType) throw new Error("Python Provider nodeType 不能为空");
  if (!source) throw new Error(`Python Provider source 不能为空：${nodeType}`);
  if (!entrypoint) throw new Error(`Python Provider entrypoint 不能为空：${nodeType}`);
  return { nodeType, source, entrypoint };
}

export function registerPythonNodeProvider(descriptor: PythonNodeProviderDescriptor): () => boolean {
  const normalized = normalizeDescriptor(descriptor);
  if (providers.has(normalized.nodeType)) throw new Error(`Python Provider already registered: ${normalized.nodeType}`);
  providers.set(normalized.nodeType, normalized);
  let active = true;
  return () => {
    if (!active) return false;
    active = false;
    return providers.delete(normalized.nodeType);
  };
}

export function unregisterPythonNodeProvider(nodeType: string): boolean {
  return providers.delete(nodeType);
}

export function hasPythonNodeProvider(nodeType: string): boolean {
  return providers.has(nodeType);
}

export function listPythonNodeProviders(): Required<PythonNodeProviderDescriptor>[] {
  return [...providers.values()].map((descriptor) => ({ ...descriptor }));
}
