$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$toolRoot = if ($env:DK_TOOL_ROOT) { [string]$env:DK_TOOL_ROOT } else { "D:\Code" }
$workRoot = if ($env:PYDROID_BUILD_HOME) { [string]$env:PYDROID_BUILD_HOME } else { "D:\PyDroidTemp" }
$variablesFile = Join-Path $projectRoot "android\variables.gradle"
if (-not (Test-Path -LiteralPath $variablesFile -PathType Leaf)) { throw "Android variables file not found: $variablesFile" }
$variablesText = Get-Content -LiteralPath $variablesFile -Raw
$match = [regex]::Match($variablesText, 'compileSdkVersion\s*=\s*(\d+)')
if (-not $match.Success) { throw "compileSdkVersion is missing from: $variablesFile" }
$compileSdk = [int]$match.Groups[1].Value

$moduleRoot = Join-Path $projectRoot "tools\modules"
Import-Module -Name (Join-Path $moduleRoot "PyDroid.Build.Java.psm1") -Force -DisableNameChecking
Import-Module -Name (Join-Path $moduleRoot "PyDroid.Build.Android.psm1") -Force -DisableNameChecking
Import-Module -Name (Join-Path $moduleRoot "PyDroid.Build.Python.psm1") -Force -DisableNameChecking

$jdkRoot = PyDroid.Build.Java\Resolve-PyDroidJavaHome -ConfiguredHome $env:PYDROID_JAVA_HOME -ToolRoot $toolRoot -RequiredMajor 21
if (-not $jdkRoot) { throw "JDK 21 was not found on this machine." }
$sdkRoot = PyDroid.Build.Android\Resolve-PyDroidAndroidSdk -ConfiguredSdk $env:PYDROID_ANDROID_SDK -ToolRoot $toolRoot -WorkRoot $workRoot -RequiredApi $compileSdk
if (-not $sdkRoot) { throw "Android SDK platform $compileSdk was not found on this machine." }
$python = PyDroid.Build.Python\Resolve-PyDroidPythonExecutable -ConfiguredExecutable $env:PYDROID_PYTHON_EXECUTABLE -WorkRoot $workRoot -ToolRoot $toolRoot -Major 3 -Minor 13
if (-not $python) { throw "Full Python 3.13 with venv/ensurepip was not found on this machine." }

$env:JAVA_HOME = $jdkRoot
$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
$env:PYDROID_PYTHON_EXECUTABLE = $python

Push-Location $projectRoot
try {
    if (([string]$env:PYDROID_SKIP_ANDROID_SYNC) -ne "1") {
        Write-Host "@@PYDROID_STAGE@@|82|同步 Web 资源与 Capacitor Android 工程"
        pnpm android:sync
        if ($LASTEXITCODE -ne 0) { throw "Capacitor Android sync failed with exit code $LASTEXITCODE." }
    }

    Write-Host "@@PYDROID_STAGE@@|84|启动 Android Gradle / Chaquopy 构建"
    Push-Location "android"
    try {
        $gradleArgs = @("assembleDebug", "--stacktrace", "--no-daemon", "--console=plain")
        & ".\gradlew.bat" @gradleArgs
        if ($LASTEXITCODE -ne 0) { throw "Android debug APK build failed with exit code $LASTEXITCODE." }
    }
    finally { Pop-Location }

    $apk = Join-Path $projectRoot "android\app\build\outputs\apk\debug\app-debug.apk"
    if (-not (Test-Path -LiteralPath $apk -PathType Leaf)) { throw "Gradle returned success but Android debug APK was not found: $apk" }
    Write-Host "@@PYDROID_STAGE@@|87|Android APK 已生成"
    Write-Host ("@@PYDROID_ARTIFACT@@|android|{0}" -f ($apk -replace '[\r\n|]+', ' '))
    Write-Host "Android debug APK: $apk"
}
finally { Pop-Location }
