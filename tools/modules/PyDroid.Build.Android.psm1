# PyDroid Android build-tool helpers. Windows PowerShell 5.1 compatible.
# Deterministic policy: one selected SDK root only.

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

function Resolve-PyDroidAndroidSdk {
    param(
        [string]$ConfiguredSdk,
        [Parameter(Mandatory = $true)][string]$ToolRoot
    )
    if (-not [string]::IsNullOrWhiteSpace($ConfiguredSdk)) {
        return [Environment]::ExpandEnvironmentVariables($ConfiguredSdk.Trim().Trim('"'))
    }
    return (Join-Path $ToolRoot 'Android\Sdk')
}

Export-ModuleMember -Function 'Get-ProjectAndroidApiLevel', 'Resolve-PyDroidAndroidSdk'
