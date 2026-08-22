export const CANVAS_THEME_IDS = ["classic", "soft"] as const;

export type CanvasThemeId = (typeof CANVAS_THEME_IDS)[number];

export type CanvasThemeDefinition = {
  id: CanvasThemeId;
  labelZh: string;
  labelEn: string;
  descriptionZh: string;
  descriptionEn: string;
};

export const CANVAS_THEMES: readonly CanvasThemeDefinition[] = [
  {
    id: "classic",
    labelZh: "经典",
    labelEn: "Classic",
    descriptionZh: "1.5.4 及以前的稳定画布样式，可随时回退",
    descriptionEn: "Stable canvas styling from 1.5.4 and earlier",
  },
  {
    id: "soft",
    labelZh: "柔和卡片",
    labelEn: "Soft cards",
    descriptionZh: "柔和圆角、分层容器与青蓝强调的新版画布",
    descriptionEn: "Soft rounded cards, layered containers and cyan-blue accents",
  },
] as const;

export const DEFAULT_CANVAS_THEME: CanvasThemeId = "soft";

export function normalizeCanvasTheme(value: unknown, fallback: CanvasThemeId = DEFAULT_CANVAS_THEME): CanvasThemeId {
  return value === "classic" || value === "soft" ? value : fallback;
}
