import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const gitDir = path.join(root, ".git");
assert.ok(fs.existsSync(gitDir), "Phase 11 historical corpus audit requires the complete .git history");

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const git = (args, options = {}) => execFileSync("git", args, { cwd: root, encoding: options.encoding ?? "utf8", maxBuffer: 128 * 1024 * 1024 });

const fixtureRoot = path.join(root, "tests", "workflow-compatibility", "fixtures");
const manifest = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "manifest.json"), "utf8"));
const historicalFixtures = new Map();
for (const fixture of manifest.fixtures.filter((entry) => entry.expectedCurrent)) {
  const bytes = fs.readFileSync(path.join(fixtureRoot, fixture.file));
  const parsed = JSON.parse(bytes.toString("utf8"));
  assert.equal(parsed.schemaVersion, fixture.schemaVersion, `${fixture.file}: manifest schemaVersion does not match fixture`);
  historicalFixtures.set(sha256(bytes), fixture.file);
}

const historical = new Map();
const PHASE11_BASE = "64f7c98"; // 1.4.76 accepted boundary; fixtures committed by Phase 11 must not contaminate the historical corpus.
const commits = git(["rev-list", PHASE11_BASE]).trim().split(/\r?\n/).filter(Boolean);
for (const commit of commits) {
  const paths = git(["ls-tree", "-r", "--name-only", commit]).split(/\r?\n/).filter((entry) => entry.endsWith(".workflow.json"));
  for (const file of paths) {
    let bytes;
    try {
      bytes = execFileSync("git", ["show", `${commit}:${file}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    } catch {
      continue;
    }
    let document;
    try { document = JSON.parse(bytes.toString("utf8")); } catch { continue; }
    if (!document || typeof document !== "object" || !Number.isInteger(Number(document.schemaVersion)) || !Array.isArray(document.nodes) || !Array.isArray(document.edges)) continue;
    const hash = sha256(bytes);
    if (!historical.has(hash)) historical.set(hash, { commit, file, schemaVersion: Number(document.schemaVersion), name: String(document.name ?? "") });
  }
}

assert.ok(historical.size > 0, "No historical workflow documents were found in Git history");
const missing = [...historical.entries()].filter(([hash]) => !historicalFixtures.has(hash));
assert.deepEqual(missing.map(([, entry]) => entry), [], `Compatibility corpus is missing ${missing.length} historical workflow document(s)`);

const orphanFixtures = [...historicalFixtures.entries()].filter(([hash]) => !historical.has(hash));
assert.deepEqual(orphanFixtures.map(([, file]) => file), [], "Historical compatibility fixtures must originate from real repository history");

const versions = [...new Set([...historical.values()].map((entry) => entry.schemaVersion))].sort((a, b) => a - b);
console.log(`Workflow history corpus audit passed (${historical.size} unique historical documents, schema versions ${versions.join(", ")}, ${historicalFixtures.size} fixtures).`);
