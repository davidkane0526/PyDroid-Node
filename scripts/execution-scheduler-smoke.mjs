import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { WorkflowExecutionScheduler } = require("../desktop/execution/WorkflowExecutionScheduler.cjs");

let running = 0;
let maxRunning = 0;
const releases = [];
const scheduler = new WorkflowExecutionScheduler({ capacity: 2, cancelRunning: () => true });
const submit = (executionId, workspaceId) => scheduler.submit({ executionId, workspaceId, clientId: "client", source: "local" }, () => new Promise((resolve) => {
  running += 1;
  maxRunning = Math.max(maxRunning, running);
  releases.push(() => { running -= 1; resolve(executionId); });
}));

const a = submit("exec-a", "tab-a");
const b = submit("exec-b", "tab-b");
const c = submit("exec-c", "tab-c");
await new Promise((resolve) => setTimeout(resolve, 10));
let status = scheduler.status();
assert.equal(status.runningCount, 2);
assert.equal(status.queuedCount, 1);
assert.equal(status.executions.find((entry) => entry.executionId === "exec-c")?.phase, "queued");
assert.equal(maxRunning, 2);
assert.equal(scheduler.cancel("exec-c"), true);
await assert.rejects(c, /EXECUTION_CANCELLED/);
releases.shift()();
assert.equal(await a, "exec-a");
releases.shift()();
assert.equal(await b, "exec-b");
status = scheduler.status();
assert.equal(status.active, false);
console.log("Execution scheduler smoke test passed");
