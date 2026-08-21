<#
.SYNOPSIS
Prepare the Windows desktop development environment using local read-only tool discovery.
#>

[CmdletBinding()]
param(
    [string]$PnpmExecutable,
    [string]$RuntimeRoot = $(if ($env:PYDROID_DESKTOP_PYTHON_RUNTIME) { $env:PYDROID_DESKTOP_PYTHON_RUNTIME } else { "D:\PyDroidTemp\tools\pydroid-flow\Python\runtime-3.13" }),
    [switch]$Start
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$nodeModule = Join-Path $projectRoot "tools\modules\PyDroid.Build.Node.psm1"
Import-Module -Name $nodeModule -Force -DisableNameChecking

$package = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json
$requiredPnpm = if ([string]$package.packageManager -match '^pnpm@([^+]+)') { [string]$matches[1] } else { "11.21.0" }
$pnpm = PyDroid.Build.Node\Resolve-PyDroidPnpmExecutable -ConfiguredExecutable $PnpmExecutable -RequiredVersion $requiredPnpm
if (-not $pnpm) {
    throw "未找到 pnpm $requiredPnpm。请安装 pnpm，或显式传入 -PnpmExecutable。"
}

Push-Location $projectRoot
try {
    & $pnpm install
    if ($LASTEXITCODE -ne 0) { throw "pnpm install 失败，退出码 $LASTEXITCODE。" }

    & (Join-Path $PSScriptRoot "setup-windows.ps1") -RuntimeRoot $RuntimeRoot
    if ($LASTEXITCODE -ne 0) { throw "Python Runtime 初始化失败，退出码 $LASTEXITCODE。" }

    Write-Host "桌面开发环境已完成。验证：$pnpm check" -ForegroundColor Green
    if ($Start) {
        & $pnpm desktop:dev
        if ($LASTEXITCODE -ne 0) { throw "desktop:dev 失败，退出码 $LASTEXITCODE。" }
    }
} finally {
    Pop-Location
}
