$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$localRoot = if ($env:PYDROID_LOCAL_ROOT) { $env:PYDROID_LOCAL_ROOT } else { "D:\PyDroidTemp\PyDroid" }

$links = [ordered]@{
    ".tools\android-sdk" = "tools\android-sdk"
    ".tools\android-avd" = "tools\android-avd"
    ".tools\jdk-21" = "tools\jdk-21"
    ".tools\downloads" = "tools\downloads"
    ".tools\electron-cache" = "tools\electron-cache"
    ".tools\electron-builder-cache" = "tools\electron-builder-cache"
    ".tools\python312-runtime" = "tools\python312-runtime"
    "node_modules" = "dependencies\node_modules"
    "dist" = "generated\dist"
    "dist-desktop" = "generated\dist-desktop"
    "release" = "artifacts\release"
    "temp" = "cache\temp"
    ".pytest_cache" = "cache\pytest"
    "android\.gradle" = "cache\android-gradle"
    "android\app\build" = "generated\android-app-build"
    "android\build" = "generated\android-root-build"
    "android\capacitor-cordova-android-plugins\build" = "generated\capacitor-cordova-build"
}

foreach ($entry in $links.GetEnumerator()) {
    $link = Join-Path $projectRoot $entry.Key
    $target = Join-Path $localRoot $entry.Value
    if (-not (Test-Path -LiteralPath $target)) { continue }
    if (Test-Path -LiteralPath $link) {
        $item = Get-Item -LiteralPath $link -Force
        if ($item.LinkType -eq "Junction") { continue }
        Write-Warning "保留已有目录，未创建链接：$link"
        continue
    }
    New-Item -ItemType Directory -Path (Split-Path $link -Parent) -Force | Out-Null
    New-Item -ItemType Junction -Path $link -Target $target | Out-Null
    Write-Host "$link -> $target"
}

Write-Host "PyDroid 本地存储根目录：$localRoot"
