# 启动未打包的桌面端 PyDroid Flow（复用 dist-desktop 与本地 Python 运行时）
# 用法：powershell -ExecutionPolicy Bypass -File scripts/start-desktop.ps1
# 说明：本机 node_modules/electron 因 junction 布局缺 cli.js，pnpm desktop 命令不可用；
#       这里直接用 electron.exe 启动 desktop/main.cjs，功能等价。
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# 优先使用环境已声明的 Node；否则使用环境台账记录的便携运行时
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  $portableNode = "D:\PyDroidTemp\PyDroid\tools\node-v24.14.0-win-x64"
  if (Test-Path (Join-Path $portableNode "node.exe")) { $env:PATH = "$portableNode;$env:PATH" }
  else { throw "找不到 Node.js：请先运行 pnpm env:windows 或设置 PYDROID_PYTHON_EXECUTABLE 对应的构建环境" }
}

if (-not (Test-Path "dist-desktop\index.html")) {
  Write-Host "未找到 dist-desktop，先执行桌面构建…"
  pnpm desktop:build
  if ($LASTEXITCODE -ne 0) { throw "桌面构建失败" }
}

& "node_modules\electron\dist\electron.exe" "desktop\main.cjs"
exit $LASTEXITCODE
