import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const packagePath = path.join(root, "package.json");
const gradlePath = path.join(root, "android", "app", "build.gradle");
const appVersionPath = path.join(root, "src", "app-version.ts");

const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const match = String(pkg.version ?? "").match(/^(\d+)\.(\d+)\.(\d+)$/);
if (!match) throw new Error(`Unsupported package version: ${pkg.version}`);

const nextVersion = `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
pkg.version = nextVersion;
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");

let gradle = fs.readFileSync(gradlePath, "utf8");
const codeMatch = gradle.match(/versionCode\s+(\d+)/);
if (!codeMatch) throw new Error("android/app/build.gradle is missing versionCode");
const nextCode = Number(codeMatch[1]) + 1;
gradle = gradle
  .replace(/versionCode\s+\d+/, `versionCode ${nextCode}`)
  .replace(/versionName\s+"[^"]+"/, `versionName "${nextVersion}"`);
fs.writeFileSync(gradlePath, gradle, "utf8");

fs.writeFileSync(appVersionPath, `export const APP_VERSION = "${nextVersion}";\n`, "utf8");

console.log(`${nextVersion} (Android versionCode ${nextCode})`);
