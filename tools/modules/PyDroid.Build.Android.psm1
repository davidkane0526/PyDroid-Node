# PyDroid Android build-tool helpers. Windows PowerShell 5.1 compatible.
# Policy: explicit SDK is a strict override; otherwise discover an already-installed complete SDK.
# Discovery is read-only: it never downloads packages, creates overlays, or mutates an SDK.

function Get-ProjectAndroidApiLevel {
    param([string]$Root, [int]$Override)
    if ($Override -gt 0) { return $Override }
    $variables = Join-Path $Root 'android\variables.gradle'
    if (-not (Test-Path -LiteralPath $variables -PathType Leaf)) {
        throw "缺少 Android variables.gradle：$variables"
    }
    $text = Get-Content -LiteralPath $variables -Raw
    $match = [regex]::Match($text, 'compileSdkVersion\s*=\s*(\d+)')
    if (-not $match.Success) { throw "无法从 $variables 读取 compileSdkVersion。" }
    return [int]$match.Groups[1].Value
}

function Expand-PyDroidAndroidSdkPath {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
    try { return [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($Value.Trim().Trim('"'))) }
    catch { return [Environment]::ExpandEnvironmentVariables($Value.Trim().Trim('"')) }
}

function Test-PyDroidAndroidSdkCandidate {
    param(
        [string]$SdkRoot,
        [Parameter(Mandatory = $true)][int]$RequiredApi
    )
    if ([string]::IsNullOrWhiteSpace($SdkRoot) -or -not (Test-Path -LiteralPath $SdkRoot -PathType Container)) { return $false }
    return (Test-Path -LiteralPath (Join-Path $SdkRoot ("platforms\android-{0}\android.jar" -f $RequiredApi)) -PathType Leaf)
}

function Resolve-PyDroidAndroidSdk {
    param(
        [string]$ConfiguredSdk,
        [Parameter(Mandatory = $true)][string]$ToolRoot,
        [Parameter(Mandatory = $true)][string]$WorkRoot,
        [Parameter(Mandatory = $true)][int]$RequiredApi
    )

    if (-not [string]::IsNullOrWhiteSpace($ConfiguredSdk)) {
        $explicit = Expand-PyDroidAndroidSdkPath $ConfiguredSdk
        if (-not (Test-PyDroidAndroidSdkCandidate -SdkRoot $explicit -RequiredApi $RequiredApi)) {
            throw "显式 Android SDK 无效或缺少 android-$RequiredApi：$explicit"
        }
        return $explicit
    }

    $candidates = New-Object System.Collections.Generic.List[string]
    foreach ($value in @($env:PYDROID_ANDROID_SDK, $env:ANDROID_HOME, $env:ANDROID_SDK_ROOT)) {
        if ($value) { [void]$candidates.Add((Expand-PyDroidAndroidSdkPath $value)) }
    }
    if ($env:LOCALAPPDATA) { [void]$candidates.Add((Join-Path $env:LOCALAPPDATA 'Android\Sdk')) }
    [void]$candidates.Add((Join-Path $ToolRoot 'Language\Android'))
    [void]$candidates.Add((Join-Path $ToolRoot 'Android\Sdk'))
    [void]$candidates.Add((Join-Path $ToolRoot 'Android'))
    [void]$candidates.Add((Join-Path $ToolRoot 'android-sdk'))
    [void]$candidates.Add((Join-Path $WorkRoot 'tools\pydroid-flow\Android\Sdk'))
    [void]$candidates.Add((Join-Path $WorkRoot 'tools\android-sdk'))

    foreach ($candidate in @($candidates | Where-Object { $_ } | Select-Object -Unique)) {
        if (Test-PyDroidAndroidSdkCandidate -SdkRoot $candidate -RequiredApi $RequiredApi) {
            return [string]$candidate
        }
    }
    return $null
}

Export-ModuleMember -Function 'Get-ProjectAndroidApiLevel', 'Test-PyDroidAndroidSdkCandidate', 'Resolve-PyDroidAndroidSdk'
