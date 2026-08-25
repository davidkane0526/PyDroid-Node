import type { NodeSpec, PythonNodeProviderDescriptor } from "./node";
import type { UiThemeDefinition } from "./theme";

/** ZIP plugin archive schema (`manifest.json`). */
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
  nodes?: NodePluginArchiveNode[];
  themes?: UiThemeDefinition[];
  resources?: string[];
};

export type PythonProviderSource = Omit<PythonNodeProviderDescriptor, "nodeType">;
