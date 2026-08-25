# Node Plugin Packages

PyDroid Node 1.6.26 adds the first serializable plugin-package layer on top of the NodeSpec and Runtime Provider SDKs.

## Package format

A package is one JSON manifest. The manifest is deliberately independent from the final file container, so a future `.zip` installer can wrap the same contract without changing NodeSpec or Runtime semantics.

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

## Lifecycle

`src/nodePluginSdk.ts` is the combined authoring surface.

```ts
import {
  installNodePluginPackage,
  unloadNodePluginPackage,
  uninstallNodePluginPackage,
  restoreNodePluginPackages,
} from "./nodePluginSdk";
```

- `installNodePluginPackage(manifest)` validates, compiles and atomically registers every NodeSpec and Runtime Provider, then persists the manifest in renderer storage.
- `unloadNodePluginPackage(id)` removes the live NodeSpecs and Providers but keeps the installed manifest.
- `restoreNodePluginPackages()` reactivates persisted manifests. The application invokes this before the React editor mounts.
- `uninstallNodePluginPackage(id)` removes both the live registration and the persisted manifest.
- Multi-node packages are atomic: if any node collides or fails registration, previously registered nodes in that same package are rolled back.

The package manager exposes `listActiveNodePluginPackages()` and `listInstalledNodePluginPackages()` for a future plugin-management UI.

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

This phase implements the package contract and automatic renderer-side activation/persistence. It does not yet add a user-facing plugin installer, dependency resolver, package signature system, marketplace, or ZIP container. Those can be layered on top of the same manifest contract later.

Runnable examples are included in `examples/plugins/` and built-in Demo 27/28.
