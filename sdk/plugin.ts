import type { NodeSpec, PythonNodeProviderDescriptor } from "./node";
import type { NodePluginResource } from "./resources";
import type { UiThemeDefinition } from "./theme";

/** JSON plugin manifest schema consumed by the PyDroid Node plugin host. */
export const NODE_PLUGIN_PACKAGE_SCHEMA_VERSION = 1 as const;
/** Runtime API exposed to JavaScript providers inside an installed plugin. */
export const NODE_PLUGIN_RUNTIME_API_VERSION = 2 as const;

export type JavascriptNodeProviderDescriptor = {
  source: string;
  entrypoint?: string;
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
