import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import "./ui-fixes.css";
import "./canvas-themes.css";
import { App } from "./App";
import { restoreNodePluginPackages } from "./nodePluginPackages";

const pluginRestoreFailures = restoreNodePluginPackages();
for (const failure of pluginRestoreFailures) console.error(`Plugin restore failed: ${failure.id}: ${failure.error}`);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);