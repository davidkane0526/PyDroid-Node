const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function sanitizeHostname(value) {
  const normalized = String(value || "device").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").replace(/-+/g, "-");
  return normalized.slice(0, 48) || "device";
}

function loadOrCreateIdentity(userDataRoot) {
  const settingsDir = path.join(userDataRoot, "settings");
  const filePath = path.join(settingsDir, "lan-device.json");
  let stored = {};
  try { stored = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch {}
  const machine = os.hostname() || "Device";
  const uuid = typeof stored.uuid === "string" && /^[0-9a-f-]{36}$/i.test(stored.uuid) ? stored.uuid : crypto.randomUUID();
  const friendlyName = `PyDroid Node - ${machine}`;
  const hostname = `pydroid-node-${sanitizeHostname(machine)}`.slice(0, 63);
  const identity = { uuid, friendlyName, hostname };
  try {
    fs.mkdirSync(settingsDir, { recursive: true });
    const temporary = `${filePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(identity, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, filePath);
  } catch {}
  return { ...identity, filePath };
}

module.exports = { loadOrCreateIdentity, sanitizeHostname };
