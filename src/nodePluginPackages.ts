import {
  defineNodeSpec,
  registerNodePlugin,
  type JavascriptNodeProvider,
  type NodePluginRegistration,
  type NodeSpec,
  type PythonNodeProviderDescriptor,
} from "./nodeSpecSdk";
import { Table } from "./runtime/javascript/engine/table";
import type { NodeOutput } from "./runtime/javascript/engine/nodes/support/types";
import { createNodePluginResourceApi, type NodePluginResource, type NodePluginResourceApi } from "./nodePluginResources";
import { registerUiTheme, validateUiThemeDefinition, type UiThemeDefinition, type UiThemeRegistration } from "./themePluginSdk";

export const NODE_PLUGIN_PACKAGE_SCHEMA_VERSION = 1 as const;
export const NODE_PLUGIN_RUNTIME_API_VERSION = 2 as const;
const STORAGE_KEY = "pydroid-node.plugin-packages.v1";

export type JavascriptNodeProviderDescriptor = {
  source: string;
  entrypoint?: string;
};

export type JavascriptPluginRuntimeApi = {
  version: typeof NODE_PLUGIN_RUNTIME_API_VERSION;
  Table: typeof Table;
  resources: NodePluginResourceApi;
};

export type NodePluginPackageNode = {
  spec: NodeSpec;
  icon?: string;
  providers: {
    javascript?: JavascriptNodeProviderDescriptor;
    python?: Omit<PythonNodeProviderDescriptor, "nodeType">;
  };
};

export type NodePluginPackageManifest = {
  schemaVersion: typeof NODE_PLUGIN_PACKAGE_SCHEMA_VERSION;
  id: string;
  name: string;
  version: string;
  description?: string;
  nodes?: NodePluginPackageNode[];
  themes?: UiThemeDefinition[];
  resources?: NodePluginResource[];
};

export type NodePluginPackageSummary = {
  id: string;
  name: string;
  version: string;
  nodeTypes: string[];
  themeIds: string[];
};

export type NodePluginPackageDetail = NodePluginPackageSummary & {
  description?: string;
  active: boolean;
  nodes: Array<{ nodeType: string; label: string; runtimes: Array<"python" | "javascript">; iconDataUrl?: string }>;
  themes: Array<{ id: string; labelZh: string; labelEn: string }>;
};

export type NodePluginPackageStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type NodePluginPackageRegistration = NodePluginPackageSummary & {
  unload: () => boolean;
  uninstall: () => boolean;
};

type ActivePackage = {
  manifest: NodePluginPackageManifest;
  registrations: NodePluginRegistration[];
  themeRegistrations: UiThemeRegistration[];
};

const activePackages = new Map<string, ActivePackage>();

function browserStorage(): NodePluginPackageStorage | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}

function validateIdentifier(value: string, label: string, errors: string[]): void {
  if (!value.trim()) errors.push(`${label} 不能为空`);
}

function normalizeJavascriptOutput(value: unknown): NodeOutput {
  if (value && typeof value === "object" && "outputs" in value) {
    const result = value as Partial<NodeOutput>;
    return {
      outputs: result.outputs && typeof result.outputs === "object" ? result.outputs : {},
      tableResult: result.tableResult instanceof Table ? result.tableResult : null,
      plotResult: result.plotResult ?? null,
      exportResult: typeof result.exportResult === "string" ? result.exportResult : null,
    };
  }
  if (value instanceof Table) return { outputs: { output: value }, tableResult: value, plotResult: null, exportResult: null };
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const outputs = value as Record<string, unknown>;
    const table = Object.values(outputs).find((item) => item instanceof Table);
    return { outputs, tableResult: table instanceof Table ? table : null, plotResult: null, exportResult: null };
  }
  return { outputs: { output: value }, tableResult: null, plotResult: null, exportResult: null };
}

function compileJavascriptProvider(descriptor: JavascriptNodeProviderDescriptor, nodeType: string, resources: NodePluginResource[]): JavascriptNodeProvider {
  const source = descriptor.source.trim();
  const entrypoint = (descriptor.entrypoint ?? "execute").trim();
  if (!source) throw new Error(`${nodeType}: JavaScript Provider source 不能为空`);
  if (!/^[A-Za-z_$][\w$]*$/.test(entrypoint)) throw new Error(`${nodeType}: JavaScript Provider entrypoint 无效：${entrypoint}`);
  const resourceApi = createNodePluginResourceApi(resources);
  const api: JavascriptPluginRuntimeApi = Object.freeze({ version: NODE_PLUGIN_RUNTIME_API_VERSION, Table, resources: resourceApi });
  const factory = new Function("api", `"use strict";\n${source}\nif (typeof ${entrypoint} !== "function") throw new Error("JavaScript Provider entrypoint not found: ${entrypoint}");\nreturn ${entrypoint};`);
  const execute = factory(api) as (params: Record<string, unknown>, upstream: unknown, context: unknown, api: JavascriptPluginRuntimeApi) => unknown;
  return ({ params, upstream, context }) => normalizeJavascriptOutput(execute(params, upstream, context, api));
}

export function validateNodePluginPackageManifest(manifest: NodePluginPackageManifest): string[] {
  const errors: string[] = [];
  if (manifest.schemaVersion !== NODE_PLUGIN_PACKAGE_SCHEMA_VERSION) errors.push(`不支持的插件 Manifest schemaVersion：${manifest.schemaVersion}`);
  validateIdentifier(manifest.id, "插件 id", errors);
  validateIdentifier(manifest.name, "插件 name", errors);
  validateIdentifier(manifest.version, "插件 version", errors);
  const nodes = manifest.nodes ?? [];
  const themes = manifest.themes ?? [];
  if (!nodes.length && !themes.length) errors.push(`${manifest.id || "<plugin>"}: 至少包含一个节点或主题`);
  const resourcePaths = new Set((manifest.resources ?? []).map((resource) => resource.path));
  for (const resource of manifest.resources ?? []) {
    if (!resource.path.trim()) errors.push(`${manifest.id || "<plugin>"}: resource path 不能为空`);
    if (!resource.base64.trim()) errors.push(`${manifest.id || "<plugin>"}: resource 内容为空：${resource.path}`);
  }
  const nodeTypes = new Set<string>();
  for (const [index, node] of nodes.entries()) {
    const specErrors: string[] = [];
    try { defineNodeSpec(node.spec); } catch (error) { specErrors.push(error instanceof Error ? error.message : String(error)); }
    errors.push(...specErrors.map((message) => `${manifest.id || "<plugin>"}.nodes[${index}]: ${message}`));
    if (nodeTypes.has(node.spec.nodeType)) errors.push(`${manifest.id || "<plugin>"}: nodeType 重复：${node.spec.nodeType}`);
    nodeTypes.add(node.spec.nodeType);
    if (node.icon && !resourcePaths.has(node.icon)) errors.push(`${node.spec.nodeType}: icon 资源不存在：${node.icon}`);
    const helpResource = node.spec.ui?.help?.resource;
    if (helpResource && !resourcePaths.has(helpResource)) errors.push(`${node.spec.nodeType}: help 资源不存在：${helpResource}`);
    const runtimes = node.spec.runtimeSupport ?? [];
    if (runtimes.includes("javascript") && !node.providers?.javascript) errors.push(`${node.spec.nodeType}: Manifest 缺少 JavaScript Provider`);
    if (runtimes.includes("python") && !node.providers?.python) errors.push(`${node.spec.nodeType}: Manifest 缺少 Python Provider`);
    if (node.providers?.javascript && !runtimes.includes("javascript")) errors.push(`${node.spec.nodeType}: 提供了 JavaScript Provider，但 NodeSpec 未声明 javascript Runtime`);
    if (node.providers?.python && !runtimes.includes("python")) errors.push(`${node.spec.nodeType}: 提供了 Python Provider，但 NodeSpec 未声明 python Runtime`);
  }
  const themeIds = new Set<string>();
  for (const [index, theme] of themes.entries()) {
    for (const message of validateUiThemeDefinition(theme)) errors.push(`${manifest.id || "<plugin>"}.themes[${index}]: ${message}`);
    if (themeIds.has(theme.id)) errors.push(`${manifest.id || "<plugin>"}: theme id 重复：${theme.id}`);
    themeIds.add(theme.id);
  }
  return errors;
}

export function parseNodePluginPackageManifest(input: string | unknown): NodePluginPackageManifest {
  const parsed = typeof input === "string" ? JSON.parse(input) : input;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("插件 Manifest 必须是 JSON 对象");
  const manifest = parsed as NodePluginPackageManifest;
  const errors = validateNodePluginPackageManifest(manifest);
  if (errors.length) throw new Error(`Invalid Node Plugin Manifest:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  return manifest;
}

function cloneManifest(manifest: NodePluginPackageManifest): NodePluginPackageManifest {
  return JSON.parse(JSON.stringify(manifest)) as NodePluginPackageManifest;
}

function readPersistedManifests(storage: NodePluginPackageStorage | undefined): NodePluginPackageManifest[] {
  if (!storage) return [];
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error("插件持久化数据格式无效");
  return parsed.map((item) => parseNodePluginPackageManifest(item));
}

function writePersistedManifests(storage: NodePluginPackageStorage | undefined, manifests: NodePluginPackageManifest[]): void {
  if (!storage) return;
  if (!manifests.length) { storage.removeItem(STORAGE_KEY); return; }
  storage.setItem(STORAGE_KEY, JSON.stringify(manifests));
}

function persistManifest(manifest: NodePluginPackageManifest, storage: NodePluginPackageStorage | undefined): void {
  if (!storage) return;
  const manifests = readPersistedManifests(storage).filter((item) => item.id !== manifest.id);
  manifests.push(cloneManifest(manifest));
  writePersistedManifests(storage, manifests);
}

function removePersistedManifest(id: string, storage: NodePluginPackageStorage | undefined): boolean {
  if (!storage) return false;
  const manifests = readPersistedManifests(storage);
  const next = manifests.filter((item) => item.id !== id);
  if (next.length === manifests.length) return false;
  writePersistedManifests(storage, next);
  return true;
}

export function activateNodePluginPackage(input: NodePluginPackageManifest | string): NodePluginPackageRegistration {
  const manifest = parseNodePluginPackageManifest(input);
  if (activePackages.has(manifest.id)) throw new Error(`插件已激活：${manifest.id}`);

  const resources = (manifest.resources ?? []).map((resource) => ({ ...resource }));
  const nodes = manifest.nodes ?? [];
  const themes = manifest.themes ?? [];
  const compiled = nodes.map((node) => ({
    spec: defineNodeSpec(node.spec),
    javascript: node.providers.javascript ? compileJavascriptProvider(node.providers.javascript, node.spec.nodeType, resources) : undefined,
    python: node.providers.python ? { ...node.providers.python, resources } : undefined,
  }));
  const registrations: NodePluginRegistration[] = [];
  const themeRegistrations: UiThemeRegistration[] = [];
  try {
    for (const node of compiled) registrations.push(registerNodePlugin({ spec: node.spec, javascript: node.javascript, python: node.python }));
    for (const theme of themes) themeRegistrations.push(registerUiTheme(theme));
  } catch (error) {
    for (const registration of themeRegistrations.reverse()) registration.unregister();
    for (const registration of registrations.reverse()) registration.unregister();
    throw error;
  }
  activePackages.set(manifest.id, { manifest: cloneManifest(manifest), registrations, themeRegistrations });
  const nodeTypes = nodes.map((node) => node.spec.nodeType);
  const themeIds = themes.map((theme) => theme.id);
  let active = true;
  const unload = () => {
    if (!active) return false;
    active = false;
    const current = activePackages.get(manifest.id);
    if (!current) return false;
    for (const registration of [...current.themeRegistrations].reverse()) registration.unregister();
    for (const registration of [...current.registrations].reverse()) registration.unregister();
    activePackages.delete(manifest.id);
    return true;
  };
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    nodeTypes,
    themeIds,
    unload,
    uninstall: () => {
      const unloaded = unload();
      const removed = removePersistedManifest(manifest.id, browserStorage());
      return unloaded || removed;
    },
  };
}

export function installNodePluginPackage(
  input: NodePluginPackageManifest | string,
  options: { persist?: boolean; storage?: NodePluginPackageStorage } = {},
): NodePluginPackageRegistration {
  const manifest = parseNodePluginPackageManifest(input);
  const storage = options.storage ?? browserStorage();
  const registration = activateNodePluginPackage(manifest);
  if (options.persist !== false) {
    try { persistManifest(manifest, storage); }
    catch (error) { registration.unload(); throw error; }
  }
  return {
    ...registration,
    uninstall: () => {
      const unloaded = registration.unload();
      const removed = removePersistedManifest(manifest.id, storage);
      return unloaded || removed;
    },
  };
}


export function activateInstalledNodePluginPackage(
  id: string,
  storage: NodePluginPackageStorage | undefined = browserStorage(),
): NodePluginPackageRegistration {
  const manifest = readPersistedManifests(storage).find((item) => item.id === id);
  if (!manifest) throw new Error(`插件未安装：${id}`);
  return activateNodePluginPackage(manifest);
}

export function listInstalledNodePluginPackageDetails(
  storage: NodePluginPackageStorage | undefined = browserStorage(),
): NodePluginPackageDetail[] {
  return readPersistedManifests(storage).map((manifest) => ({
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    active: activePackages.has(manifest.id),
    nodeTypes: (manifest.nodes ?? []).map((node) => node.spec.nodeType),
    themeIds: (manifest.themes ?? []).map((theme) => theme.id),
    nodes: (manifest.nodes ?? []).map((node) => ({
      nodeType: node.spec.nodeType,
      label: node.spec.label,
      runtimes: [...(node.spec.runtimeSupport ?? [])],
      iconDataUrl: node.icon ? createNodePluginResourceApi(manifest.resources ?? []).dataUrl(node.icon) : undefined,
    })),
    themes: (manifest.themes ?? []).map((theme) => ({ id: theme.id, labelZh: theme.labelZh, labelEn: theme.labelEn })),
  }));
}

export function unloadNodePluginPackage(id: string): boolean {
  const active = activePackages.get(id);
  if (!active) return false;
  for (const registration of [...active.themeRegistrations].reverse()) registration.unregister();
  for (const registration of [...active.registrations].reverse()) registration.unregister();
  activePackages.delete(id);
  return true;
}

export function uninstallNodePluginPackage(id: string, storage: NodePluginPackageStorage | undefined = browserStorage()): boolean {
  const unloaded = unloadNodePluginPackage(id);
  const removed = removePersistedManifest(id, storage);
  return unloaded || removed;
}

export function getNodePluginResourceText(nodeType: string, path: string): string | null {
  for (const { manifest } of activePackages.values()) {
    if ((manifest.nodes ?? []).some((node) => node.spec.nodeType === nodeType)) return createNodePluginResourceApi(manifest.resources ?? []).text(path);
  }
  return null;
}

export function getNodePluginIconDataUrl(nodeType: string): string | null {
  for (const { manifest } of activePackages.values()) {
    const node = (manifest.nodes ?? []).find((item) => item.spec.nodeType === nodeType);
    if (node?.icon) return createNodePluginResourceApi(manifest.resources ?? []).dataUrl(node.icon);
  }
  return null;
}

export function listActiveNodePluginPackages(): NodePluginPackageSummary[] {
  return [...activePackages.values()].map(({ manifest }) => ({
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    nodeTypes: (manifest.nodes ?? []).map((node) => node.spec.nodeType),
    themeIds: (manifest.themes ?? []).map((theme) => theme.id),
  }));
}

export function restoreNodePluginPackages(storage: NodePluginPackageStorage | undefined = browserStorage()): Array<{ id: string; error: string }> {
  const failures: Array<{ id: string; error: string }> = [];
  let manifests: NodePluginPackageManifest[];
  try { manifests = readPersistedManifests(storage); }
  catch (error) { return [{ id: "<storage>", error: error instanceof Error ? error.message : String(error) }]; }
  for (const manifest of manifests) {
    if (activePackages.has(manifest.id)) continue;
    try { activateNodePluginPackage(manifest); }
    catch (error) { failures.push({ id: manifest.id, error: error instanceof Error ? error.message : String(error) }); }
  }
  return failures;
}
