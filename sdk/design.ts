/** Shared visual design contract for Core and installable plugins. */
export const UI_DESIGN_SDK_VERSION = 1 as const;

export const UI_MATERIAL_TOKEN_NAMES = [
  "material-panel-shadow",
  "material-card-shadow",
  "material-control-shadow",
  "material-popup-shadow",
  "material-node-shadow",
  "material-node-hover-shadow",
  "material-node-selected-shadow",
  "material-surface-highlight",
  "material-overlay-blur",
  "material-glass-blur",
] as const;

export const UI_MOTION_TOKEN_NAMES = [
  "motion-duration-fast",
  "motion-duration-normal",
  "motion-duration-slow",
  "motion-ease-standard",
  "motion-ease-emphasized",
  "motion-hover-lift",
  "motion-press-scale",
  "motion-enter-distance",
] as const;

export type UiMaterialTokenName = (typeof UI_MATERIAL_TOKEN_NAMES)[number];
export type UiMotionTokenName = (typeof UI_MOTION_TOKEN_NAMES)[number];
export type UiMaterialTokens = Partial<Record<UiMaterialTokenName, string>>;
export type UiMotionTokens = Partial<Record<UiMotionTokenName, string>>;

export const UI_DESIGN_TOKEN_NAMES = [...UI_MATERIAL_TOKEN_NAMES, ...UI_MOTION_TOKEN_NAMES] as const;
export type UiDesignTokenName = (typeof UI_DESIGN_TOKEN_NAMES)[number];

export type UiThemeMaterial = {
  dark?: UiMaterialTokens;
  light?: UiMaterialTokens;
};
