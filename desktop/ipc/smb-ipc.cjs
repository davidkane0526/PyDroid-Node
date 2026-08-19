const { ipcMain } = require("electron");

function registerSmbIpc({ smbService, secretStore }) {
  ipcMain.handle("pydroid:discover-smb-servers", () => smbService.safeSmbOperation(() => smbService.discoverSmbServers(), "无法扫描局域网 SMB 设备"));
  ipcMain.handle("pydroid:scan-smb-shares", (_event, connection) => smbService.safeSmbOperation(() => smbService.scanDesktopSmbShares(connection), "无法扫描 SMB 共享"));
  ipcMain.handle("pydroid:list-smb", (_event, connection, relativePath) => smbService.safeSmbOperation(() => smbService.listDesktopSmb(connection, relativePath), "无法访问 SMB 文件夹"));
  ipcMain.handle("pydroid:read-smb", (_event, connection, paths) => smbService.safeSmbOperation(() => smbService.readDesktopSmb(connection, paths), "无法读取 SMB 文件"));
  ipcMain.handle("pydroid:save-smb-secret", (_event, value) => { secretStore.saveSmbPassword(value); return { saved: true }; });
  ipcMain.handle("pydroid:load-smb-secret", () => ({ value: secretStore.loadSmbPassword() }));
}

module.exports = { registerSmbIpc };
