# Unified Design SDK — 1.6.37

PyDroid Node 1.6.37 uses one host-owned visual contract for Core UI, installable themes and host-rendered plugin UI.

## Public versions

- `PLUGIN_SDK_VERSION = 3`
- `NODE_SPEC_SDK_VERSION = 7`
- `UI_THEME_SDK_VERSION = 2`
- `UI_DESIGN_SDK_VERSION = 1`
- plugin package schema remains v1
- JavaScript Runtime API remains v2

`sdk/index.ts` is the single public authoring surface and re-exports NodeSpec, package/archive/resource, theme and design contracts.

## Three visual layers

A UI theme may declare three appearance-only layers:

1. `tokens`: semantic colors for app surfaces, text, borders, state colors and canvas/node appearance.
2. `material`: semantic elevation and translucency such as panel/card/control/popup/node shadows and overlay/glass blur.
3. `motion`: shared timing/easing and restrained interaction amplitudes.

Core owns the CSS mapping. Plugins do not inject CSS, HTML, React components, arbitrary selectors or layout callbacks.

## Material tokens

`UI_MATERIAL_TOKEN_NAMES` currently exposes:

- panel/card/control/popup elevation
- normal/hover/selected node elevation
- surface highlight
- overlay blur
- glass blur

These tokens alter perceived depth only. Width, height, padding, radius metrics, typography and node geometry remain Core-owned.

## Motion tokens

`UI_MOTION_TOKEN_NAMES` currently exposes:

- fast/normal/slow duration
- standard/emphasized easing
- hover lift
- pressed scale
- enter distance

The shared contract applies these to buttons, fields, menus, dialogs, plugin cards, palette items and node visual-state transitions. Node motion never changes measured node bounds, port rows or edge anchor geometry.

`prefers-reduced-motion: reduce` forces the shared durations to zero and interaction transforms to their neutral values.

## Host-rendered plugin UI

Declarative NodeSpec UI receives the same Core component material and motion automatically. A node plugin declares controls and behavior; it does not ship a parallel button/input/card style system.

This is the intended first-party/third-party equality rule: installing a plugin can add capability and can register a theme, but all rendered controls remain inside the same Design SDK.

## Theme example

`examples/plugins/demo-midnight-theme.plugin.json` and `examples/plugin-archives/demo-midnight-theme.plugin.zip` now demonstrate color + material + motion in one theme-only package.
