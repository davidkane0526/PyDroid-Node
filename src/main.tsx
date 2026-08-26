import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "./styles/base.css";
import "./styles/shell-responsive.css";
import "./styles/panels.css";
import "./styles/result-presentation.css";
import "./styles/canvas.css";
import "./plugins/plugin-manager.css";
import "./styles/theme-contract.css";
import { App } from "./App";
import { restoreNodePluginPackages } from "./plugins/packages";

const pluginRestoreFailures = restoreNodePluginPackages();
for (const failure of pluginRestoreFailures) console.error(`Plugin restore failed: ${failure.id}: ${failure.error}`);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);