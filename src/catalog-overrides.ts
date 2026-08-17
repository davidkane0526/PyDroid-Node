import { NODE_CATALOG } from "./nodeCatalog";

/* Small compatibility/default overrides which should apply before the first workflow node is created.
   Keeping these here avoids duplicating the catalog while making release-specific defaults explicit. */
export function applyCatalogOverrides(): void {
  const linePlot = NODE_CATALOG.find((spec) => spec.nodeType === "plot.line");
  if (linePlot) {
    linePlot.defaults.xColumn = "0";
    linePlot.defaults.yColumns = "1";
  }
}
