import {
  installNodePluginPackage,
  type JavascriptNodeProviderDescriptor,
  type NodePluginPackageManifest,
  type NodePluginPackageRegistration,
  type NodePluginPackageStorage,
} from "./nodePluginPackages";
import type { NodeSpec, PythonNodeProviderDescriptor } from "./nodeSpecSdk";
import { bytesToBase64, resourceMimeType } from "./nodePluginResources";

export const NODE_PLUGIN_ARCHIVE_SCHEMA_VERSION = 1 as const;
export const NODE_PLUGIN_ARCHIVE_MANIFEST = "manifest.json" as const;

export type NodePluginArchiveProviderFile = {
  file: string;
  entrypoint?: string;
};

export type NodePluginArchiveNode = {
  spec: NodeSpec;
  icon?: string;
  providers: {
    javascript?: NodePluginArchiveProviderFile;
    python?: NodePluginArchiveProviderFile;
  };
};

export type NodePluginArchiveManifest = {
  schemaVersion: typeof NODE_PLUGIN_ARCHIVE_SCHEMA_VERSION;
  id: string;
  name: string;
  version: string;
  description?: string;
  nodes: NodePluginArchiveNode[];
  resources?: string[];
};

type ZipEntry = {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
  encrypted: boolean;
};

const utf8 = new TextDecoder("utf-8", { fatal: true });

function readUint32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function findEndOfCentralDirectory(view: DataView): number {
  const minimum = Math.max(0, view.byteLength - 65_557);
  for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
    if (readUint32(view, offset) === 0x06054b50) return offset;
  }
  throw new Error("不是有效的 ZIP 文件：缺少中央目录");
}

function readZipDirectory(buffer: ArrayBuffer): ZipEntry[] {
  const view = new DataView(buffer);
  const eocd = findEndOfCentralDirectory(view);
  const totalEntries = view.getUint16(eocd + 10, true);
  const centralOffset = readUint32(view, eocd + 16);
  const entries: ZipEntry[] = [];
  let offset = centralOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (readUint32(view, offset) !== 0x02014b50) throw new Error("ZIP 中央目录损坏");
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = readUint32(view, offset + 20);
    const uncompressedSize = readUint32(view, offset + 24);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = readUint32(view, offset + 42);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) throw new Error("暂不支持 ZIP64 插件包");
    const name = utf8.decode(new Uint8Array(buffer, offset + 46, nameLength));
    entries.push({ name, method, compressedSize, uncompressedSize, localOffset, encrypted: Boolean(flags & 1) });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZipEntry(buffer: ArrayBuffer, entry: ZipEntry): Promise<Uint8Array> {
  if (entry.encrypted) throw new Error(`插件包不支持加密 ZIP：${entry.name}`);
  const view = new DataView(buffer);
  if (readUint32(view, entry.localOffset) !== 0x04034b50) throw new Error(`ZIP 文件项损坏：${entry.name}`);
  const nameLength = view.getUint16(entry.localOffset + 26, true);
  const extraLength = view.getUint16(entry.localOffset + 28, true);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const compressed = new Uint8Array(buffer, start, entry.compressedSize);
  const bytes = entry.method === 0 ? new Uint8Array(compressed) : entry.method === 8 ? await inflateRaw(compressed) : undefined;
  if (!bytes) throw new Error(`插件包包含不支持的 ZIP 压缩方式：${entry.method}`);
  if (bytes.byteLength !== entry.uncompressedSize) throw new Error(`ZIP 文件项长度不匹配：${entry.name}`);
  return bytes;
}

function validPluginPath(path: string): boolean {
  return Boolean(path) && !path.startsWith("/") && !path.includes("\\") && !path.split("/").includes("..");
}

function parseArchiveManifest(text: string): NodePluginArchiveManifest {
  const parsed = JSON.parse(text) as NodePluginArchiveManifest;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("插件包 manifest.json 必须是 JSON 对象");
  if (parsed.schemaVersion !== NODE_PLUGIN_ARCHIVE_SCHEMA_VERSION) throw new Error(`不支持的插件包 schemaVersion：${parsed.schemaVersion}`);
  if (!parsed.id?.trim() || !parsed.name?.trim() || !parsed.version?.trim()) throw new Error("插件包 manifest.json 缺少 id、name 或 version");
  if (!Array.isArray(parsed.nodes) || !parsed.nodes.length) throw new Error("插件包 manifest.json 至少包含一个节点");
  for (const node of parsed.nodes) {
    if (node.icon && !validPluginPath(node.icon)) throw new Error(`插件包图标路径无效：${node.icon}`);
    for (const descriptor of [node.providers?.javascript, node.providers?.python]) {
      if (descriptor && !validPluginPath(descriptor.file)) throw new Error(`插件包 Provider 路径无效：${descriptor.file}`);
    }
  }
  for (const resource of parsed.resources ?? []) if (!validPluginPath(resource)) throw new Error(`插件包资源路径无效：${resource}`);
  return parsed;
}

export async function readNodePluginArchive(buffer: ArrayBuffer): Promise<NodePluginPackageManifest> {
  const entries = readZipDirectory(buffer);
  const byName = new Map(entries.filter((entry) => !entry.name.endsWith("/")).map((entry) => [entry.name, entry]));
  const manifestEntry = byName.get(NODE_PLUGIN_ARCHIVE_MANIFEST);
  if (!manifestEntry) throw new Error(`插件包缺少 ${NODE_PLUGIN_ARCHIVE_MANIFEST}`);
  const archive = parseArchiveManifest(utf8.decode(await readZipEntry(buffer, manifestEntry)));

  const readText = async (path: string): Promise<string> => {
    const entry = byName.get(path);
    if (!entry) throw new Error(`插件包缺少文件：${path}`);
    return utf8.decode(await readZipEntry(buffer, entry));
  };
  const resourcePaths = archive.resources ?? [];
  for (const resource of resourcePaths) if (!byName.has(resource)) throw new Error(`插件包缺少资源：${resource}`);
  for (const node of archive.nodes) if (node.icon && !resourcePaths.includes(node.icon)) throw new Error(`插件节点图标未声明为资源：${node.icon}`);
  const resources = await Promise.all(resourcePaths.map(async (path) => {
    const entry = byName.get(path)!;
    return { path, base64: bytesToBase64(await readZipEntry(buffer, entry)), mimeType: resourceMimeType(path) };
  }));

  const nodes = await Promise.all(archive.nodes.map(async (node) => {
    const javascript: JavascriptNodeProviderDescriptor | undefined = node.providers.javascript ? {
      source: await readText(node.providers.javascript.file),
      entrypoint: node.providers.javascript.entrypoint,
    } : undefined;
    const python: Omit<PythonNodeProviderDescriptor, "nodeType"> | undefined = node.providers.python ? {
      source: await readText(node.providers.python.file),
      entrypoint: node.providers.python.entrypoint,
    } : undefined;
    return { spec: node.spec, icon: node.icon, providers: { javascript, python } };
  }));

  return {
    schemaVersion: 1,
    id: archive.id,
    name: archive.name,
    version: archive.version,
    description: archive.description,
    nodes,
    resources,
  };
}

export async function installNodePluginArchive(
  buffer: ArrayBuffer,
  options: { persist?: boolean; storage?: NodePluginPackageStorage } = {},
): Promise<NodePluginPackageRegistration> {
  return installNodePluginPackage(await readNodePluginArchive(buffer), options);
}
