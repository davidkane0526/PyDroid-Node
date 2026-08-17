import { APP_VERSION } from "./app-version";

function versionLabel(): string {
  const english = document.documentElement.dataset.uiLanguage === "en" || document.documentElement.lang === "en";
  return english ? `Version ${APP_VERSION}` : `版本 ${APP_VERSION}`;
}

function decorateSettingsDialogs(): void {
  document.querySelectorAll<HTMLElement>(".settings-dialog.settings-dialog--adaptive").forEach((dialog) => {
    dialog.style.gridTemplateRows = "auto minmax(0, 1fr) auto";
    let bar = dialog.querySelector<HTMLElement>(":scope > .settings-version-bar");
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "settings-version-bar";
      bar.setAttribute("aria-label", "application-version");
      bar.style.cssText = "display:flex;align-items:center;justify-content:flex-end;min-height:30px;padding:5px 14px;border-top:1px solid var(--border-soft);color:var(--text-faint);background:color-mix(in srgb,var(--surface) 92%,var(--surface-raised) 8%);font:11px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;";
      dialog.appendChild(bar);
    }
    bar.textContent = versionLabel();
  });
}

export function installSettingsVersion(): void {
  if (typeof document === "undefined") return;
  const start = () => {
    decorateSettingsDialogs();
    const observer = new MutationObserver(() => decorateSettingsDialogs());
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-ui-language", "lang"] });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}
