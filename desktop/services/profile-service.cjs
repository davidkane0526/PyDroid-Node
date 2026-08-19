const fs = require("node:fs");
const path = require("node:path");

function projectRoot() {
  return path.resolve(__dirname, "..", "..");
}

function projectPaths(app) {
  if (app.isPackaged) {
    return {
      renderer: path.join(app.getAppPath(), "desktop", "package-renderer", "index.html"),
      python: path.join(process.resourcesPath, "python"),
    };
  }
  const root = projectRoot();
  return {
    renderer: path.join(root, "dist-desktop", "index.html"),
    python: path.join(root, "python"),
  };
}

function ensureUserProfile(app) {
  const root = app.getPath("userData");
  for (const name of ["settings", "user-code", "workflows", "logs"]) fs.mkdirSync(path.join(root, name), { recursive: true });
}

module.exports = { ensureUserProfile, projectPaths, projectRoot };
