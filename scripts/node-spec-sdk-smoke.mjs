import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const temp = mkdtempSync(path.join(os.tmpdir(), "pydroid-node-spec-sdk-"));
try {
  const require = createRequire(import.meta.url);
  let tsc;
  try { tsc = { command: process.execPath, args: [require.resolve("typescript/bin/tsc")] }; }
  catch { tsc = { command: process.platform === "win32" ? "tsc.cmd" : "tsc", args: [] }; }
  const files = ["src/nodeCatalog.ts", "src/customNode.ts", "src/nodeSpec.ts", "src/nodeSpecSdk.ts"].map((file) => path.join(root, file));
  const result = spawnSync(tsc.command, [...tsc.args, ...files, "--target", "ES2022", "--module", "commonjs", "--moduleResolution", "node", "--skipLibCheck", "--noCheck", "--outDir", temp, "--rootDir", path.join(root, "src")], { cwd: root, encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error(result.stderr || result.stdout || result.error?.message);
  writeFileSync(path.join(temp, "package.json"), '{"type":"commonjs"}\n');
  const sdkModule = await import(pathToFileURL(path.join(temp, "nodeSpecSdk.js")).href);
  const sdk = sdkModule.default ?? sdkModule;
  if (sdk.NODE_SPEC_SDK_VERSION !== 1) throw new Error("unexpected SDK version");
  const spec = sdk.defineNodeSpec({
    nodeType: "example.dynamic",
    label: "Example",
    category: "自定义",
    runtimeSupport: ["javascript"],
    defaults: { count: 2, mode: "many" },
    parameters: [{ key: "count", label: "Count", kind: "number" }, { key: "mode", label: "Mode", kind: "select", options: [{ label: "Many", value: "many" }] }],
    socketGroups: [{ id: "items", label: "Items" }],
    inputPorts: [],
    outputPorts: [{ id: "output", label: "Output", valueType: "list" }],
    inputPortGroups: [{ id: "dynamic", when: { mode: "many" }, socketGroup: "items", repeat: { countParameter: "count", idPrefix: "item", labelPrefix: "Item", valueType: "any", min: 1, max: 4 } }],
  });
  const resolved = sdk.resolveNodeSpec(spec, { count: 3, mode: "many" });
  if (!resolved || resolved.inputPorts.map((port) => port.id).join(",") !== "item1,item2,item3") throw new Error("dynamic port resolution failed");
  const invalid = { ...spec, nodeType: "example.invalid", inputPorts: [{ id: "missing", label: "Missing", valueType: "number", defaultParameter: "unknown" }] };
  if (!sdk.validateNodeSpecDefinition(invalid).some((item) => item.includes("默认参数不存在"))) throw new Error("invalid parameter socket was not rejected");
  console.log("NodeSpec SDK smoke: PASS");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
