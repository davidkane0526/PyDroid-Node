import { UI_DESIGN_TOKEN_NAMES, type UiMotionTokens, type UiThemeMaterial } from "./design";

export const UI_THEME_SDK_VERSION = 2 as const;

export const UI_THEME_TOKEN_NAMES = [
  "bg", "bg-canvas", "surface", "surface-deep", "surface-raised", "surface-hover", "surface-overlay",
  "border-soft", "border", "border-strong", "border-pop",
  "text", "text-bright", "text-highlight", "text-muted", "text-faint", "text-faintest",
  "accent", "accent-hover", "accent-soft", "accent-active",
  "info", "info-soft", "success", "success-text", "warning", "danger", "danger-text", "danger-deep", "violet",
  "ui-backdrop", "ui-shadow", "ui-focus-ring",
  "canvas-bg", "canvas-grid-dot", "canvas-grid-mask", "canvas-node-face", "canvas-node-border", "canvas-node-label",
  "canvas-node-type", "canvas-node-meta", "canvas-handle-border", "canvas-edge", "canvas-edge-selected", "canvas-selection",
  "canvas-function", "canvas-group",
] as const;

export type UiThemeTokenName = (typeof UI_THEME_TOKEN_NAMES)[number];
export type UiThemeTokens = Partial<Record<UiThemeTokenName, string>>;
export type UiThemeMode = "dark" | "light";

export type UiThemeDefinition = {
  id: string;
  labelZh: string;
  labelEn: string;
  description?: string;
  tokens: {
    dark?: UiThemeTokens;
    light?: UiThemeTokens;
  };
  material?: UiThemeMaterial;
  motion?: UiMotionTokens;
};

export type UiThemeRegistration = {
  id: string;
  unregister: () => boolean;
};

export const DEFAULT_UI_THEME_ID = "core.default";

const themeRegistry = new Map<string, UiThemeDefinition>();
const listeners = new Set<() => void>();
let revision = 0;

const BUILTIN_THEME: UiThemeDefinition = {
  id: DEFAULT_UI_THEME_ID,
  labelZh: "默认",
  labelEn: "Default",
  description: "PyDroid Node 默认界面主题",
  tokens: {},
};

themeRegistry.set(BUILTIN_THEME.id, BUILTIN_THEME);

function notify(): void {
  revision += 1;
  for (const listener of listeners) listener();
}

function validateThemeId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}

export function validateUiThemeDefinition(theme: UiThemeDefinition): string[] {
  const errors: string[] = [];
  if (!validateThemeId(theme.id)) errors.push(`主题 id 无效：${theme.id || "<empty>"}`);
  if (!theme.labelZh?.trim()) errors.push(`${theme.id || "<theme>"}: labelZh 不能为空`);
  if (!theme.labelEn?.trim()) errors.push(`${theme.id || "<theme>"}: labelEn 不能为空`);
  if (!theme.tokens || typeof theme.tokens !== "object") errors.push(`${theme.id || "<theme>"}: tokens 必须是对象`);
  const allowed = new Set<string>(UI_THEME_TOKEN_NAMES);
  const allowedDesign = new Set<string>(UI_DESIGN_TOKEN_NAMES);
  for (const mode of ["dark", "light"] as const) {
    const tokens = theme.tokens?.[mode];
    if (!tokens) continue;
    for (const [name, value] of Object.entries(tokens)) {
      if (!allowed.has(name)) errors.push(`${theme.id || "<theme>"}: 不支持的 ${mode} token：${name}`);
      if (typeof value !== "string" || !value.trim()) errors.push(`${theme.id || "<theme>"}: ${mode}.${name} 必须是非空字符串`);
    }
  }
  for (const mode of ["dark", "light"] as const) {
    const material = theme.material?.[mode];
    if (!material) continue;
    for (const [name, value] of Object.entries(material)) {
      if (!allowedDesign.has(name) || !name.startsWith("material-")) errors.push(`${theme.id || "<theme>"}: 不支持的 ${mode} 材质 token：${name}`);
      if (typeof value !== "string" || !value.trim()) errors.push(`${theme.id || "<theme>"}: ${mode}.${name} 必须是非空字符串`);
    }
  }
  for (const [name, value] of Object.entries(theme.motion ?? {})) {
    if (!allowedDesign.has(name) || !name.startsWith("motion-")) errors.push(`${theme.id || "<theme>"}: 不支持的动画 token：${name}`);
    if (typeof value !== "string" || !value.trim()) errors.push(`${theme.id || "<theme>"}: motion.${name} 必须是非空字符串`);
  }
  return errors;
}

export function defineUiTheme<T extends UiThemeDefinition>(theme: T): T {
  const errors = validateUiThemeDefinition(theme);
  if (errors.length) throw new Error(`Invalid UI Theme:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  return theme;
}

export function registerUiTheme(theme: UiThemeDefinition): UiThemeRegistration {
  const validated = defineUiTheme(theme);
  if (validated.id === DEFAULT_UI_THEME_ID) throw new Error(`主题 id 为 Core 保留：${DEFAULT_UI_THEME_ID}`);
  if (themeRegistry.has(validated.id)) throw new Error(`主题已注册：${validated.id}`);
  themeRegistry.set(validated.id, JSON.parse(JSON.stringify(validated)) as UiThemeDefinition);
  notify();
  let active = true;
  return {
    id: validated.id,
    unregister: () => {
      if (!active) return false;
      active = false;
      const removed = themeRegistry.delete(validated.id);
      if (removed) notify();
      return removed;
    },
  };
}

export function listUiThemes(): UiThemeDefinition[] {
  return [...themeRegistry.values()].map((theme) => JSON.parse(JSON.stringify(theme)) as UiThemeDefinition);
}

export function getUiTheme(id: string): UiThemeDefinition | undefined {
  const theme = themeRegistry.get(id);
  return theme ? JSON.parse(JSON.stringify(theme)) as UiThemeDefinition : undefined;
}

export function resolveUiTheme(id: string): UiThemeDefinition {
  return getUiTheme(id) ?? getUiTheme(DEFAULT_UI_THEME_ID)!;
}

export function uiThemeCssVariables(id: string, mode: UiThemeMode): Record<string, string> {
  const theme = resolveUiTheme(id);
  const tokens = theme.tokens[mode] ?? {};
  const material = theme.material?.[mode] ?? {};
  const motion = theme.motion ?? {};
  return Object.fromEntries([...Object.entries(tokens), ...Object.entries(material), ...Object.entries(motion)].map(([name, value]) => [`--${name}`, value]));
}

export function subscribeUiThemes(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function uiThemeRegistrySnapshot(): number {
  return revision;
}
