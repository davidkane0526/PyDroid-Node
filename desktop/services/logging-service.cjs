const fs = require("node:fs");
const path = require("node:path");

function createDesktopLogger(app) {
  return function appendDesktopLog(message) {
    try {
      const directory = path.join(app.getPath("userData"), "logs");
      fs.mkdirSync(directory, { recursive: true });
      fs.appendFileSync(path.join(directory, "desktop.log"), `${new Date().toISOString()} ${message}\n`, "utf8");
    } catch { /* Diagnostics must never prevent the window from opening. */ }
  };
}

module.exports = { createDesktopLogger };
