import { describe, expect, it } from "vitest";
import { NODE_CATALOG } from "./nodeCatalog";
import { applyCatalogOverrides } from "./catalog-overrides";

describe("release catalog defaults", () => {
  it("uses the first two columns for new line plots", () => {
    applyCatalogOverrides();
    const line = NODE_CATALOG.find((spec) => spec.nodeType === "plot.line");
    expect(line?.defaults.xColumn).toBe("0");
    expect(line?.defaults.yColumns).toBe("1");
  });
});
