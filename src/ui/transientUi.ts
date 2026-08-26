export const TRANSIENT_UI_DISMISS_EVENT = "pydroid:transient-ui-dismiss";

export function dismissTransientUi(source: "canvas" | "escape" | "external" = "external"): void {
  window.dispatchEvent(new CustomEvent(TRANSIENT_UI_DISMISS_EVENT, { detail: { source } }));
}
