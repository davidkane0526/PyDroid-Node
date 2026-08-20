const { dialog, ipcMain } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const DATA_FILE_PATTERN = /\.(csv|tsv|txt|dat|json|png|jpe?g)$/i;

function registerFileIpc() {
  ipcMain.handle("pydroid:pick-csv", async (_event, mode) => {
    const directory = String(mode).startsWith("directory");
    const properties = directory ? ["openDirectory"] : ["openFile", "multiSelections"];
    const result = await dialog.showOpenDialog({
      title: directory ? "选择包含数据文件的文件夹" : "选择数据文件",
      properties,
      filters: [
        { name: "数据文件", extensions: ["csv", "tsv", "txt", "dat", "json", "png", "jpg", "jpeg"] },
        { name: "所有文件", extensions: ["*"] },
      ],
    });
    if (result.canceled) return [];
    const paths = directory
      ? fs.readdirSync(result.filePaths[0], { withFileTypes: true }).filter((item) => item.isFile() && DATA_FILE_PATTERN.test(item.name)).map((item) => path.join(result.filePaths[0], item.name))
      : result.filePaths;
    return paths.map((filePath) => ({ name: path.basename(filePath), base64: fs.readFileSync(filePath).toString("base64") }));
  });

  ipcMain.handle("pydroid:export-text-file", async (_event, payload = {}) => {
    const name = path.basename(String(payload.name || "pydroid-export.txt"));
    const content = String(payload.content ?? "");
    const result = await dialog.showSaveDialog({
      title: "导出文件",
      defaultPath: name,
    });
    if (result.canceled || !result.filePath) return { saved: false, destination: null };
    await fs.promises.writeFile(result.filePath, content, "utf8");
    return { saved: true, destination: result.filePath };
  });
}

module.exports = { registerFileIpc };
