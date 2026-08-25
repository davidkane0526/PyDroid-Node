import { APP_VERSION } from "../app-version";

export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-11-25"] as const;

export function isSupportedMcpProtocolVersion(value: string): boolean {
  return (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(value);
}
export type JsonRpcId = string | number | null;
export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

export type McpToolDefinition = {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
};

const anyObjectSchema = { type: "object", additionalProperties: true } as const;

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: "core_describe",
    title: "Describe PyDroid Core",
    description: "Describe the MCP-exposed PyDroid Core domains, paths, commands, runtimes, and active workspace.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: anyObjectSchema,
  },
  {
    name: "core_read",
    title: "Read PyDroid Core",
    description: "Read a Core path such as workflow, workflow.nodes, editor, runtime, execution, data, or node.contracts.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        workspaceId: { type: "string" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    outputSchema: anyObjectSchema,
  },
  {
    name: "core_command",
    title: "Command PyDroid Core",
    description: "Execute one explicit Core command against the current or specified workspace.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        args: { type: "object", additionalProperties: true },
        workspaceId: { type: "string" },
      },
      required: ["command"],
      additionalProperties: false,
    },
    outputSchema: anyObjectSchema,
  },
  {
    name: "core_patch",
    title: "Patch PyDroid Workflow",
    description: "Apply a deterministic sequence of existing EditorGraphCommand operations to one workflow.",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: { type: "string" },
        operations: { type: "array", items: { type: "object", additionalProperties: true }, minItems: 1 },
      },
      required: ["operations"],
      additionalProperties: false,
    },
    outputSchema: anyObjectSchema,
  },
  {
    name: "core_run",
    title: "Run PyDroid Workflow",
    description: "Run the current workflow with auto, Python, or JavaScript runtime semantics.",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: { type: "string" },
        runtime: { type: "string", enum: ["auto", "python", "javascript"] },
        timeoutMs: { type: "number", minimum: 1 },
      },
      additionalProperties: false,
    },
    outputSchema: anyObjectSchema,
  },
  {
    name: "core_snapshot",
    title: "Snapshot PyDroid Core",
    description: "Return one compact debugging snapshot of workflow, editor state, runtimes, execution, data metadata, node contracts, and errors.",
    inputSchema: {
      type: "object",
      properties: { workspaceId: { type: "string" } },
      additionalProperties: false,
    },
    outputSchema: anyObjectSchema,
  },
  {
    name: "workflow_run",
    title: "Run Workflow",
    description: "Convenience alias for core_run.",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: { type: "string" },
        runtime: { type: "string", enum: ["auto", "python", "javascript"] },
        timeoutMs: { type: "number", minimum: 1 },
      },
      additionalProperties: false,
    },
    outputSchema: anyObjectSchema,
  },
  {
    name: "workflow_stop",
    title: "Stop Workflow",
    description: "Stop the active execution for the current or specified workspace.",
    inputSchema: { type: "object", properties: { workspaceId: { type: "string" } }, additionalProperties: false },
    outputSchema: anyObjectSchema,
  },
  {
    name: "node_contract",
    title: "Read Node Contract",
    description: "Read the canonical NodeContract and NodeSpec for one node type.",
    inputSchema: {
      type: "object",
      properties: { nodeType: { type: "string" } },
      required: ["nodeType"],
      additionalProperties: false,
    },
    outputSchema: anyObjectSchema,
  },
  {
    name: "data_preview",
    title: "Preview Workspace Data",
    description: "Read current workspace input metadata and a bounded preview of the latest execution result.",
    inputSchema: {
      type: "object",
      properties: { workspaceId: { type: "string" }, limit: { type: "number", minimum: 1, maximum: 100 } },
      additionalProperties: false,
    },
    outputSchema: anyObjectSchema,
  },
];

export function jsonRpcResult(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

export function jsonRpcError(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

export function mcpResultMetadata(): Record<string, unknown> {
  return {
    "io.modelcontextprotocol/serverInfo": { name: "PyDroid Node", version: APP_VERSION },
  };
}
