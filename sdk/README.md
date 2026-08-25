# PyDroid Node Plugin SDK

`/sdk` is the single public source-level SDK surface for PyDroid Node plugins.
Plugin authors should start from `sdk/index.ts`; application implementation remains under `src/`.

## Modules

| Module | Contract |
| --- | --- |
| `index.ts` | Unified public entry and SDK version |
| `node.ts` | NodeSpec authoring, validation, registration and Runtime Provider contract |
| `plugin.ts` | JSON plugin package manifest types and Runtime API version |
| `archive.ts` | `.plugin.zip` `manifest.json` archive contract |
| `resources.ts` | Plugin resource types and resource access API |
| `theme.ts` | Theme registration, color/material/motion theme contract |
| `design.ts` | Shared material and motion token contract |

The plugin host itself is **not** part of the authoring SDK. Installation, persistence,
ZIP parsing and the plugin-management UI live under `src/plugins/`.

## Authoring model

A plugin package can declare nodes, themes, or both. Node geometry is controlled by Core;
themes can change semantic color/material/motion tokens but cannot change node width,
port spacing, control size or other layout geometry.

Reference packages are in:

- `examples/plugins/*.plugin.json`
- `examples/plugin-archives/*.plugin.zip`

The theme example is `examples/plugins/demo-midnight-theme.plugin.json`.

## Public entry

```ts
import {
  PLUGIN_SDK_VERSION,
  NODE_SPEC_SDK_VERSION,
  UI_THEME_SDK_VERSION,
  UI_DESIGN_SDK_VERSION,
  defineNodeSpec,
  defineUiTheme,
  type NodePluginPackageManifest,
} from "./sdk/index";
```

Do not import implementation files from `src/plugins/` when authoring a plugin. Those files
belong to the application host and may change without changing the plugin contract.
