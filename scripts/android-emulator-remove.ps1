$ErrorActionPreference = "Stop"

$projectRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$toolsRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot ".tools"))
$sdkRoot = [System.IO.Path]::GetFullPath((Join-Path $toolsRoot "android-sdk"))
$avdHome = [System.IO.Path]::GetFullPath((Join-Path $toolsRoot "android-avd"))
$avdName = "pydroid_flow_api36_arm_translation"
$emulatorProcesses = Get-CimInstance Win32_Process | Where-Object {
    $_.Name -in @("emulator.exe", "qemu-system-x86_64.exe") -and
    $_.CommandLine -like "*$avdName*"
}
foreach ($emulatorProcess in $emulatorProcesses) {
    Stop-Process -Id $emulatorProcess.ProcessId -Force -ErrorAction SilentlyContinue
}
if ($emulatorProcesses) { Start-Sleep -Seconds 3 }

foreach ($target in @($avdHome, $sdkRoot)) {
    $expectedPrefix = $toolsRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
    if (-not $target.StartsWith($expectedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove path outside project .tools: $target"
    }
    if (Test-Path -LiteralPath $target) {
        Remove-Item -LiteralPath $target -Recurse -Force
        Write-Host "Removed: $target"
    }
}
