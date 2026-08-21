# Launch the unpacked PyDroid Flow desktop app using local read-only pnpm discovery.
[CmdletBinding()]
param([string]$PnpmExecutable)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Import-Module -Name (Join-Path $root "tools\modules\PyDroid.Build.Node.psm1") -Force -DisableNameChecking
$package = Get-Content -LiteralPath (Join-Path $root "package.json") -Raw | ConvertFrom-Json
$requiredPnpm = if ([string]$package.packageManager -match '^pnpm@([^+]+)') { [string]$matches[1] } else { "11.21.0" }
$pnpm = PyDroid.Build.Node\Resolve-PyDroidPnpmExecutable -ConfiguredExecutable $PnpmExecutable -RequiredVersion $requiredPnpm
$electron = Join-Path $root "node_modules\electron\dist\electron.exe"

if (-not $pnpm) { throw "pnpm $requiredPnpm was not found on this machine." }
Set-Location $root
if (-not (Test-Path -LiteralPath (Join-Path $root "dist-desktop\index.html") -PathType Leaf)) {
    & $pnpm desktop:build
    if ($LASTEXITCODE -ne 0) { throw "desktop build failed with exit code $LASTEXITCODE" }
}
if (-not (Test-Path -LiteralPath $electron -PathType Leaf)) { throw "Electron dependency is missing: $electron" }
& $electron (Join-Path $root "desktop\main.cjs")
exit $LASTEXITCODE
