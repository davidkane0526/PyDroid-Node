import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const pkg = JSON.parse(read("package.json"));
const baseline = read("docs/BASELINE.md");
const agents = read("AGENTS.md");
const remote = read("desktop/services/remote-server.cjs");
const network = read("desktop/lan/network.cjs");
const types = read("src/platform/types.ts");

const versionParts = String(pkg.version).split(".").map(Number);
const baselineParts = [1, 4, 92];
const versionAtLeastBaseline = versionParts.length === 3 && versionParts.every(Number.isFinite)
  && (versionParts[0] > baselineParts[0]
    || (versionParts[0] === baselineParts[0] && versionParts[1] > baselineParts[1])
    || (versionParts[0] === baselineParts[0] && versionParts[1] === baselineParts[1] && versionParts[2] >= baselineParts[2]));
assert.equal(versionAtLeastBaseline, true, "package version must not move behind the 1.4.92 consolidated baseline");
assert.match(baseline, /1\.4\.92/, "docs/BASELINE.md must retain the 1.4.92 consolidation anchor");
assert.match(baseline, /authoritative baseline/i, "docs/BASELINE.md must explicitly be authoritative");
assert.match(baseline, /Android tablet/i, "current baseline must preserve the physical Remote Web acceptance evidence");
assert.match(agents, /docs\/BASELINE\.md/, "AGENTS.md must route future agents through the consolidated baseline first");
assert.ok(fs.existsSync(path.join(root, "docs/history/1.4.83-deterministic-core.md")), "1.4.83 architecture note must remain historical, not active");
assert.ok(fs.existsSync(path.join(root, "docs/history/phase10-remote-security-host-reliability.md")), "Phase 10 reliability/security note must remain historical, not active");
assert.match(remote, /listen\(LAN_WEB_PORT, "0\.0\.0\.0"/, "Remote Web must keep the accepted direct fixed-port bind");
assert.match(remote, /request\.method !== "GET"[\s\S]*Method not allowed/, "Desktop Remote API must preserve GET-only health contract");
assert.match(remote, /url\.pathname === "\/api\/agent-proxy"[\s\S]*409/, "Desktop Remote API must preserve the explicit Agent proxy unsupported contract");
assert.doesNotMatch(network, /defaultRoute|route\.exe|child_process|powershell/i, "LAN interface selection must not claim/query a default route or launch external processes");
assert.match(network, /preferred:\s*false/, "LAN interface model must expose the deterministic preferred-interface hint");
assert.match(types, /preferred\?: boolean/, "shared Remote discovery type must use the preferred-interface name");
assert.doesNotMatch(types, /defaultRoute\?: boolean/, "stale defaultRoute discovery type must not return");

console.log("Baseline consolidation smoke passed: 1.4.92 authority, physical LAN anchor, Remote API correctness and preferred-interface semantics are pinned.");
