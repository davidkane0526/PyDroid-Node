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
    & $configuredPython -c "import venv, ensurepip" 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Android buildPython must be a full Python 3.13 installation with the venv module. The embeddable/portable desktop Python cannot be used: $configuredPython"
    }
    Write-Host "Android buildPython: $configuredPython (Python 3.13, venv available)"
}
else {
    & py -3.13 -c "import sys, venv, ensurepip; assert sys.version_info[:2] == (3, 13)"
    if ($LASTEXITCODE -ne 0) {
        throw "Full Python 3.13 with venv was not found. Set PYDROID_PYTHON_EXECUTABLE."
    }
}

$env:JAVA_HOME = $jdkRoot
$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
$disableGradleDaemon = ([string]$env:PYDROID_DISABLE_GRADLE_DAEMON) -eq "1"

function Invoke-GradleLogged {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,
        [Parameter(Mandatory = $true)]
        [string]$LogPath
    )

    if (Test-Path -LiteralPath $LogPath) {
        Remove-Item -LiteralPath $LogPath -Force -ErrorAction SilentlyContinue
    }

    & .\gradlew.bat @Arguments 2>&1 | Tee-Object -FilePath $LogPath | Out-Host
    return [int]$LASTEXITCODE
}

function Test-GradleDaemonStartFailure {
    param([string]$LogPath)
    if (-not (Test-Path -LiteralPath $LogPath -PathType Leaf)) { return $false }
    $text = Get-Content -LiteralPath $LogPath -Raw -ErrorAction SilentlyContinue
    if ([string]::IsNullOrWhiteSpace($text)) { return $false }
    return ($text -match "A problem occurred starting process 'Gradle build daemon'" -or
            $text -match 'Unable to start the daemon process' -or
            $text -match 'Could not start daemon process')
}

function Stop-PyDroidGradleDaemon {
    Write-Host "Stopping PyDroid Gradle daemons before recovery..." -ForegroundColor DarkYellow
    try {
        & .\gradlew.bat --stop 2>&1 | Out-Host
    } catch {
        Write-Warning "gradlew --stop failed during recovery: $($_.Exception.Message)"
    }
    Start-Sleep -Milliseconds 500
}

function Clear-PyDroidGradleDaemonState {
    if ([string]::IsNullOrWhiteSpace([string]$env:GRADLE_USER_HOME)) { return }
    $daemonState = Join-Path $env:GRADLE_USER_HOME "daemon"
    if (Test-Path -LiteralPath $daemonState -PathType Container) {
        try {
            Remove-Item -LiteralPath $daemonState -Recurse -Force -ErrorAction Stop
            Write-Host "Cleared stale PyDroid Gradle daemon registry/log state: $daemonState" -ForegroundColor DarkYellow
        } catch {
            Write-Warning "Unable to clear stale Gradle daemon state: $($_.Exception.Message)"
        }
    }
}

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
        # watching can hold handles on Chaquopy's pip staging dirs.
        $gradleLog = Join-Path $projectRoot ".tools\gradle-assemble-last.log"
        New-Item -ItemType Directory -Force -Path (Split-Path $gradleLog -Parent) | Out-Null

        if ($disableGradleDaemon) {
            Write-Host "Gradle mode: --no-daemon" -ForegroundColor DarkYellow
            $exitCode = Invoke-GradleLogged -Arguments @("assembleDebug", "--no-watch-fs", "--no-daemon") -LogPath $gradleLog
        }
        else {
            Write-Host "Gradle mode: --daemon (automatic recovery enabled)" -ForegroundColor DarkGreen
            $exitCode = Invoke-GradleLogged -Arguments @("assembleDebug", "--no-watch-fs", "--daemon") -LogPath $gradleLog

            if ($exitCode -ne 0 -and (Test-GradleDaemonStartFailure -LogPath $gradleLog)) {
                Write-Warning "Gradle daemon failed to start. Cleaning PyDroid daemon state and retrying once."
                Stop-PyDroidGradleDaemon
                Clear-PyDroidGradleDaemonState
                $exitCode = Invoke-GradleLogged -Arguments @("assembleDebug", "--no-watch-fs", "--daemon") -LogPath $gradleLog

                if ($exitCode -ne 0 -and (Test-GradleDaemonStartFailure -LogPath $gradleLog)) {
                    Write-Warning "Gradle daemon still cannot start. Falling back to --no-daemon for this build."
                    Stop-PyDroidGradleDaemon
                    $exitCode = Invoke-GradleLogged -Arguments @("assembleDebug", "--no-watch-fs", "--no-daemon") -LogPath $gradleLog
                }
            }
        }

        if ($exitCode -ne 0) {
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
