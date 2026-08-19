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

$script:androidStage = 82
function Write-AndroidStage {
    param([int]$Percent, [string]$Message)
    if ($Percent -lt $script:androidStage) { return }
    $script:androidStage = $Percent
    Write-Host ("@@PYDROID_STAGE@@|{0}|{1}" -f $Percent, $Message)
}

function Update-GradleProgressFromLine {
    param([string]$Line)
    if ([string]::IsNullOrWhiteSpace($Line)) { return }
    if ($Line -match 'Chaquopy|generate.*Python|pip install|buildPython|Python requirements') {
        Write-AndroidStage 85 "准备 Android Python / Chaquopy 依赖"
    }
    elseif ($Line -match '> Task :app:(compile|merge|process|check|javaPreCompile)|Kotlin|javac') {
        Write-AndroidStage 86 "编译 Android Java/Kotlin 与资源"
    }
    elseif ($Line -match '> Task :app:(dex|mergeExtDex|mergeLibDex|package|assemble)|D8|R8|APK') {
        Write-AndroidStage 87 "生成 DEX 并封装 Android APK"
    }
    elseif ($Line -match 'BUILD SUCCESSFUL') {
        Write-AndroidStage 87 "Gradle 已完成，正在确认 APK 与回收构建客户端"
    }
}

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

    # Gradle daemon processes may inherit stdout/stderr handles. If gradlew is placed
    # directly in a PowerShell pipeline, BUILD SUCCESSFUL can already be printed while
    # the pipeline still waits for EOF from the long-lived daemon, leaving the GUI at 82%.
    # Redirect inside a short-lived cmd file instead. PowerShell only tails the log file,
    # so daemon handles can never keep the parent build process alive.
    $gradlewPath = (Resolve-Path -LiteralPath ".\gradlew.bat").Path
    $quotedArgs = @($Arguments | ForEach-Object {
        '"' + ([string]$_).Replace('"', '""') + '"'
    })
    if ($quotedArgs -notcontains '"--stacktrace"') {
        $quotedArgs += '"--stacktrace"'
    }

    $runnerDir = Join-Path $projectRoot ".tools"
    New-Item -ItemType Directory -Force -Path $runnerDir | Out-Null
    $runnerPath = Join-Path $runnerDir "gradle-run-last.cmd"
    $runnerText = @(
        '@echo off',
        ('call "{0}" {1} > "{2}" 2>&1' -f $gradlewPath, ($quotedArgs -join ' '), $LogPath),
        'exit /b %ERRORLEVEL%'
    ) -join "`r`n"
    [System.IO.File]::WriteAllText($runnerPath, $runnerText, [System.Text.Encoding]::ASCII)

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $env:ComSpec
    $psi.Arguments = ('/d /s /c ""{0}""' -f $runnerPath)
    $psi.WorkingDirectory = (Get-Location).Path
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $psi
    if (-not $process.Start()) { throw "Unable to start Gradle command shell." }

    $seenLines = 0
    $startedAt = [DateTime]::UtcNow
    $lastHeartbeatAt = $startedAt
    $buildSuccessfulAt = $null
    $forcedSuccessfulExit = $false
    try {
        do {
            if (Test-Path -LiteralPath $LogPath -PathType Leaf) {
                $lines = @(Get-Content -LiteralPath $LogPath -ErrorAction SilentlyContinue)
                if ($lines.Count -gt $seenLines) {
                    for ($i = $seenLines; $i -lt $lines.Count; $i++) {
                        $line = [string]$lines[$i]
                        Write-Host $line
                        Update-GradleProgressFromLine -Line $line
                        if ($line -match 'BUILD SUCCESSFUL') { $buildSuccessfulAt = [DateTime]::UtcNow }
                    }
                    $seenLines = $lines.Count
                }
            }

            $now = [DateTime]::UtcNow
            if (-not $process.HasExited -and ($now - $lastHeartbeatAt).TotalSeconds -ge 20) {
                $elapsed = [Math]::Max(1, [int]($now - $startedAt).TotalSeconds)
                Write-AndroidStage $script:androidStage ("Android Gradle 仍在运行 · 已用时 {0}s（可在构建窗口点击取消）" -f $elapsed)
                $lastHeartbeatAt = $now
            }

            # A successful Gradle build has already produced the APK. On a small subset of
            # Windows machines cmd.exe can remain alive after gradlew has printed success.
            # Do not leave the GUI apparently frozen at 82% for minutes: after a grace period,
            # close only the short-lived wrapper and continue once the APK is confirmed.
            if (-not $process.HasExited -and $null -ne $buildSuccessfulAt -and ($now - $buildSuccessfulAt).TotalSeconds -ge 12) {
                $debugApk = Join-Path $projectRoot "android\app\build\outputs\apk\debug\app-debug.apk"
                if (Test-Path -LiteralPath $debugApk -PathType Leaf) {
                    Write-Warning "Gradle 已报告 BUILD SUCCESSFUL 且 APK 已生成，但命令包装进程仍未退出；结束包装进程并继续。"
                    try { $process.Kill(); [void]$process.WaitForExit(2000) } catch {}
                    $forcedSuccessfulExit = $true
                    break
                }
            }

            if (-not $process.HasExited) { Start-Sleep -Milliseconds 180 }
            try { $process.Refresh() } catch {}
        } while (-not $process.HasExited)

        # One final drain after cmd.exe exits. Do not wait for descendants: a Gradle
        # daemon is intentionally allowed to stay alive for subsequent builds.
        if (Test-Path -LiteralPath $LogPath -PathType Leaf) {
            $lines = @(Get-Content -LiteralPath $LogPath -ErrorAction SilentlyContinue)
            if ($lines.Count -gt $seenLines) {
                for ($i = $seenLines; $i -lt $lines.Count; $i++) {
                    $line = [string]$lines[$i]
                    Write-Host $line
                    Update-GradleProgressFromLine -Line $line
                }
            }
        }
        if ($forcedSuccessfulExit) { return 0 }
        return [int]$process.ExitCode
    }
    finally {
        try { $process.Dispose() } catch {}
        Remove-Item -LiteralPath $runnerPath -Force -ErrorAction SilentlyContinue
    }
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
    if (([string]$env:PYDROID_SKIP_ANDROID_SYNC) -eq "1") {
        Write-AndroidStage 84 "Capacitor 同步已由主构建器完成，启动 Gradle / Chaquopy 构建"
    } else {
        Write-AndroidStage 82 "同步 Web 资源与 Capacitor Android 工程"
        pnpm android:sync
        if ($LASTEXITCODE -ne 0) {
            throw "Capacitor Android sync failed."
        }
        Write-AndroidStage 84 "Capacitor 同步完成，启动 Gradle / Chaquopy 构建"
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
    if (-not (Test-Path -LiteralPath $apk -PathType Leaf)) { throw "Gradle returned success but Android debug APK was not found: $apk" }
    Write-AndroidStage 87 "Android APK 已生成，准备返回主构建流程"
    Write-Host ("@@PYDROID_ARTIFACT@@|android|{0}" -f ($apk -replace '[\r\n|]+', ' '))
    Write-Host "Android debug APK: $apk"
}
finally {
    Pop-Location
}
