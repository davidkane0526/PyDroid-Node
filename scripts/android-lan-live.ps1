param(
    [int]$Port = 5173,
    [switch]$Install
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$address = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" -and $_.PrefixOrigin -ne "WellKnown" } |
    Sort-Object InterfaceMetric |
    Select-Object -First 1 -ExpandProperty IPAddress
if (-not $address) { throw "未找到可用于局域网的 IPv4 地址" }
$liveUrl = "http://${address}:$Port"

Push-Location $projectRoot
try {
    $env:CAPACITOR_LIVE_RELOAD_URL = $liveUrl
    pnpm build
    if ($LASTEXITCODE -ne 0) { throw "Web 构建失败" }
    pnpm exec cap copy android
    if ($LASTEXITCODE -ne 0) { throw "Android Live Reload 配置写入失败" }
    if ($Install) {
        Push-Location (Join-Path $projectRoot "android")
        try { .\gradlew.bat installDebug --no-daemon --console=plain; if ($LASTEXITCODE -ne 0) { throw "测试 APK 安装失败" } }
        finally { Pop-Location }
    }
    Write-Host "Android 局域网热更新地址：$liveUrl"
    Write-Host "首次或原生层变化后使用 -Install；之后保持此窗口运行，React/CSS/TypeScript 会通过 Vite HMR 即时推送。"
    Write-Host "请确保 Windows 防火墙允许该端口，并让手机与电脑连接同一局域网。"
    pnpm exec vite --host 0.0.0.0 --port $Port
}
finally {
    Pop-Location
}
