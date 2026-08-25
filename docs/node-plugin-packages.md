# Node Plugin Packages

PyDroid Node 1.6.28 exposes both the serializable Manifest layer and a real `.plugin.zip` file container through the Node Plugin Manager, NodeSpec SDK and Runtime Provider SDK.

## Package formats

The core installed form remains one serializable JSON Manifest. PyDroid Node 1.6.28 also accepts a `.plugin.zip` archive whose root contains `manifest.json`; that archive references provider files instead of embedding provider source. After reading the archive, PyDroid resolves it into the same installed Manifest used by the existing lifecycle, so restart/enable/disable/uninstall semantics do not depend on the original ZIP path.

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
        "defaults": { "factor": 2 },
        "parameters": [
          { "key": "factor", "label": "Factor", "kind": "number" }
        ],
        "inputPorts": [
          { "id": "input", "label": "Value", "valueType": "number", "required": true },
          { "id": "factor", "label": "Factor", "valueType": "number", "defaultParameter": "factor" }
        ],
        "outputPorts": [
          { "id": "output", "label": "Scaled", "valueType": "number" }
        ]
      },
      "providers": {
        "javascript": {
          "source": "function execute(params, upstream, context, api) { return { output: Number(upstream ?? 0) * Number(params.factor ?? 1) }; }"
        },
        "python": {
          "source": "def execute(params, upstream, context):\n    return {'output': float(upstream or 0) * float(params.get('factor', 1))}\n"
        }
      }
    }
  ]
}
```

`runtimeSupport` and `providers` must agree. A package cannot declare JavaScript/Python execution and omit the corresponding provider.

### `.plugin.zip` container

The archive layout is deliberately fixed and small:

```text
example.plugin.zip
├─ manifest.json
├─ js/
│  └─ scale.js
├─ python/
│  └─ scale.py
└─ resources/
   └─ icon.png
```

`manifest.json` uses file references for providers:

```json
{
  "schemaVersion": 1,
  "id": "example.scale-tools",
  "name": "Scale Tools",
  "version": "1.0.0",
  "nodes": [
    {
      "spec": { "nodeType": "example.scale", "label": "Scale", "runtimeSupport": ["python", "javascript"], "defaults": {}, "parameters": [], "inputPorts": [], "outputPorts": [] },
      "providers": {
        "javascript": { "file": "js/scale.js", "entrypoint": "execute" },
        "python": { "file": "python/scale.py", "entrypoint": "execute" }
      }
    }
  ],
  "resources": ["resources/icon.png"]
}
```

Provider files are read once during installation and converted to the existing serializable source descriptors. Listed resources are treated as opaque archive files; 1.6.28 verifies that they exist but does not yet expose a resource API to providers. The archive reader supports standard STORE and DEFLATE ZIP entries and does not add dependency installation or format fallback.

## Lifecycle

`src/nodePluginSdk.ts` is the combined authoring surface.

```ts
import {
  installNodePluginPackage,
  installNodePluginArchive,
  unloadNodePluginPackage,
  uninstallNodePluginPackage,
  restoreNodePluginPackages,
} from "./nodePluginSdk";
```

- `installNodePluginPackage(manifest)` validates, compiles and atomically registers every NodeSpec and Runtime Provider, then persists the manifest in renderer storage.
- `installNodePluginArchive(arrayBuffer)` reads root `manifest.json` plus referenced provider files, resolves them into the same Manifest contract, then calls the same installation path.
- `unloadNodePluginPackage(id)` removes the live NodeSpecs and Providers but keeps the installed manifest.
- `restoreNodePluginPackages()` reactivates persisted manifests. The application invokes this before the React editor mounts.
- `uninstallNodePluginPackage(id)` removes both the live registration and the persisted manifest.
- Multi-node packages are atomic: if any node collides or fails registration, previously registered nodes in that same package are rolled back.

The manager uses the same lifecycle API as code-driven installation. `listInstalledNodePluginPackageDetails()` exposes installed/active state and node runtime metadata, while `activateInstalledNodePluginPackage(id)` reactivates a persisted but unloaded package.

## User-facing manager

Open **节点插件** from the desktop toolbar or the mobile **更多工具** menu. The manager intentionally has four operations only:

- **安装插件**: choose either one `.json` Manifest or `.plugin.zip`; both resolve into the same installed Manifest lifecycle.
- **停用**: unload live NodeSpecs/Providers while keeping the installed Manifest.
- **启用**: reactivate the persisted Manifest.
- **卸载**: remove both live registrations and the persisted Manifest.

The manager shows package version, each node type/label and declared Python/JavaScript runtime support.

## JavaScript provider runtime API

Manifest JavaScript providers use a serializable source string with an `execute` entrypoint:

```js
function execute(params, upstream, context, api) {
  return { output: 42 };
}
```

The current runtime API is version 1. It exposes the native JavaScript `Table` implementation:

```js
function execute(params, upstream, context, api) {
  return api.Table.fromRecords([
    { index: 0, value: 1 },
    { index: 1, value: 3 }
  ]);
}
```

Returning a `Table` automatically produces a normal table output that can feed first-party table or plot nodes. Providers may also return a plain output map such as `{output: 3}` or a full `NodeOutput` object.

## Python provider runtime

Python source is already transported by the existing Runtime Provider contract. It is loaded only for the current workflow execution and is not inserted into the global first-party handler registry.

```python
def execute(params, upstream, context):
    return pd.DataFrame({"index": [0, 1], "value": [1, 3]})
```

The same manifest works through desktop, Android and Remote Python execution because provider descriptors travel with the workflow request.

## Current boundary

The Manifest installer/manager and `.plugin.zip` container are user-facing. This layer still does not add dependency resolution, automatic updates, package signatures, a marketplace or a provider resource API. Those are separate capabilities and are not emulated with fallback logic.

Runnable inline-Manifest examples are included in `examples/plugins/`; real archive examples and their source trees live under `examples/plugin-archives/`. Built-in Demo 27/28 remain the runtime workflows used by both forms.
