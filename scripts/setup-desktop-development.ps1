<#
.SYNOPSIS
Prepare the Windows desktop development environment on the deterministic 1.4.83 toolchain.
#>

[CmdletBinding()]
param(
    [string]$PnpmExecutable = $(if ($env:PYDROID_PNPM_EXECUTABLE) { $env:PYDROID_PNPM_EXECUTABLE } else { "D:\Code\NodeJs\pnpm.cmd" }),
    [string]$RuntimeRoot = $(if ($env:PYDROID_DESKTOP_PYTHON_RUNTIME) { $env:PYDROID_DESKTOP_PYTHON_RUNTIME } else { "D:\PyDroidTemp\tools\pydroid-flow\Python\runtime-3.13" }),
    [switch]$Start
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot

if (-not (Test-Path -LiteralPath $PnpmExecutable -PathType Leaf)) {
    throw "pnpm 不存在：$PnpmExecutable。请显式传入 -PnpmExecutable 或设置 PYDROID_PNPM_EXECUTABLE。"
}

Push-Location $projectRoot
try {
    & $PnpmExecutable install
    if ($LASTEXITCODE -ne 0) { throw "pnpm install 失败，退出码 $LASTEXITCODE。" }

    & (Join-Path $PSScriptRoot "setup-windows.ps1") -RuntimeRoot $RuntimeRoot
    if ($LASTEXITCODE -ne 0) { throw "Python Runtime 初始化失败，退出码 $LASTEXITCODE。" }

    Write-Host "桌面开发环境已完成。验证：$PnpmExecutable check" -ForegroundColor Green
    if ($Start) {
        & $PnpmExecutable desktop:dev
        if ($LASTEXITCODE -ne 0) { throw "desktop:dev 失败，退出码 $LASTEXITCODE。" }
    }
} finally {
    Pop-Location
}
