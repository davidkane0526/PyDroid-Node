import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const executionSource = readFileSync(fileURLToPath(new URL("../execution.ts", import.meta.url)), "utf8");
const appSource = readFileSync(fileURLToPath(new URL("../App.tsx", import.meta.url)), "utf8");

describe("PlatformAdapter architecture boundary", () => {
  it("keeps host capability facades out of execution.ts", () => {
    for (const symbol of [
      "discoverSmbServers",
      "pickCsvFiles",
      "saveSmbSecret",
      "startRemoteServer",
      "chooseWorkflowFolder",
    ]) {
      expect(executionSource).not.toMatch(new RegExp(`export\\s+(async\\s+)?function\\s+${symbol}\\b`));
    }
  });

  it("makes App consume host capabilities through platform", () => {
    expect(appSource).toContain('from "./platform"');
    expect(appSource).toContain('from "./execution"');
    expect(appSource).not.toContain("Capacitor.isNativePlatform");
    expect(appSource).not.toContain("window.pyDroidDesktop");
  });
});
