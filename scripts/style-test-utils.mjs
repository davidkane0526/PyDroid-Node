import { readFileSync } from "node:fs";
import path from "node:path";

export const CORE_STYLE_FILES = [
  "tokens.css",
  "workspace-shell.css",
  "nodes-base.css",
  "light-theme.css",
  "data-workspace.css",
  "workspace-chrome.css",
  "workspace-controls.css",
  "settings-services.css",
  "workflow-resources.css",
  "nodes-dynamic.css",
];

export function readCoreStyles(root) {
  return CORE_STYLE_FILES.map((name) => readFileSync(path.join(root, "src/styles", name), "utf8")).join("\n");
}
