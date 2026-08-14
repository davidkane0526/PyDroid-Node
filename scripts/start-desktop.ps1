# Launch the unpacked PyDroid Flow desktop app (reuses dist-desktop + local Python runtime)
# Usage: powershell -ExecutionPolicy Bypass -File scripts/start-desktop.ps1
# Note: node_modules/electron lacks cli.js due to the junctioned layout, so "pnpm desktop"
#       fails; this script starts desktop/main.cjs via electron.exe directly instead.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# Prefer node already on PATH; otherwise fall back to the portable runtime recorded in docs/environment.md
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  $portableNode = "D:\PyDroidTemp\PyDroid\tools\node-v24.14.0-win-x64"
  if (Test-Path (Join-Path $portableNode "node.exe")) { $env:PATH = "$portableNode;$env:PATH" }
  else { throw "Node.js not found: run pnpm env:windows or configure the build environment first" }
}

if (-not (Test-Path (Join-Path $root "dist-desktop\index.html"))) {
  Write-Host "dist-desktop missing, building desktop bundle first..."
  pnpm desktop:build
  if ($LASTEXITCODE -ne 0) { throw "desktop build failed" }
}

& (Join-Path $root "node_modules\electron\dist\electron.exe") (Join-Path $root "desktop\main.cjs")
exit $LASTEXITCODE
