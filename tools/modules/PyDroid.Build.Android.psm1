# PyDroid Phase 7 build-tool module. Windows PowerShell 5.1 compatible.

function Get-ProjectAndroidApiLevel {
    param([string]$Root, [int]$Override)
    if ($Override -gt 0) { return $Override }
    $variables = Join-Path $Root "android\variables.gradle"
    if (Test-Path -LiteralPath $variables) {
        $text = Get-Content -LiteralPath $variables -Raw
        $m = [regex]::Match($text, 'compileSdkVersion\s*=\s*(\d+)')
        if ($m.Success) { return [int]$m.Groups[1].Value }
    }
    return 36
}

function Add-AndroidSdkOverlayDirectory {
    param(
        [string]$Source,
        [string]$Destination
    )
    if (-not (Test-Path -LiteralPath $Source -PathType Container)) { return }
    if (Test-Path -LiteralPath $Destination) { return }
    New-Item -ItemType Directory -Force -Path (Split-Path $Destination -Parent) | Out-Null
    try {
        New-Item -ItemType Junction -Path $Destination -Target $Source | Out-Null
    } catch {
        # Junction creation should normally work on local NTFS volumes. Fall back to copying
        # only inside WorkRoot, never into the read-only shared ToolRoot.
        Copy-Item -LiteralPath $Source -Destination $Destination -Recurse -Force
    }
}

function Find-PyDroidAndroidSdk {
    param(
        [Parameter(Mandatory = $true)][string]$ToolRoot,
        [Parameter(Mandatory = $true)][string]$WorkRoot,
        [Parameter(Mandatory = $true)][string]$PrivateToolsRoot,
        [Parameter(Mandatory = $true)][int]$ApiLevel
    )
    $candidates = @()
    if ($env:ANDROID_HOME) { $candidates += $env:ANDROID_HOME }
    if ($env:ANDROID_SDK_ROOT) { $candidates += $env:ANDROID_SDK_ROOT }
    $candidates += (Join-Path $ToolRoot "Android\Sdk")
    $candidates += (Join-Path $ToolRoot "Android")
    $candidates += (Join-Path $ToolRoot "android-sdk")
    if ($env:LOCALAPPDATA) { $candidates += (Join-Path $env:LOCALAPPDATA "Android\Sdk") }
    $candidates += @(
        (Join-Path $PrivateToolsRoot "Android\Sdk"),
        (Join-Path $WorkRoot "tools\android-sdk"),
        (Join-Path $WorkRoot "PyDroid\tools\android-sdk")
    )
    foreach ($candidate in $candidates) {
        if (-not $candidate) { continue }
        if (Test-Path (Join-Path $candidate "platforms\android-$ApiLevel\android.jar")) { return $candidate }
    }
    foreach ($candidate in $candidates) {
        if (-not $candidate) { continue }
        if (Test-Path (Join-Path $candidate "cmdline-tools")) { return $candidate }
        if (Test-Path (Join-Path $candidate "platform-tools\adb.exe")) { return $candidate }
    }
    return $null
}

Export-ModuleMember -Function 'Get-ProjectAndroidApiLevel', 'Add-AndroidSdkOverlayDirectory', 'Find-PyDroidAndroidSdk'
