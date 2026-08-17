$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$variablesFile = Join-Path $projectRoot "android\variables.gradle"
$compileSdk = 36
if (Test-Path -LiteralPath $variablesFile) {
    $variablesText = Get-Content -LiteralPath $variablesFile -Raw
    $match = [regex]::Match($variablesText, 'compileSdkVersion\s*=\s*(\d+)')
    if ($match.Success) { $compileSdk = [int]$match.Groups[1].Value }
}
$projectJdk = Join-Path $projectRoot ".tools\jdk-21"
$jdkRoot = if ($env:JAVA_HOME) { $env:JAVA_HOME } else { $projectJdk }
$sdkRoot = if ($env:ANDROID_HOME) {
    $env:ANDROID_HOME
}
elseif ($env:ANDROID_SDK_ROOT) {
    $env:ANDROID_SDK_ROOT
}
else {
    Join-Path $env:LOCALAPPDATA "Android\Sdk"
}

if (-not (Test-Path (Join-Path $jdkRoot "bin\java.exe"))) {
    throw "JDK 21 not found at $jdkRoot. Set JAVA_HOME or extract it to .tools/jdk-21."
}

if (-not (Test-Path (Join-Path $sdkRoot ("platforms\android-{0}\android.jar" -f $compileSdk)))) {
    throw "Android SDK platform $compileSdk not found at $sdkRoot."
}

if ($env:PYDROID_PYTHON_EXECUTABLE) {
    if (-not (Test-Path $env:PYDROID_PYTHON_EXECUTABLE)) {
        throw "PYDROID_PYTHON_EXECUTABLE does not exist: $env:PYDROID_PYTHON_EXECUTABLE"
    }
}
else {
    & py -3.12 -c "import sys; assert sys.version_info[:2] == (3, 12)"
    if ($LASTEXITCODE -ne 0) {
        throw "Python 3.12 not found. Set PYDROID_PYTHON_EXECUTABLE."
    }
}

$env:JAVA_HOME = $jdkRoot
$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot

Push-Location $projectRoot
try {
    pnpm android:sync
    if ($LASTEXITCODE -ne 0) {
        throw "Capacitor Android sync failed."
    }

    Push-Location "android"
    try {
        # --no-watch-fs: with the local-storage junction layout (android/app/build ->
        # D:\PyDroidTemp\PyDroid\generated\android-app-build), Gradle 8's file-system
        # watching holds handles on Chaquopy's pip staging dirs, so its os.renames
        # fails with WinError 5 (Access denied). Disabling the VFS watcher fixes it.
        .\gradlew.bat assembleDebug --no-watch-fs --no-daemon
        if ($LASTEXITCODE -ne 0) {
            throw "Android debug APK build failed."
        }
    }
    finally {
        Pop-Location
    }

    $apk = Join-Path $projectRoot "android\app\build\outputs\apk\debug\app-debug.apk"
    Write-Host "Android debug APK: $apk"
}
finally {
    Pop-Location
}
