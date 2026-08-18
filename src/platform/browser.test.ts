import { describe, expect, it } from "vitest";
import { createBrowserPlatformAdapter } from "./browser";

describe("browser PlatformAdapter", () => {
  it("exposes the stable platform contract without pretending native capabilities exist", async () => {
    const adapter = createBrowserPlatformAdapter();
    expect(adapter.id).toBe("browser");
    expect(adapter.remote.canHostServer()).toBe(false);
    expect(adapter.system.isNativePlatform()).toBe(false);
    expect(adapter.system.getWindowControls()).toBeUndefined();
    expect(await adapter.files.pickCsvFiles("files")).toBeNull();
    expect(await adapter.profile.getInfo()).toEqual({
      path: "浏览器站点存储（工作流库仅在此浏览器可用）",
      workspaceUri: null,
    });
    await expect(adapter.smb.discoverServers()).rejects.toThrow("宿主应用");
  });
});
