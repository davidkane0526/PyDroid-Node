import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const appVersionSource = fs.readFileSync(path.join(root, "src", "app-version.ts"), "utf8");
const gradle = fs.readFileSync(path.join(root, "android", "app", "build.gradle"), "utf8");

const uiVersion = appVersionSource.match(/APP_VERSION\s*=\s*"([^"]+)"/)?.[1];
const androidVersion = gradle.match(/versionName\s+"([^"]+)"/)?.[1];
const androidCode = Number(gradle.match(/versionCode\s+(\d+)/)?.[1] ?? NaN);

const failures = [];
if (!pkg.version) failures.push("package.json has no version");
if (uiVersion !== pkg.version) failures.push(`UI version ${uiVersion ?? "missing"} != package version ${pkg.version}`);
if (androidVersion !== pkg.version) failures.push(`Android version ${androidVersion ?? "missing"} != package version ${pkg.version}`);
if (!Number.isInteger(androidCode) || androidCode <= 0) failures.push("Android versionCode is missing or invalid");

if (failures.length) {
  for (const failure of failures) console.error(`VERSION ERROR: ${failure}`);
  process.exit(1);
}
console.log(`Version sync OK: ${pkg.version} (Android versionCode ${androidCode})`);
