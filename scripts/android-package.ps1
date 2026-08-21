$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$toolRoot = if ($env:DK_TOOL_ROOT) { [string]$env:DK_TOOL_ROOT } else { "D:\Code" }
$variablesFile = Join-Path $projectRoot "android\variables.gradle"
if (-not (Test-Path -LiteralPath $variablesFile -PathType Leaf)) { throw "Android variables file not found: $variablesFile" }
$variablesText = Get-Content -LiteralPath $variablesFile -Raw
$match = [regex]::Match($variablesText, 'compileSdkVersion\s*=\s*(\d+)')
if (-not $match.Success) { throw "compileSdkVersion is missing from: $variablesFile" }
$compileSdk = [int]$match.Groups[1].Value

$jdkRoot = if ($env:PYDROID_JAVA_HOME) { [string]$env:PYDROID_JAVA_HOME } elseif ($env:JAVA_HOME) { [string]$env:JAVA_HOME } else { Join-Path $toolRoot "Language\Java" }
$sdkRoot = if ($env:PYDROID_ANDROID_SDK) { [string]$env:PYDROID_ANDROID_SDK } elseif ($env:ANDROID_HOME) { [string]$env:ANDROID_HOME } else { Join-Path $toolRoot "Android\Sdk" }
$python = if ($env:PYDROID_PYTHON_EXECUTABLE) { [string]$env:PYDROID_PYTHON_EXECUTABLE } else { Join-Path $toolRoot "Python\3.13\python.exe" }

$java = Join-Path $jdkRoot "bin\java.exe"
$javac = Join-Path $jdkRoot "bin\javac.exe"
if (-not (Test-Path -LiteralPath $java -PathType Leaf) -or -not (Test-Path -LiteralPath $javac -PathType Leaf)) {
    throw "JDK 21 path is invalid: $jdkRoot"
}
$javaVersion = (& $java -version 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0 -or $javaVersion -notmatch '(?:version\s+"|openjdk\s+)(?:1\.)?21(?:[\."\s])') {
    throw "Android requires JDK 21: $jdkRoot"
}

$platformJar = Join-Path $sdkRoot ("platforms\android-{0}\android.jar" -f $compileSdk)
if (-not (Test-Path -LiteralPath $platformJar -PathType Leaf)) { throw "Android SDK platform $compileSdk not found at $sdkRoot" }

if (-not (Test-Path -LiteralPath $python -PathType Leaf)) { throw "Python 3.13 path is invalid: $python" }
& $python -c "import sys, venv, ensurepip; raise SystemExit(0 if sys.version_info[:2] == (3, 13) else 1)" 2>$null
if ($LASTEXITCODE -ne 0) { throw "Android buildPython must be a full Python 3.13 installation with venv/ensurepip: $python" }

$env:JAVA_HOME = $jdkRoot
$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
$env:PYDROID_PYTHON_EXECUTABLE = $python
$disableGradleDaemon = ([string]$env:PYDROID_DISABLE_GRADLE_DAEMON) -eq "1"

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
        $gradleArgs = @("assembleDebug", "--stacktrace")
        if ($disableGradleDaemon) { $gradleArgs += "--no-daemon" } else { $gradleArgs += "--daemon" }
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
