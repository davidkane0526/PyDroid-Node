# PyDroid Python build-host helpers. Windows PowerShell 5.1 compatible.
# Deterministic policy: validate one explicitly selected Python executable.

function Test-PyDroidPythonSeries {
    param(
        [Parameter(Mandatory = $true)][string]$Executable,
        [Parameter(Mandatory = $true)][int]$Major,
        [Parameter(Mandatory = $true)][int]$Minor
    )
    if ([string]::IsNullOrWhiteSpace($Executable) -or -not (Test-Path -LiteralPath $Executable -PathType Leaf)) { return $false }
    & $Executable -c "import sys; raise SystemExit(0 if sys.version_info[:2] == ($Major, $Minor) else 1)" 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
}

function Test-PyDroidPythonBuildHost {
    param(
        [Parameter(Mandatory = $true)][string]$Executable,
        [Parameter(Mandatory = $true)][int]$Major,
        [Parameter(Mandatory = $true)][int]$Minor
    )
    if (-not (Test-PyDroidPythonSeries -Executable $Executable -Major $Major -Minor $Minor)) { return $false }
    & $Executable -c "import struct, venv, ensurepip; raise SystemExit(0 if struct.calcsize('P') * 8 == 64 else 1)" 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
}

function Get-PythonVersionLabel {
    param([string]$Executable)
    if ([string]::IsNullOrWhiteSpace($Executable) -or -not (Test-Path -LiteralPath $Executable -PathType Leaf)) { return '不可用' }
    $label = & $Executable -c "import sys; print('.'.join(map(str, sys.version_info[:3])))" 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $label) { return '未知' }
    return ([string]($label | Select-Object -Last 1)).Trim()
}

function Resolve-PyDroidPythonExecutable {
    param(
        [string]$ConfiguredExecutable,
        [Parameter(Mandatory = $true)][string]$ToolRoot
    )
    if (-not [string]::IsNullOrWhiteSpace($ConfiguredExecutable)) {
        return [Environment]::ExpandEnvironmentVariables($ConfiguredExecutable.Trim().Trim('"'))
    }
    return (Join-Path $ToolRoot 'Python\3.13\python.exe')
}

Export-ModuleMember -Function 'Test-PyDroidPythonSeries', 'Test-PyDroidPythonBuildHost', 'Get-PythonVersionLabel', 'Resolve-PyDroidPythonExecutable'
