export type NodePluginResource = {
  path: string;
  base64: string;
  mimeType?: string;
};

export type NodePluginResourceApi = {
  list: () => string[];
  bytes: (path: string) => Uint8Array;
  text: (path: string) => string;
  dataUrl: (path: string) => string;
};

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function resourceMimeType(path: string): string {
  const extension = path.toLowerCase().split(".").pop() ?? "";
  if (extension === "svg") return "image/svg+xml";
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "json") return "application/json";
  if (extension === "csv") return "text/csv";
  if (extension === "html") return "text/html";
  if (extension === "css") return "text/css";
  if (extension === "js") return "text/javascript";
  if (extension === "txt" || extension === "md" || extension === "py") return "text/plain";
  return "application/octet-stream";
}

export function createNodePluginResourceApi(resources: NodePluginResource[] = []): NodePluginResourceApi {
  const byPath = new Map(resources.map((resource) => [resource.path, resource]));
  const get = (path: string): NodePluginResource => {
    const resource = byPath.get(path);
    if (!resource) throw new Error(`插件资源不存在：${path}`);
    return resource;
  };
  return Object.freeze({
    list: () => [...byPath.keys()],
    bytes: (path: string) => base64ToBytes(get(path).base64),
    text: (path: string) => new TextDecoder("utf-8", { fatal: true }).decode(base64ToBytes(get(path).base64)),
    dataUrl: (path: string) => {
      const resource = get(path);
      return `data:${resource.mimeType || resourceMimeType(path)};base64,${resource.base64}`;
    },
  });
}
