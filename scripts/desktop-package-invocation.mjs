import fs from "node:fs";
import path from "node:path";
import process from "node:process";

export function packageManagerInvocation(
  args,
  {
    env = process.env,
    platform = process.platform,
    nodeExecPath = process.execPath,
    existsSync = fs.existsSync,
  } = {},
) {
  // npm_execpath is not guaranteed to be JavaScript. pnpm installed through
  // @pnpm/exe exposes a native pnpm.exe on Windows, while Corepack/npm-style
  // launchers commonly expose a .js/.cjs/.mjs entry point. Only JavaScript
  // launchers should be passed to Node; native executables must be spawned directly.
  const npmExecPath = env.npm_execpath;
  if (npmExecPath && existsSync(npmExecPath)) {
    const extension = path.extname(npmExecPath).toLowerCase();
    if ([".js", ".cjs", ".mjs"].includes(extension)) {
      return {
        command: env.npm_node_execpath || nodeExecPath,
        args: [npmExecPath, ...args],
        shell: false,
      };
    }
    if (extension === ".cmd" || extension === ".bat") {
      return {
        command: npmExecPath,
        args,
        shell: platform === "win32",
      };
    }
    return { command: npmExecPath, args, shell: false };
  }
  return {
    command: platform === "win32" ? "pnpm.cmd" : "pnpm",
    args,
    shell: platform === "win32",
  };
}
