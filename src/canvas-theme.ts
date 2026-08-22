export const CANVAS_THEME_IDS = ["classic", "soft"] as const;

export type CanvasThemeId = (typeof CANVAS_THEME_IDS)[number];

export type CanvasThemeDefinition = {
  id: CanvasThemeId;
  labelZh: string;
  labelEn: string;
};

export const CANVAS_THEMES: readonly CanvasThemeDefinition[] = [
  {
    id: "classic",
    labelZh: "经典",
    labelEn: "Classic",
  },
  {
    id: "soft",
    labelZh: "柔和卡片",
    labelEn: "Soft cards",
  },
] as const;

export const DEFAULT_CANVAS_THEME: CanvasThemeId = "soft";

export function normalizeCanvasTheme(value: unknown, fallback: CanvasThemeId = DEFAULT_CANVAS_THEME): CanvasThemeId {
  return value === "classic" || value === "soft" ? value : fallback;
}
