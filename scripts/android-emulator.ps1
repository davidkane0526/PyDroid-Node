$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$sdkRoot = Join-Path $projectRoot ".tools\android-sdk"
$avdHome = Join-Path $projectRoot ".tools\android-avd"
$emulator = Join-Path $sdkRoot "emulator\emulator.exe"
$adb = Join-Path $sdkRoot "platform-tools\adb.exe"
$avdName = "pydroid_flow_api36_arm_translation"
$serial = "emulator-5556"

if (-not (Test-Path $emulator) -or -not (Test-Path $adb)) {
    throw "Project Android emulator is missing. See docs/environment.md."
}

$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
$env:ANDROID_AVD_HOME = $avdHome

$present = (& $adb devices) -match "^$serial\s+"
if (-not $present) {
    $arguments = @(
        "-avd", $avdName,
        "-port", "5556",
        "-no-snapshot",
        "-no-boot-anim",
        "-gpu", "auto",
        "-netdelay", "none",
        "-netspeed", "full"
    )
    Start-Process -FilePath $emulator -ArgumentList $arguments -WindowStyle Hidden
}

$deadline = (Get-Date).AddMinutes(3)
do {
    Start-Sleep -Seconds 3
    try {
        $booted = (& $adb -s $serial shell getprop sys.boot_completed 2>$null).Trim()
    }
    catch {
        $booted = ""
    }
} while ($booted -ne "1" -and (Get-Date) -lt $deadline)

if ($booted -ne "1") {
    throw "Android emulator did not finish booting within 3 minutes."
}

Write-Host "Android emulator ready: $serial ($avdName)"
