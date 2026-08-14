<#
.SYNOPSIS
在另一台 Windows 电脑上初始化 PyDroid Flow 桌面开发环境。

.DESCRIPTION
该脚本应从已同步完成的 OneDrive 项目根目录运行。依赖、缓存和 Python
便携运行时默认放到项目外的 D:\PyDroidTemp\PyDroid，避免占用 OneDrive
空间并避免同步 node_modules 或构建产物。

.EXAMPLE
powershell -ExecutionPolicy Bypass -File scripts/setup-desktop-development.ps1

.EXAMPLE
powershell -ExecutionPolicy Bypass -File scripts/setup-desktop-development.ps1 -LocalRoot E:\PyDroidTemp\PyDroid -Start
#>

[CmdletBinding()]
param(
    [string]$LocalRoot = "D:\PyDroidTemp\PyDroid",
    [switch]$Start
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    throw "未找到 pnpm。请先安装 Node.js 24 和 pnpm，并重新打开 PowerShell。"
}

$env:PYDROID_LOCAL_ROOT = $LocalRoot
Push-Location $projectRoot
try {
    & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "local-storage.ps1")
    if ($LASTEXITCODE -ne 0) { throw "本地存储目录初始化失败。" }

    & pnpm install
    if ($LASTEXITCODE -ne 0) { throw "pnpm 依赖安装失败。" }

    & pnpm env:windows
    if ($LASTEXITCODE -ne 0) { throw "Python 运行时初始化失败。" }

    Write-Host "桌面开发环境已完成。验证请运行：pnpm check" -ForegroundColor Green
    if ($Start) {
        & pnpm desktop:dev
        if ($LASTEXITCODE -ne 0) { throw "桌面开发服务启动失败。" }
    } else {
        Write-Host "启动桌面开发版：pnpm desktop:dev" -ForegroundColor Cyan
    }
} finally {
    Pop-Location
}
