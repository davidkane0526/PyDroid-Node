import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const desktopDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(desktopDirectory, "..");

export default defineConfig({
  root: projectRoot,
  plugins: [react()],
  base: "./",
  resolve: {
    alias: [
      {
        find: /^\.\/execution$/,
        replacement: path.join(desktopDirectory, "renderer", "execution.ts"),
      },
    ],
  },
  build: {
    outDir: path.join(projectRoot, "dist-desktop"),
    emptyOutDir: true,
  },
});
