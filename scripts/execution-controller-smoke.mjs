import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { PythonProcessController } = require("../desktop/execution/PythonProcessController.cjs");

const controller = new PythonProcessController({ platform: process.platform });
const node = process.execPath;

const success = await controller.execute({
  executionId: "smoke-success",
  timeoutMs: 5_000,
  executable: node,
  args: ["-e", "process.stdin.resume();process.stdin.on('end',()=>process.stdout.write('ok'))"],
  cwd: process.cwd(),
  env: process.env,
  payload: { hello: "world" },
});
assert.equal(success, "ok");
assert.equal(controller.activeCount(), 0);

const cancelled = controller.execute({
  executionId: "smoke-cancel",
  timeoutMs: 5_000,
  executable: node,
  args: ["-e", "process.stdin.resume();setInterval(()=>{},1000)"],
  cwd: process.cwd(),
  env: process.env,
  payload: {},
});
setTimeout(() => controller.cancel("smoke-cancel"), 60);
await assert.rejects(cancelled, /EXECUTION_CANCELLED/);
assert.equal(controller.activeCount(), 0);

const sentinel = path.join(os.tmpdir(), `pydroid-cancel-${process.pid}.txt`);
try { fs.unlinkSync(sentinel); } catch {}
const lateWriter = controller.execute({
  executionId: "smoke-no-late-output",
  timeoutMs: 5_000,
  executable: node,
  args: ["-e", `setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(sentinel)},'late'),1200);setInterval(()=>{},1000)`],
  cwd: process.cwd(),
  env: process.env,
  payload: {},
});
setTimeout(() => controller.cancel("smoke-no-late-output"), 80);
await assert.rejects(lateWriter, /EXECUTION_CANCELLED/);
await new Promise((resolve) => setTimeout(resolve, 1_350));
assert.equal(fs.existsSync(sentinel), false, "cancelled host process must not continue to produce late results");

const timedOut = controller.execute({
  executionId: "smoke-timeout",
  timeoutMs: 1_000,
  executable: node,
  args: ["-e", "process.stdin.resume();setInterval(()=>{},1000)"],
  cwd: process.cwd(),
  env: process.env,
  payload: {},
});
await assert.rejects(timedOut, /EXECUTION_TIMEOUT/);
assert.equal(controller.activeCount(), 0);

console.log("Execution controller desktop process smoke test passed");
