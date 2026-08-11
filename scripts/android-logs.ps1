$ErrorActionPreference = "Stop"
$sdkRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $env:LOCALAPPDATA "Android\Sdk" }
$adb = Join-Path $sdkRoot "platform-tools\adb.exe"
$packageName = "com.dk.pydroidflow"

if (-not (Test-Path $adb)) {
    throw "找不到 adb：$adb"
}

$processId = (& $adb shell pidof -s $packageName).Trim()
if (-not $processId) {
    throw "应用未运行：$packageName"
}

Write-Host "只显示 $packageName（PID $processId）的日志，Ctrl+C 退出"
& $adb logcat --pid=$processId "*:V"
