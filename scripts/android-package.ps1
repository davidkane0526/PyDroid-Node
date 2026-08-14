$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
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

if (-not (Test-Path (Join-Path $sdkRoot "platforms\android-36\android.jar"))) {
    throw "Android SDK platform 36 not found at $sdkRoot."
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
        .\gradlew.bat assembleDebug
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
