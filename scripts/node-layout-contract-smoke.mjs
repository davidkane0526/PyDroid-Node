import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const temp = mkdtempSync(path.join(os.tmpdir(), "pydroid-node-layout-"));
try {
  const require = createRequire(import.meta.url);
  let tsc;
  try { tsc = { command: process.execPath, args: [require.resolve("typescript/bin/tsc")] }; }
  catch { tsc = { command: process.platform === "win32" ? "tsc.cmd" : "tsc", args: [] }; }
  const result = spawnSync(tsc.command, [...tsc.args, path.join(root, "src", "nodeLayout.ts"), path.join(root, "src", "nodeCatalog.ts"), "--target", "ES2022", "--module", "commonjs", "--moduleResolution", "node", "--skipLibCheck", "--noCheck", "--outDir", temp, "--rootDir", path.join(root, "src")], { cwd: root, encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error(result.stderr || result.stdout || result.error?.message);
  writeFileSync(path.join(temp, "package.json"), '{"type":"commonjs"}\n');
  const module = await import(pathToFileURL(path.join(temp, "nodeLayout.js")).href);
  const layout = module.default ?? module;
  const ports = Array.from({ length: 12 }, (_, index) => ({ id: `item${index + 1}`, label: `Input ${index + 1}`, valueType: "any" }));
  const dynamic = layout.resolveNodeCardLayout({ requestedDirection: "vertical", label: "Dynamic Inputs", inputPorts: ports, outputPorts: [{ id: "output", label: "Output", valueType: "any" }], inputDefaultSpecs: [], inlineParameters: [], inlineLayout: "stack", hasVariants: false, hasInputPortGroups: true, hasDynamicPorts: false, isGroup: false, nodeScale: 1, endpointScale: 1 });
  if (!dynamic.dynamic || !dynamic.sideRailLayout || dynamic.direction !== "horizontal") throw new Error("complex dynamic node did not switch to side rails");
  const tops = ports.map((_, index) => dynamic.portTop(index));
  if (!tops.every((value, index) => index === 0 || value - tops[index - 1] === dynamic.portRowHeight)) throw new Error("dynamic ports do not use deterministic rows");
  if (tops.at(-1) >= dynamic.nodeMinHeight) throw new Error("last dynamic port exceeds node bounds");
  const staticVertical = layout.resolveNodeCardLayout({ requestedDirection: "vertical", label: "Static", inputPorts: [{ id: "input", label: "Input", valueType: "any" }], outputPorts: [{ id: "output", label: "Output", valueType: "any" }], inputDefaultSpecs: [], inlineParameters: [], inlineLayout: "stack", hasVariants: false, hasInputPortGroups: false, hasDynamicPorts: false, isGroup: false, nodeScale: 1, endpointScale: 1 });
  if (staticVertical.dynamic || staticVertical.direction !== "vertical") throw new Error("static node layout was unnecessarily overridden");
  const inline = { key: "mode", label: "Mode", kind: "select", defaultValue: "a", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] };
  const inlineDynamic = layout.resolveNodeCardLayout({ requestedDirection: "vertical", label: "Inline Dynamic", inputPorts: [{ id: "input", label: "Input", valueType: "any" }], outputPorts: [{ id: "output", label: "Output", valueType: "any" }], inputDefaultSpecs: [], inlineParameters: [inline], inlineLayout: "row", hasVariants: false, hasInputPortGroups: false, hasDynamicPorts: false, isGroup: false, nodeScale: 1, endpointScale: 1 });
  if (!inlineDynamic.dynamic || !inlineDynamic.sideRailLayout || inlineDynamic.direction !== "horizontal") throw new Error("dynamic node with inline UI did not use the shared side-rail contract");

  const socket = { key: "value", label: "Value", kind: "number", defaultValue: 0 };
  const socketLayout = layout.resolveNodeCardLayout({ requestedDirection: "vertical", label: "Socket Defaults", inputPorts: [{ id: "value", label: "Value", valueType: "number", defaultParameter: "value" }], outputPorts: [], inputDefaultSpecs: [socket], inlineParameters: [], inlineLayout: "stack", hasVariants: false, hasInputPortGroups: false, hasDynamicPorts: false, isGroup: false, nodeScale: 1, endpointScale: 1 });
  if (!socketLayout.sideRailLayout || socketLayout.socketControlWidth < 70) throw new Error("socket default control did not receive a stable side rail");
  const signaturePorts = Array.from({ length: 7 }, (_, index) => ({ id: `arg${index + 1}`, label: `Long function argument ${index + 1}`, valueType: "any" }));
  const functionLayout = layout.resolveNodeCardLayout({ requestedDirection: "vertical", label: "Portable Function", inputPorts: signaturePorts, outputPorts: [{ id: "result", label: "Result", valueType: "any" }], inputDefaultSpecs: [], inlineParameters: [], inlineLayout: "stack", hasVariants: false, hasInputPortGroups: false, hasDynamicPorts: true, isGroup: false, nodeScale: 1, endpointScale: 1 });
  if (!functionLayout.dynamic || !functionLayout.sideRailLayout || functionLayout.direction !== "horizontal") throw new Error("runtime-signature node did not use dynamic side rails");
  const denseEndpointLayout = layout.resolveNodeCardLayout({ requestedDirection: "vertical", label: "Dense Endpoints", inputPorts: ports, outputPorts: [{ id: "output", label: "Output", valueType: "any" }], inputDefaultSpecs: [], inlineParameters: [], inlineLayout: "stack", hasVariants: false, hasInputPortGroups: true, hasDynamicPorts: false, isGroup: false, nodeScale: 0.75, endpointScale: 1.8 });
  if (denseEndpointLayout.portRowHeight * 0.75 < 16 * 1.8 + 5) throw new Error("dynamic port rows do not reserve enough room for enlarged endpoints");
  console.log("Node Layout Contract smoke: PASS (dynamic/signature side rails, deterministic rows, endpoint-scale spacing, static direction preservation, socket geometry)");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
