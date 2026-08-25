# UI Theme and Node Layout Contract — 1.6.36

## Scope

PyDroid Node 1.6.36 separates **appearance** from **geometry**. Plugin SDK v2 may extend NodeSpec/Runtime/resources/declarative UI and may register UI themes, but a theme is never allowed to redefine component layout. Core remains the single owner of layout metrics and node geometry.

## Plugin SDK surface

`src/nodePluginSdk.ts` is the public authoring surface.

- `PLUGIN_SDK_VERSION = 2`
- `NODE_SPEC_SDK_VERSION = 7`
- `UI_THEME_SDK_VERSION = 1`
- package schema remains `1`
- JavaScript Runtime API remains `2`

A package may contain:

- `nodes`: NodeSpec plus JavaScript/Python Runtime Providers
- `resources`: package-local read-only assets
- `themes`: one or more token-only UI theme definitions

A package may be **node-only**, **theme-only**, or contain both. First-party and third-party packages use the same registration/lifecycle path.

## Theme plugin boundary

A UI theme declares semantic tokens for `dark` and/or `light` modes. The token whitelist is defined by `UI_THEME_TOKEN_NAMES` in `src/themePluginSdk.ts`.

The theme layer covers:

- app/window backgrounds and surfaces
- borders and text hierarchy
- accent/info/success/warning/danger colors
- overlay, shadow and focus-ring materials
- canvas background/grid
- node face/border/labels/meta
- handles, edges and selection appearance
- function/group semantic colors

A theme plugin **cannot** provide:

- CSS files or selectors
- arbitrary CSS variables
- HTML/DOM injection
- React/render callbacks
- control dimensions
- padding, margin, gap or breakpoint changes
- font-size/line-height changes
- node width/height/scale
- endpoint size
- port row spacing or socket-control geometry

`src/ui-theme-contract.css` is loaded last and is appearance-only. It maps the semantic theme tokens onto the product's shared UI surfaces. Legacy component styles may still contain default material values, but the final visual contract overrides their appearance through the semantic token layer.

## Theme lifecycle

Theme registrations use the same deterministic package lifecycle as node registrations:

1. validate package and theme declarations
2. register nodes/providers and themes atomically
3. persist the package Manifest
4. restore registrations at app startup
5. disable = unregister live nodes/themes, keep package installed
6. enable = reactivate persisted package
7. uninstall = unregister and remove persisted package

If the selected theme disappears, Settings automatically falls back to `core.default`. No retry/fallback theme chain exists beyond that single deterministic default.

## Core-owned UI geometry

Shared control geometry stays in Core (`src/styles.css`) and is not exported by the theme SDK. Examples include:

- `--ui-control-height`
- `--ui-radius-sm/md/lg`
- `--ui-panel-gap`
- `--node-width`
- `--node-min-height`
- `--node-scale`
- `--endpoint-scale`

This rule guarantees that changing a theme does not move nodes, change their dimensions, change canvas routing geometry or alter Settings/dialog alignment.

## Node layout contract

`src/nodeLayout.ts` is the single measurement contract used by `WorkflowNodeCard`.

The layout resolver owns:

- effective horizontal/vertical direction
- dynamic-node detection
- side-rail activation
- input/output label widths
- socket default-control width
- input/output rail widths
- node width and minimum height
- inline-control width budget
- port row height and deterministic port positions

### Static nodes

Simple static nodes continue to respect the user-selected global horizontal/vertical layout. Their ports may use evenly distributed placement because their port count and UI do not change at runtime.

### Dynamic nodes

A node is treated as dynamic when the resolved NodeSpec contains socket default controls, inline parameters, variants or dynamic input-port groups, **or when its port signature is user/runtime-derived**. Signature-driven nodes currently include `custom.python_function`, `function.call`, `function.map` and `workflow.group`.

Every dynamic node that has data ports uses the deterministic horizontal side-rail layout. Dynamic nodes with no data ports keep the requested direction because there is no rail to place.

The rule is intentionally simple: once node UI can change from parameters/variants/groups or owns inline/socket controls, percentage port placement is no longer allowed. This keeps the same geometry contract for a one-port dynamic node and a twelve-port dynamic node.

### Side-rail rules

For side-rail dynamic nodes:

- each port occupies one fixed row
- `portTop(index)` is derived from one shared `portRowHeight`
- `portRowHeight` is also bounded by the rendered endpoint diameter after `endpointScale` and `nodeScale`, so enlarged handles cannot collide when the node itself is scaled down
- input label and its socket default control share the same row
- input and output label widths are measured independently
- node minimum height grows from the maximum port count
- node width grows from input rail + body + output rail
- labels do not overlap socket controls
- output labels use their own width budget
- long node/port/inline-control labels are ellipsized inside their allocated width and preserve the full text in a tooltip
- the node type string is hidden from the dynamic card because the visible node label already owns that semantic role

This removes the former repeated/overlapping UI pattern where node type, label, port label and input text could compete for the same space.

## Theme × node-layout invariant

The core invariant is:

> Applying, disabling or uninstalling a UI theme may change appearance, but it must not change the measured node layout.

`theme-plugin-sdk-smoke`, `ui-theme-contract-smoke` and `node-layout-contract-smoke` enforce this separation.

## Executable examples

- `examples/plugins/demo-midnight-theme.plugin.json`
- `examples/plugin-archives/demo-midnight-theme.plugin.zip`

The theme example is intentionally theme-only. It demonstrates that a real installed plugin can modify the application and canvas appearance without registering any node or receiving any layout privilege.
