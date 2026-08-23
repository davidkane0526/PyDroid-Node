import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(path.join(root, "src/App.tsx"), "utf8");
const environmentOverlay = readFileSync(path.join(root, "src/WorkflowEnvironmentOverlay.tsx"), "utf8");
const css = readFileSync(path.join(root, "src/styles.css"), "utf8");
const uiFixes = readFileSync(path.join(root, "src/ui-fixes.css"), "utf8");
const gestures = readFileSync(path.join(root, "src/editor-core/gesture-policy.ts"), "utf8");
const workflowFunctions = readFileSync(path.join(root, "src/workflow-functions.ts"), "utf8");
const dialogs = readFileSync(path.join(root, "src/dialogs.tsx"), "utf8");
const canvasThemes = readFileSync(path.join(root, "src/canvas-themes.css"), "utf8");
assert.match(app, /errorIndicatorTimersRef/, "tab error badges should have transient timers");
assert.match(app, /4500/, "failed\/timeout tab badge should auto-dismiss after a short diagnostic window");
assert.match(app, /executionErrorVisible[\s\S]*errorIndicators\[tab\.id\]/, "failed tab badge visibility should be decoupled from persistent execution status");
assert.match(css, /\.smb-file-manager:has\(\.smb-connection-form input:focus\) \.smb-manager-footer[\s\S]*display:\s*none\s*!important/, "Android SMB footer should hide while editing credentials to avoid keyboard overlap");
assert.match(css, /\.settings-layout\s*\{[\s\S]*align-items:\s*stretch/, "settings grid rows should stretch paired cards to equal height");
assert.match(css, /\.settings-layout \.settings-section\s*\{[\s\S]*height:\s*100%/, "settings cards should fill their grid row height");
assert.match(gestures, /resource:[\s\S]*longPressMs:\s*710[\s\S]*dragThresholdPx:\s*8/, "touch resource menu should keep its deliberate ~0.7s hold and movement threshold in Gesture Policy");
assert.match(app, /distance > policy\.dragThresholdPx[\s\S]*clearPaletteResourceMenuHold/, "moving a palette resource should cancel its touch menu hold through Gesture Policy");
assert.doesNotMatch(app, /paletteDragTimer\.current = window\.setTimeout[\s\S]{0,600}280/, "touch palette drag must be movement-driven rather than a competing hold timer");
assert.match(app, /paletteTouchTap/, "touch resource menus should have an explicit double-tap state machine instead of relying on WebView dblclick synthesis");
assert.match(app, /now - previous\.at <= 430/, "touch double-tap should use a bounded gesture window");
assert.match(app, /schedulePaletteSingleClick[\s\S]*470/, "flow single-click should wait slightly longer than the touch double-tap window");
assert.match(app, /group-resource-card[\s\S]*onDoubleClick=[\s\S]*openPaletteMenuFromElement/, "node groups should keep desktop double-click menu access");
assert.match(app, /flow-library-item[\s\S]*onDoubleClick=[\s\S]*openPaletteMenuFromElement/, "workflow resources should keep desktop double-click menu access");
assert.match(css, /app-shell\.native-platform:has\(\.node-palette input:focus[\s\S]*grid-template-rows:[^;]*0;/, "Android main-workspace keyboard editing should collapse the status-bar row instead of lifting it above the IME");
assert.match(css, /app-shell\.native-platform[\s\S]*user-select:\s*none/, "Android app chrome should suppress accidental WebView text selection");
assert.match(css, /app-shell\.native-platform \.node-palette button[\s\S]*touch-action:\s*pan-y/, "Android palette resources should reserve horizontal pointer motion for custom drag while keeping vertical scrolling");
assert.doesNotMatch(css, /app-shell\.native-platform \.node-palette button[\s\S]{0,260}touch-action:\s*manipulation/, "Android palette resources must not let WebView consume both gesture axes before custom dragging begins");
assert.doesNotMatch(app, /remote-server-banner__alternates|remote-server-banner__expand/, "Remote Web banner should stay compact and show only the canonical address");
assert.match(app, /pointerMode !== "mouse"\) return/, "synthetic Android contextmenu events should not race the explicit touch gesture");
assert.match(app, /nodeTouchDragSuppressMenuUntil/, "dragging a canvas node on touch should suppress only the synthetic drag-time context menu");
assert.match(gestures, /node:[\s\S]*longPress:\s*"enter-multi-select"/, "mobile node hold should remain a multi-select gesture");
assert.match(gestures, /group:[\s\S]*doubleTap:\s*"open-group"[\s\S]*longPress:\s*"enter-multi-select"/, "mobile group should preserve accepted long-press multi-select while keeping its own double-tap subflow policy");

assert.match(app, /remoteBannerVisible/, "Remote Web banner should be independently collapsible without stopping the server");
assert.match(app, /setRemoteBannerVisible\(false\)/, "Remote Web banner should support collapsing into the status bar");
assert.match(app, /remote-server-banner__status">计算服务已开启/, "Remote Web banner should explicitly render the same running-state label on Android and Desktop");
assert.match(css, /\.remote-server-banner\s*\{[^}]*width:\s*max-content;[^}]*max-width:\s*min\(760px,\s*calc\(100vw - 24px\)\)/, "Remote Web banner should use the compact Phase-1 content-width model");
assert.match(css, /app-shell\.native-platform \.remote-server-banner\s*\{[^}]*width:\s*max-content;[^}]*max-width:\s*calc\(100vw - 16px\)/, "Android Remote Web banner should share the same one-row content-width model");
assert.doesNotMatch(css + uiFixes, /remote-server-banner[^{]*\{[^}]*grid-template-columns/, "Remote Web banner must not split status, URL, PIN and controls into multiple grid rows");
assert.doesNotMatch(uiFixes, /remote-server-banner strong\s*\{[^}]*display:\s*none/, "responsive overrides must not hide the running-state label");
assert.match(app, /statusbar-quick-services[\s\S]*statusbar-service-button--smb[\s\S]*statusbar-service-button--remote[\s\S]*statusbar-history/, "SMB and Remote service shortcuts should sit together immediately beside History");
assert.match(app, /statusbar-service-button--smb[\s\S]{0,420}<circle cx="12" cy="6" r="2\.2"\/>[\s\S]*<circle cx="6" cy="17" r="2\.2"\/>/, "SMB status-bar shortcut should use the compact network-topology glyph");
assert.match(css, /statusbar-service-button svg,[\s\S]*statusbar-quick-services \.statusbar-history svg\s*\{[\s\S]*stroke-width:\s*1\.25;/, "SMB, Remote and History status-bar glyphs should share the thinner stroke weight");
assert.match(app, /statusbar-service-button--remote \${remoteServer \? "active" : ""}/, "Remote service shortcut should remain visually active while the host service is running");
assert.match(css, /\.statusbar-service-button--remote\.active\s*\{[^}]*background:\s*transparent;/, "active Remote shortcut should not paint a blue background");
assert.match(css, /\.statusbar-service-button--remote\.active \.statusbar-service-button__indicator\s*\{[^}]*display:\s*block\s*!important;/, "green status dot should remain the only persistent running-state indicator");
assert.match(css, /\.smb-manager-footer \.button\s*\{[^}]*min-height:\s*30px;[^}]*padding:\s*5px 9px;/, "SMB footer actions should use compact shared button metrics");
assert.match(uiFixes, /\.agent-dialog \.agent-plan > div \.button\s*\{[^}]*min-height:\s*30px;[^}]*padding:\s*5px 9px;/, "AI Agent plan actions should use compact shared button metrics");

assert.match(app, /data\.nodeType === "function\.call"[\s\S]*functionInputs[\s\S]*functionOutputs/, "function.call cards must render dynamic signature handles");
assert.match(app, /setWorkspaceVariableRevision\(\(value\) => value \+ 1\)/, "workspace variable resource list must refresh explicitly after execution");
assert.match(app, /AutomatedDiagnosticsDialog/, "desktop and Android shared UI must expose the removable automated diagnostics dialog");
assert.match(app, /runInAppAutomatedDiagnostics/, "automated diagnostics must be runnable from the application UI");
assert.doesNotMatch(dialogs, /Windows 首次启用时可能请求管理员授权|TCP 8765、UDP 1900|防火墙规则/, "Remote Access UI must not gain unapproved firewall/explanatory copy");
assert.match(app, /const remoteServerTransitionRef = useRef\(false\)/, "Remote Web UI start/stop must have a single-flight transition guard");
assert.doesNotMatch(app, /useRemoteHostReconciliation|getRemoteHostStatus/, "Remote Web UI must not poll or reconcile against a native lifecycle state machine");
assert.doesNotMatch(app, /readiness\?\.firewall|readiness\.firewall/, "Remote Web UI and in-app diagnostics must not block startup on brittle Windows firewall/profile probing");
assert.match(app, /resourceLibraryState\.groups\.filter\(isEditorResourceUsable\)/, "future/invalid group resources must stay out of the interactive palette without adding UI copy");
assert.match(app, /resourceLibraryState\.savedNodes\.filter\(isEditorResourceUsable\)/, "future/invalid saved-node resources must stay out of the interactive palette without adding UI copy");
assert.match(app, /resourceLibraryState\.flows\.filter\(isEditorResourceUsable\)/, "future/invalid flow resources must stay out of the interactive palette without adding UI copy");
assert.doesNotMatch(app, /compatibility === "future"[\s\S]{0,180}setMessage\(/, "Phase 11 compatibility protection must not add new user-visible copy");

assert.match(app, /palette-tabs[\s\S]*paletteTab === "nodes"[\s\S]*paletteTab === "functions"[\s\S]*paletteTab === "groups"[\s\S]*paletteTab === "flows"/, "resource tabs must stay ordered Nodes → Functions → Groups → Flows");
assert.doesNotMatch(app, /setPaletteTab\("context"\)|paletteTab === "context"/, "workflow environment must not return as a resource-palette Context tab");
assert.match(environmentOverlay, /resolveCanvasFloatingAnchor[\s\S]*react-flow__minimap[\s\S]*canvas-breadcrumb/, "floating Environment control must calculate against visible-canvas occluders instead of using a fixed bottom-right offset");
assert.match(environmentOverlay, /environment-float-button[\s\S]*anchor\.left[\s\S]*anchor\.top[\s\S]*当前标签/, "the Environment control must follow the active tab and its dynamically resolved visible-canvas anchor");
assert.match(environmentOverlay, /environment-floating-panel[\s\S]*Python 环境[\s\S]*工作流参数[\s\S]*工作区变量[\s\S]*依赖包/, "the floating Environment panel must own imports, parameters, per-tab runtime variables and requirements");
assert.match(app, /WorkflowEnvironmentOverlay[\s\S]*tabName=\{tabName\}[\s\S]*environment=\{environment\}/, "the floating Environment panel must receive the active tab's workflow environment from its Editor session");
assert.match(css, /\.palette-tabs\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/, "resource palette should return to four primary resource classes after Environment moves onto the canvas");
assert.match(app, /const PALETTE_MIN_WIDTH = 216/, "resource palette must enforce the wider Phase 8 minimum width");
assert.match(css, /minmax\(216px, min\(var\(--palette-width, 216px\)/, "responsive workspace CSS must preserve the 216px resource palette floor");
assert.match(css, /\.palette-tabs__label \{[^}]*overflow:\s*visible;[^}]*text-overflow:\s*clip;[^}]*white-space:\s*nowrap;/, "resource tab labels must not be ellipsized or compressed");
assert.match(app, /const downloadText = async[\s\S]*exportTextFile\(name, text, type\)/, "all user-visible text/CSV exports must route through the platform file I/O capability");
assert.doesNotMatch(app, /const downloadText = \(text[\s\S]{0,320}URL\.createObjectURL/, "shared export actions must not bypass Android SAF with a browser-only download link");
assert.match(environmentOverlay, /closest\("\.canvas-panel"\)[\s\S]*setOpen\(false\)[\s\S]*document\.addEventListener\("pointerdown"/, "Environment panel should close when the user returns to the canvas");
assert.match(app, /exportTextFile\(fileName,[\s\S]*application\/json/, "automated diagnostics export must use the platform file-export capability");
assert.match(app, /automatedDiagnosticsExportStatus/, "diagnostic export must surface save/cancel/failure status inside the dialog");
assert.match(app, /const insertFunctionCall = \(definition: WorkflowFunctionDefinition, requestedPosition\?: \{ x: number; y: number \}\)/, "function resource drop must keep an optional explicit position in the UI helper contract");
assert.match(app, /const position = requestedPosition \?\? functionInsertionPosition\(nodes, currentCanvasId, resolvedLayoutDirection\);/, "function call insertion must honor the resource-drop position while retaining palette-button fallback placement");
assert.match(workflowFunctions, /functionInsertionPosition[\s\S]*direction === "vertical"[\s\S]*Math\.max[\s\S]*\+ 285/, "function palette fallback placement must remain owned by the shared workflow-function helper");
assert.match(app, /node-run-action[\s\S]*单独运行 · 自动补齐上游依赖/, "every canvas node/group should expose the compact node-scoped run action");
assert.match(css, /\.workflow-function-card \.flow-library-actions button \{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;/, "workflow function action labels should be centered by layout rather than line-height compensation");
assert.match(css, /\.node-run-action \{[^}]*border:\s*1px solid #334b68;[^}]*color:\s*#55a8ff;[^}]*background:\s*#192536;[^}]*opacity:\s*0;[^}]*visibility:\s*hidden;[^}]*pointer-events:\s*none;/, "node run action should use the shared Soft dark material and stay hidden by default");
assert.match(css, /\.workflow-node:hover > \.node-run-action[^}]*opacity:\s*1;[^}]*visibility:\s*visible;/, "desktop node hover should reveal the run action");
assert.match(css, /app-shell\.native-platform \.workflow-node\.selected > \.node-run-action[^}]*opacity:\s*1;[^}]*visibility:\s*visible;/, "native touch UI should reveal the run action only for the selected node");
assert.match(css, /app-shell\[data-theme="light"\] \.node-run-action \{[^}]*border-color:\s*#c9dcf4;[^}]*color:\s*#0877f9;[^}]*background:\s*rgba\(255,255,255,\.84\);/, "light mode should use the shared Soft run-control material in every canvas theme");
assert.match(app, /nodeExecutionSubgraph\(nodes, edges, nodeId\)/, "node-scoped execution must derive its upstream context from the graph instead of running the whole workspace");
assert.match(app, /maxPortCount[\s\S]*nodeMinHeight[\s\S]*horizontalPortLabelWidth/, "node geometry should adapt to endpoint count and endpoint-label width");
assert.match(app, /__notebook_order_in[\s\S]*__notebook_order_out/, "Notebook execution-order links should use hidden non-user handles rather than consuming data ports");
assert.match(css, /\.notebook-order-handle\s*\{[^}]*opacity:\s*0\s*!important;[^}]*pointer-events:\s*none\s*!important;/, "Notebook order handles must remain invisible and non-interactive");

assert.match(css, /\.node-run-action\s*\{[^}]*display:\s*grid;[^}]*width:\s*24px;[^}]*height:\s*24px;[^}]*place-items:\s*center;/, "shared node run button geometry should center the play mark in both canvas themes");
assert.match(app, /node-run-action__icon[\s\S]*viewBox="0 0 14 14"[\s\S]*M5\.25 3\.15 L11\.25 6\.55 Q12\.85 7 11\.25 7\.45/, "shared run button should use the smaller rounded SVG play mark");
assert.match(css, /\.node-run-action__icon\s*\{[^}]*top:\s*-0\.5px;[^}]*width:\s*12px;[^}]*height:\s*12px;[^}]*fill:\s*currentColor;/, "shared run icon should use the smaller optically centered glyph");
assert.match(css, /\.environment-float-button > svg\s*\{[^}]*stroke-width:\s*1;/, "environment icon should use crisp one-pixel rails");
assert.match(css, /\.environment-float-button > svg circle\s*\{[^}]*fill:\s*currentColor;[^}]*stroke:\s*none;/, "environment icon should use solid control knobs rather than hollow circles");
assert.match(css, /\.react-flow__handle\s*\{[^}]*width:\s*calc\(16px \* var\(--endpoint-scale, 1\)\);[^}]*height:\s*calc\(16px \* var\(--endpoint-scale, 1\)\)/, "shared endpoint geometry should be enlarged consistently across light/dark and canvas themes");
assert.match(css, /\.input-port span, \.output-port span \{[^}]*font-size:\s*calc\(10\.5px \* var\(--node-scale, 1\)\)/, "port labels should use the enlarged shared type size");
assert.match(dialogs, /settings-canvas-select-row[\s\S]*画布主题[\s\S]*缩略图/, "canvas theme and minimap selectors should share one aligned settings row");
assert.match(dialogs, /settings-canvas-result-row[\s\S]*结果区高度[\s\S]*显示节点运行结果/, "node-result visibility should align with the result-height control row");
assert.match(css, /\.settings-canvas-select\s*\{[^}]*grid-template-columns:\s*max-content minmax\(138px, 164px\)[^}]*gap:\s*8px;/, "canvas selector labels should sit close to their dropdowns");
assert.match(dialogs, /settings-mcp-heading-row[\s\S]*settings-help-button[\s\S]*MCP 连接帮助/, "MCP settings card should expose a compact top-right connection-help button");
assert.match(dialogs, /settings-mcp-token[\s\S]*输入固定 Token[\s\S]*settings-copy-button[\s\S]*复制 Token/, "MCP settings should expose a persistent user-defined Token with an explicit copy action");
assert.match(dialogs, /settings-mcp-value[\s\S]*复制 Endpoint/, "MCP Endpoint should expose an explicit copy action");
assert.match(dialogs, /showCopyNotice\(L\(`已复制 \$\{label\}`[\s\S]*settings-copy-toast/, "MCP copy actions should surface a transient success confirmation");
assert.match(dialogs, /mcp_servers\.pydroid/, "MCP help dialog should include a Codex MCP configuration example");
assert.match(dialogs, /X-PyDroid-Token[\s\S]*不需要 Bearer 前缀/, "MCP help should document the direct custom Token header without a Bearer prefix");
assert.match(dialogs, /mcp-help-dialog[\s\S]*Streamable HTTP · 8766[\s\S]*复制配置/, "MCP help dialog should include Streamable HTTP connection guidance and a copy-config action");
assert.match(css, /\.settings-mcp-values\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/, "MCP Endpoint and header controls should use a balanced two-column desktop layout");
assert.match(css, /@media \(max-width: 500px\)[\s\S]*\.settings-mcp-values\s*\{\s*grid-template-columns:\s*1fr;/, "MCP Endpoint and header controls should stack on narrow mobile screens");


// Product UI must not expose development handoff/theme-lab notes.
for (const [file, text] of [["src/App.tsx", app], ["src/dialogs.tsx", dialogs]]) {
  for (const forbidden of ["Theme Lab", "粘贴给开发者", "临时自动诊断", "删除 diagnostics", "桌面 HMR", "Android LAN HMR", "可切换画布主题对比"]) {
    if (text.includes(forbidden)) throw new Error(`${file} contains development-only UI copy: ${forbidden}`);
  }
}
if (/data-canvas-theme=["']soft["'][^}]*\.node-run-action|data-canvas-theme=["']soft["'][^}]*node-run-action/s.test(canvasThemes)) {
  throw new Error("Canvas theme must not override node run-control appearance; Classic and Soft share one control");
}
console.log("UI regression smoke passed.");
