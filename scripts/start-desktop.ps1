# Launch the unpacked PyDroid Flow desktop app using explicit project dependencies.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$pnpm = if ($env:PYDROID_PNPM_EXECUTABLE) { [string]$env:PYDROID_PNPM_EXECUTABLE } else { "D:\Code\NodeJs\pnpm.cmd" }
$electron = Join-Path $root "node_modules\electron\dist\electron.exe"

if (-not (Test-Path -LiteralPath $pnpm -PathType Leaf)) { throw "pnpm path is invalid: $pnpm" }
Set-Location $root
if (-not (Test-Path -LiteralPath (Join-Path $root "dist-desktop\index.html") -PathType Leaf)) {
    & $pnpm desktop:build
    if ($LASTEXITCODE -ne 0) { throw "desktop build failed with exit code $LASTEXITCODE" }
}
if (-not (Test-Path -LiteralPath $electron -PathType Leaf)) { throw "Electron dependency is missing: $electron" }
& $electron (Join-Path $root "desktop\main.cjs")
exit $LASTEXITCODE
