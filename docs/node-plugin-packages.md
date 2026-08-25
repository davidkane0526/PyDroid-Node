# Node Plugin Packages

PyDroid Node 1.6.31 exposes one deterministic plugin path: NodeSpec + Runtime Providers + optional packaged resources. A JSON Manifest is the installed form; `.plugin.zip` is only the file container used to load that same Manifest.

## Package formats

A serializable package can embed provider source and resources directly. A `.plugin.zip` instead keeps provider/resource files separate and resolves them once during installation.

```text
example.plugin.zip
├─ manifest.json
├─ js/
│  └─ scale.js
├─ python/
│  └─ scale.py
└─ resources/
   ├─ config.json
   └─ icon.svg
```

Archive `manifest.json` references exact files:

```json
{
  "schemaVersion": 1,
  "id": "example.scale-tools",
  "name": "Scale Tools",
  "version": "1.0.0",
  "nodes": [
    {
      "spec": {
        "nodeType": "example.scale",
        "label": "Scale",
        "category": "自定义",
        "runtimeSupport": ["python", "javascript"],
        "defaults": {},
        "parameters": [],
        "inputPorts": [{ "id": "input", "label": "Value", "valueType": "number" }],
        "outputPorts": [{ "id": "output", "label": "Scaled", "valueType": "number" }]
      },
      "icon": "resources/icon.svg",
      "providers": {
        "javascript": { "file": "js/scale.js" },
        "python": { "file": "python/scale.py" }
      }
    }
  ],
  "resources": ["resources/config.json", "resources/icon.svg"]
}
```

Only files listed in `resources` become Runtime resources. Provider files are loaded as source, not as resources. Installation reads the archive once and persists provider source plus resource bytes in the normal package Manifest, so later enable/restore does not need the original ZIP.

## Lifecycle

`src/nodePluginSdk.ts` is the combined authoring surface.

```ts
import {
  installNodePluginPackage,
  installNodePluginArchive,
  unloadNodePluginPackage,
  activateInstalledNodePluginPackage,
  uninstallNodePluginPackage,
  restoreNodePluginPackages,
} from "./nodePluginSdk";
```

- `installNodePluginPackage(manifest)` validates, activates and persists one package.
- `installNodePluginArchive(arrayBuffer)` resolves root `manifest.json`, provider files and declared resources, then calls the same package installer.
- `unloadNodePluginPackage(id)` removes live NodeSpecs/Providers but keeps the installed package.
- `activateInstalledNodePluginPackage(id)` activates one installed but unloaded package.
- `restoreNodePluginPackages()` activates persisted packages during application startup.
- `uninstallNodePluginPackage(id)` removes both live registrations and the persisted package.

## JavaScript Runtime API v2

JavaScript Providers use `execute(params, upstream, context, api)`.

```js
function execute(params, upstream, context, api) {
  const config = JSON.parse(api.resources.text("resources/config.json"));
  return Number(upstream ?? 0) * Number(config.factor);
}
```

Runtime API v2 provides:

```text
api.Table
api.resources.list()
api.resources.bytes(path)
api.resources.text(path)
api.resources.dataUrl(path)
```

`bytes()` returns `Uint8Array`. `text()` decodes UTF-8. `dataUrl()` uses the stored resource MIME type. The API is read-only and package-local; it is not a filesystem API.

## Python Runtime resources

Python Providers receive the same package resources through execution context:

```python
import json

def execute(params, upstream, context):
    config = json.loads(context["resources"].text("resources/config.json"))
    return float(upstream or 0) * float(config["factor"])
```

Available methods are:

```text
context["resources"].list()
context["resources"].bytes(path)
context["resources"].text(path)
context["resources"].data_url(path)
```

The resource descriptor travels with the existing Python Runtime Provider request, so desktop, Android and Remote Python execution use the same contract.

## Node icons

A package node may declare:

```json
"icon": "resources/icon.svg"
```

The icon path must also appear in the package `resources` list. Active plugin node cards and the Node Plugin Manager render that resource directly from the installed package data; there is no second icon store.

## User-facing manager

Open **节点插件** from the desktop toolbar or mobile **更多工具**. The manager intentionally keeps four operations:

- **安装插件**
- **启用**
- **停用**
- **卸载**

No dependency resolver, update service, retry loop, compatibility fallback or writable resource layer is part of this path.

## Examples

- Demo 27/28: Manifest and multi-node Provider packages.
- Demo 29: JSON resource read in both JavaScript and Python.
- Demo 30: packaged CSV resource → native Table → first-party Plot.
- Demo 31: grouped parameters + status cards + packaged help in a host-rendered plugin Inspector.
- Demo 32: declarative plugin Inspector → native Table → first-party Plot.
- Demo 33: conditional parameter groups/status/help + linked select options.
- Demo 34: linked enum table parameters → native Table → first-party Plot.
- `examples/plugins/`: directly serializable Manifest examples.
- `examples/plugin-archives/`: real `.plugin.zip` examples and their source trees.

## Declarative node Inspector UI

NodeSpec SDK v5 adds host-rendered Inspector metadata and declarative conditions. Plugins declare structure only; PyDroid Node owns every rendered control.

```json
{
  "ui": {
    "parameterGroups": [
      {
        "id": "calculation",
        "label": "Calculation",
        "parameters": ["factor", "offset"],
        "description": "Linear transform parameters."
      }
    ],
    "status": [
      { "label": "Factor", "parameter": "factor", "when": { "mode": "scale" } },
      { "label": "Enabled", "parameter": "enabled" }
    ],
    "help": {
      "title": "Declarative UI",
      "text": "Short host-rendered help.",
      "resource": "resources/help.md",
      "when": { "showHelp": true }
    }
  }
}
```

Rules are intentionally small:

- `parameterGroups` reference normal NodeSpec parameters and reuse the standard host `ParameterField` controls. Groups may declare `when`. A grouped parameter stays owned by that group; hiding the group does not move the parameter into another Inspector section.
- Parameters may declare `visibleWhen`. Select parameters may declare ordered `optionVariants`, each with `when` and a complete replacement `options` list. The host changes the visible option list but does not silently mutate the current parameter value.
- `status` is read-only and reflects current parameter values; each item may declare `when`.
- `help.text` is plain text. `help.resource` must be a declared package resource and is rendered as text from the installed resource bytes; the help block may also declare `when`.
- All `when` declarations use the same exact-match condition object already used by NodeSpec variants and dynamic input groups. There is no second expression language or UI callback.
- One parameter cannot be present in multiple groups or be both an inline node control and an Inspector group parameter.
- There is no plugin `component`, `render`, HTML injection, React entrypoint or DOM callback.

Runnable examples are `demo-declarative-scale.plugin.zip`, `demo-declarative-table.plugin.zip`, `demo-conditional-ui.plugin.zip` and `demo-linked-enum-table.plugin.zip` under `examples/plugin-archives/`, paired with Demo 31–34.
