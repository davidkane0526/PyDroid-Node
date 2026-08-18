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
    $configuredPython = [string]$env:PYDROID_PYTHON_EXECUTABLE
    if (-not (Test-Path -LiteralPath $configuredPython -PathType Leaf)) {
        throw "PYDROID_PYTHON_EXECUTABLE does not exist: $configuredPython"
    }
    & $configuredPython -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 13) else 1)" 2>$null
    if ($LASTEXITCODE -ne 0) {
        $detectedVersion = "unknown"
        try {
            $detectedVersion = (& $configuredPython -c "import sys; print('.'.join(map(str, sys.version_info[:3])))" 2>$null | Select-Object -Last 1).Trim()
        } catch {}
        throw "Android requires Python 3.13, but PYDROID_PYTHON_EXECUTABLE points to Python $detectedVersion`: $configuredPython"
    }
    Write-Host "Android buildPython: $configuredPython (Python 3.13)"
}
else {
    & py -3.13 -c "import sys; assert sys.version_info[:2] == (3, 13)"
    if ($LASTEXITCODE -ne 0) {
        throw "Python 3.13 not found. Set PYDROID_PYTHON_EXECUTABLE."
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
        # watching can hold handles on Chaquopy's pip staging dirs. Keep VFS watching off,
        # but leave the Gradle daemon enabled by default for faster and more stable local builds.
        .\gradlew.bat assembleDebug --no-watch-fs --daemon
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
