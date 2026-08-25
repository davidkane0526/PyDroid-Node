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
  if (sdk.NODE_SPEC_SDK_VERSION !== 7) throw new Error("unexpected SDK version");
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
  const declarative = sdk.defineNodeSpec({
    ...spec,
    nodeType: "example.declarative",
    ui: {
      parameterGroups: [{ id: "main", label: "Main", parameters: ["count", "mode"] }],
      status: [{ label: "Count", parameter: "count" }],
      help: { title: "Help", text: "Host-rendered help" },
    },
  });
  if (declarative.ui?.parameterGroups?.[0]?.parameters.join(",") !== "count,mode") throw new Error("declarative parameter groups were not retained");
  const conditional = sdk.defineNodeSpec({
    ...spec,
    nodeType: "example.conditional-ui",
    parameters: [
      { key: "count", label: "Count", kind: "number", visibleWhen: { mode: "many" }, constraintVariants: [{ when: { mode: "many" }, min: 1, max: 8, step: 1 }], readOnlyWhen: { mode: "many" }, disabledWhen: { mode: "few" } },
      { key: "mode", label: "Mode", kind: "select", options: [{ label: "Many", value: "many" }], optionVariants: [{ when: { mode: "many" }, options: [{ label: "Many", value: "many" }, { label: "Few", value: "few" }] }] },
    ],
    ui: { parameterGroups: [{ id: "conditional", label: "Conditional", parameters: ["count"], when: { mode: "many" } }], status: [{ label: "Count", parameter: "count", when: { mode: "many" } }], help: { text: "help", when: { mode: "many" } } },
  });
  if (conditional.parameters[1]?.optionVariants?.[0]?.options.length !== 2) throw new Error("linked select options were not retained");
  if (conditional.parameters[0]?.constraintVariants?.[0]?.max !== 8 || !conditional.parameters[0]?.readOnlyWhen) throw new Error("dynamic numeric/edit-state declarations were not retained");
  const invalidUi = { ...spec, nodeType: "example.invalid-ui", ui: { parameterGroups: [{ id: "bad", label: "Bad", parameters: ["missing"] }], status: [{ label: "Missing", parameter: "missing" }] } };
  const uiErrors = sdk.validateNodeSpecDefinition(invalidUi);
  if (!uiErrors.some((item) => item.includes("UI 参数分组引用不存在的参数")) || !uiErrors.some((item) => item.includes("UI 状态项引用不存在的参数"))) throw new Error("invalid declarative UI references were not rejected");
  const invalidConditional = { ...spec, nodeType: "example.invalid-conditional", parameters: [{ key: "count", label: "Count", kind: "number", visibleWhen: { missing: true }, optionVariants: [{ when: { mode: "many" }, options: [{ label: "x", value: "x" }] }] }, ...spec.parameters.slice(1)], ui: { help: { text: "bad", when: { missing: true } } } };
  const conditionalErrors = sdk.validateNodeSpecDefinition(invalidConditional);
  if (!conditionalErrors.some((item) => item.includes("visibleWhen 条件参数不存在")) || !conditionalErrors.some((item) => item.includes("optionVariants 仅适用于 select")) || !conditionalErrors.some((item) => item.includes("UI help 条件参数不存在"))) throw new Error("invalid declarative UI conditions were not rejected");

  const invalidConstraint = { ...spec, nodeType: "example.invalid-constraint", parameters: [{ key: "mode", label: "Mode", kind: "select", options: [{ label: "Many", value: "many" }], constraintVariants: [{ when: { mode: "many" }, min: 0, max: 1 }] }, ...spec.parameters.filter((item) => item.key !== "mode")] };
  if (!sdk.validateNodeSpecDefinition(invalidConstraint).some((item) => item.includes("constraintVariants 仅适用于 number"))) throw new Error("invalid dynamic numeric constraints were not rejected");
  const invalidStatus = { ...spec, nodeType: "example.invalid-status", ui: { status: [{ label: "Bad", parameter: "count", result: "rows" }] } };
  if (!sdk.validateNodeSpecDefinition(invalidStatus).some((item) => item.includes("必须且只能声明 parameter、result 或 output"))) throw new Error("ambiguous result status source was not rejected");

  const outputStatus = sdk.defineNodeSpec({
    ...spec,
    nodeType: "example.output-status",
    outputPorts: [{ id: "table", label: "Table", valueType: "table" }, { id: "count", label: "Count", valueType: "number" }],
    ui: {
      status: [{ label: "Rows", output: { port: "table", field: "rows" } }, { label: "Count", output: { port: "count", field: "value" } }],
      validations: [{ parameter: "count", when: { count: 0 }, message: "Count must not be zero", severity: "error" }],
    },
  });
  if (outputStatus.ui?.status?.[0]?.output?.port !== "table" || outputStatus.ui?.validations?.[0]?.message !== "Count must not be zero") throw new Error("output status/validation declarations were not retained");
  const badOutputStatus = { ...outputStatus, nodeType: "example.bad-output-status", ui: { status: [{ label: "Missing", output: { port: "missing", field: "rows" } }] } };
  if (!sdk.validateNodeSpecDefinition(badOutputStatus).some((item) => item.includes("不存在的输出端口"))) throw new Error("invalid output status port was not rejected");
  const badValidation = { ...spec, nodeType: "example.bad-validation", ui: { validations: [{ parameter: "missing", when: { count: 2 }, message: "bad" }] } };
  if (!sdk.validateNodeSpecDefinition(badValidation).some((item) => item.includes("引用不存在的参数"))) throw new Error("invalid validation parameter was not rejected");

  const invalid = { ...spec, nodeType: "example.invalid", inputPorts: [{ id: "missing", label: "Missing", valueType: "number", defaultParameter: "unknown" }] };
  if (!sdk.validateNodeSpecDefinition(invalid).some((item) => item.includes("默认参数不存在"))) throw new Error("invalid parameter socket was not rejected");
  const registered = sdk.registerNodeSpec({ ...spec, nodeType: "example.registered", label: "Registered" });
  if (registered.nodeType !== "example.registered") throw new Error("registration did not return the node type");
  let duplicateRejected = false;
  try { sdk.registerNodeSpec({ ...spec, nodeType: "example.registered", label: "Duplicate" }); } catch { duplicateRejected = true; }
  if (!duplicateRejected) throw new Error("duplicate external registration was not rejected");
  if (!registered.unregister() || registered.unregister()) throw new Error("registration cleanup is not deterministic");
  console.log("NodeSpec SDK smoke: PASS");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
