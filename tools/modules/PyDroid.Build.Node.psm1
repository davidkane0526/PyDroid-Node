# PyDroid Node/pnpm build-tool helpers. Windows PowerShell 5.1 compatible.
# Deterministic policy: validate explicit executable paths only.

function Test-PyDroidNodeCandidate {
    param(
        [Parameter(Mandatory = $true)][string]$Executable,
        [Parameter(Mandatory = $true)][string]$RequiredVersion
    )
    if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { return $false }
    try {
        $raw = [string]((& $Executable --version | Select-Object -Last 1)).Trim()
        $actual = New-Object System.Version($raw.TrimStart('v'))
        $required = New-Object System.Version(([string]$RequiredVersion).Trim().TrimStart('v'))
        return ($actual.Major -eq $required.Major -and $actual -ge $required)
    } catch { return $false }
}

function Resolve-PyDroidNodeExecutable {
    param(
        [string]$ConfiguredExecutable,
        [Parameter(Mandatory = $true)][string]$ToolRoot
    )
    if (-not [string]::IsNullOrWhiteSpace($ConfiguredExecutable)) {
        return [Environment]::ExpandEnvironmentVariables($ConfiguredExecutable.Trim().Trim('"'))
    }
    return (Join-Path $ToolRoot 'NodeJs\node.exe')
}

function Resolve-PyDroidPnpmExecutable {
    param(
        [string]$ConfiguredExecutable,
        [Parameter(Mandatory = $true)][string]$NodeExecutable
    )
    if (-not [string]::IsNullOrWhiteSpace($ConfiguredExecutable)) {
        return [Environment]::ExpandEnvironmentVariables($ConfiguredExecutable.Trim().Trim('"'))
    }
    return (Join-Path (Split-Path $NodeExecutable -Parent) 'pnpm.cmd')
}

Export-ModuleMember -Function 'Test-PyDroidNodeCandidate', 'Resolve-PyDroidNodeExecutable', 'Resolve-PyDroidPnpmExecutable'
