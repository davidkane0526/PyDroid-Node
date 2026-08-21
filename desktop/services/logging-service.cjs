const fs = require("node:fs");
const path = require("node:path");

function resolveDesktopLogPath(app) {
  const root = app.isPackaged ? path.dirname(process.execPath) : app.getPath("userData");
  return path.join(root, "logs", "desktop.log");
}

function createDesktopLogger(app) {
  const logFile = resolveDesktopLogPath(app);
  const appendDesktopLog = function appendDesktopLog(message) {
    try {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      fs.appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`, "utf8");
    } catch {
      // Logging is observational only and must never control application startup.
    }
  };
  appendDesktopLog.filePath = logFile;
  return appendDesktopLog;
}

module.exports = { createDesktopLogger, resolveDesktopLogPath };
