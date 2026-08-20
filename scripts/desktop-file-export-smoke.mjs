import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const source = fs.readFileSync(new URL("../desktop/ipc/file-ipc.cjs", import.meta.url), "utf8");
const handlers = new Map();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pydroid-desktop-export-"));
const destination = path.join(tempDir, "diagnostics.json");
let saveOptions = null;

const electronMock = {
  dialog: {
    async showSaveDialog(options) {
      saveOptions = options;
      return { canceled: false, filePath: destination };
    },
    async showOpenDialog() {
      throw new Error("open dialog should not be used by export smoke");
    },
  },
  ipcMain: {
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
  },
};

const module = { exports: {} };
vm.runInNewContext(source, {
  module,
  exports: module.exports,
  require(specifier) {
    if (specifier === "electron") return electronMock;
    return require(specifier);
  },
}, { filename: "desktop/ipc/file-ipc.cjs" });

module.exports.registerFileIpc();
const exportHandler = handlers.get("pydroid:export-text-file");
assert.equal(typeof exportHandler, "function", "desktop file IPC must register text export");
const payload = { name: "../diagnostics.json", content: '{"passed":4}\n', mimeType: "application/json" };
const result = await exportHandler(null, payload);
assert.deepEqual({ ...result }, { saved: true, destination });
assert.equal(saveOptions?.defaultPath, "diagnostics.json", "export filename must be reduced to a basename");
assert.equal(fs.readFileSync(destination, "utf8"), payload.content, "desktop export must write exact UTF-8 content");
fs.rmSync(tempDir, { recursive: true, force: true });
console.log("Desktop file export smoke passed.");
