const { app, safeStorage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

function secretPath(name) {
  return path.join(app.getPath("userData"), "settings", `${name}.bin`);
}

function saveEncrypted(name, value) {
  const target = secretPath(name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!value) {
    if (fs.existsSync(target)) fs.rmSync(target);
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows 安全存储当前不可用");
  fs.writeFileSync(target, safeStorage.encryptString(String(value)));
}

function loadEncrypted(name) {
  const target = secretPath(name);
  if (!fs.existsSync(target) || !safeStorage.isEncryptionAvailable()) return "";
  return safeStorage.decryptString(fs.readFileSync(target));
}

function createDesktopSecretStore() {
  return {
    saveSmbPassword(value) { saveEncrypted("smb-secret", value); },
    loadSmbPassword() { return loadEncrypted("smb-secret"); },
  };
}

module.exports = { createDesktopSecretStore };
