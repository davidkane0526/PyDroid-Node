param(
    [int]$Port = 5173
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$sdkRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $env:LOCALAPPDATA "Android\Sdk" }
$adb = Join-Path $sdkRoot "platform-tools\adb.exe"

if (-not (Test-Path $adb)) {
    throw "找不到 adb：$adb"
}

$device = & $adb devices | Select-String "\sdevice$" | Select-Object -First 1
if (-not $device) {
    throw "没有已连接的 Android 调试设备"
}

& $adb reverse "tcp:$Port" "tcp:$Port"
if ($LASTEXITCODE -ne 0) {
    throw "adb reverse 配置失败"
}

$env:CAPACITOR_LIVE_RELOAD_URL = "http://localhost:$Port"
Push-Location $projectRoot
try {
    pnpm exec cap copy android
    Write-Host "已启用 Android 热更新：http://localhost:$Port"
    Write-Host "保持本窗口运行；首次需从 Android Studio 启动一次应用。"
    pnpm exec vite --host 0.0.0.0 --port $Port
}
finally {
    Pop-Location
}
