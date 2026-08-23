import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const app = read("src/App.tsx");
const execution = read("src/execution.ts");
const desktopExecution = read("desktop/renderer/execution.ts");
const platformTypes = read("src/platform/types.ts");
const platformIndex = read("src/platform/index.ts");
const desktopPlatform = read("desktop/renderer/platform.ts");
const desktopBridge = read("desktop/renderer/bridge.ts");
const desktopVite = read("desktop/vite.config.ts");
const appTsconfig = JSON.parse(read("tsconfig.json"));
const testTsconfig = JSON.parse(read("tsconfig.test.json"));
const packageJson = JSON.parse(read("package.json"));

const collectNamedImports = (source, moduleName) => {
  const escaped = moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*[\"\']${escaped}[\"\']`));
  if (!match) return [];
  return match[1]
    .split(",")
    .map((entry) => entry.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]?.trim())
    .filter(Boolean);
};

const collectExports = (source) => {
  const names = new Set();
  for (const match of source.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1]);
  for (const match of source.matchAll(/export\s+(?:type\s+)?\{([\s\S]*?)\}/g)) {
    for (const entry of match[1].split(",")) {
      const name = entry.trim().replace(/^type\s+/, "").split(/\s+as\s+/).at(-1)?.trim();
      if (name) names.add(name);
    }
  }
  return names;
};

assert(app.includes('from "./platform"'), "App.tsx must consume host capabilities from ./platform");
assert(app.includes('from "./execution"'), "App.tsx must keep runtime capabilities in ./execution");
assert(!app.includes("window.pyDroidDesktop"), "App.tsx must not access the Electron bridge directly");
assert(!app.includes("Capacitor.isNativePlatform"), "App.tsx must not select native platforms directly");

for (const source of [execution, desktopExecution]) {
  for (const symbol of [
    "discoverSmbServers",
    "listSmbDirectory",
    "scanSmbShares",
    "readSmbCsvFiles",
    "pickCsvFiles",
    "saveSmbSecret",
    "startRemoteServer",
    "chooseWorkflowFolder",
  ]) {
    assert(
      !new RegExp(`export\\s+(?:async\\s+)?function\\s+${symbol}\\b`).test(source),
      `${symbol} must stay out of execution facades`,
    );
  }
}

for (const capability of ["files", "smb", "profile", "secrets", "remote", "mcp", "system"]) {
  assert(platformTypes.includes(`readonly ${capability}:`), `PlatformAdapter must expose ${capability}`);
}

assert(platformIndex.includes("Capacitor.isNativePlatform()"), "shared platform facade must select Android vs browser adapter");
assert(desktopPlatform.includes('id: "desktop"'), "desktop PlatformAdapter implementation is missing");
assert(desktopBridge.includes("DesktopRuntimeBridge"), "desktop runtime bridge contract is missing");
assert(desktopBridge.includes("DesktopPlatformBridge"), "desktop platform bridge contract is missing");
assert(desktopVite.includes('find: /^\\.\\/platform$/'), "desktop Vite must alias ./platform to its renderer adapter");

const appPlatformImports = collectNamedImports(app, "./platform");
const sharedPlatformExports = collectExports(platformIndex);
const desktopPlatformExports = collectExports(desktopPlatform);
assert(appPlatformImports.length > 0, "App.tsx ./platform named import list could not be parsed");
for (const symbol of appPlatformImports) {
  assert(sharedPlatformExports.has(symbol), `shared ./platform facade is missing App.tsx export: ${symbol}`);
  assert(desktopPlatformExports.has(symbol), `desktop ./platform alias is missing App.tsx export: ${symbol}`);
}
assert(appPlatformImports.includes("proxyRemoteAgentRequest"), "App.tsx must import proxyRemoteAgentRequest through ./platform");
assert(desktopPlatformExports.has("proxyRemoteAgentRequest"), "desktop platform facade must export proxyRemoteAgentRequest for Vite alias parity");


const productionExcludes = new Set(appTsconfig.exclude ?? []);
for (const pattern of [
  "src/**/*.test.ts",
  "src/**/*.test.tsx",
  "src/**/*.spec.ts",
  "src/**/*.spec.tsx",
]) {
  assert(productionExcludes.has(pattern), `production tsconfig must exclude ${pattern}`);
}
assert(!(appTsconfig.compilerOptions?.types ?? []).includes("node"), "browser/Android tsconfig must not expose Node globals");
assert((testTsconfig.compilerOptions?.types ?? []).includes("node"), "test tsconfig must provide Node types for architecture tests");
assert(packageJson.scripts?.["test:types"] === "tsc --noEmit -p tsconfig.test.json", "test:types must type-check test sources separately");
assert(packageJson.scripts?.check?.includes("pnpm test:types"), "pnpm check must include test type checking");

console.log("PlatformAdapter architecture smoke passed");
