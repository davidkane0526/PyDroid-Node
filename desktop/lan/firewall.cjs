const LAN_WEB_PORT = 8765;

// Personal-use runtime: operating-system firewall policy is not managed here.
// This module only preserves the stable LAN port and compatibility boundary.
function inspectWindowsLanFirewall() {
  return Promise.resolve({ applicable: false, managedByApplication: false });
}

function ensureWindowsLanFirewall() {
  return Promise.resolve({ applicable: false, managedByApplication: false });
}

module.exports = {
  LAN_WEB_PORT,
  inspectWindowsLanFirewall,
  ensureWindowsLanFirewall,
};
