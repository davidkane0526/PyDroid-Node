# PyDroid Python build-host helpers. Windows PowerShell 5.1 compatible.
# Policy: explicit Python is a strict override; otherwise discover an already-installed full CPython.
# Discovery never installs Python and never substitutes the embeddable Desktop runtime for Android buildPython.

function Expand-PyDroidPythonPath {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
    return [Environment]::ExpandEnvironmentVariables($Value.Trim().Trim('"'))
}

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
        [Parameter(Mandatory = $true)][string]$WorkRoot,
        [Parameter(Mandatory = $true)][string]$ToolRoot,
        [Parameter(Mandatory = $true)][int]$Major,
        [Parameter(Mandatory = $true)][int]$Minor
    )

    if (-not [string]::IsNullOrWhiteSpace($ConfiguredExecutable)) {
        $explicit = Expand-PyDroidPythonPath $ConfiguredExecutable
        if (-not (Test-PyDroidPythonBuildHost -Executable $explicit -Major $Major -Minor $Minor)) {
            throw "显式 Python build host 无效：$explicit"
        }
        return $explicit
    }

    $series = "{0}.{1}" -f $Major, $Minor
    $candidates = New-Object System.Collections.Generic.List[string]
    if ($env:PYDROID_PYTHON_EXECUTABLE) { [void]$candidates.Add((Expand-PyDroidPythonPath $env:PYDROID_PYTHON_EXECUTABLE)) }
    [void]$candidates.Add((Join-Path $WorkRoot ("tools\pydroid-flow\Python\{0}\python.exe" -f $series)))
    [void]$candidates.Add((Join-Path $ToolRoot ("Python\{0}\python.exe" -f $series)))
    [void]$candidates.Add((Join-Path $ToolRoot 'Python\python.exe'))
    [void]$candidates.Add((Join-Path $ToolRoot 'Language\Python\python.exe'))
    if ($env:LOCALAPPDATA) {
        [void]$candidates.Add((Join-Path $env:LOCALAPPDATA ("Programs\Python\Python{0}{1}\python.exe" -f $Major, $Minor)))
    }

    foreach ($candidate in @($candidates | Where-Object { $_ } | Select-Object -Unique)) {
        if (Test-PyDroidPythonBuildHost -Executable $candidate -Major $Major -Minor $Minor) { return [string]$candidate }
    }

    try {
        $py = Get-Command py.exe -ErrorAction SilentlyContinue
        if ($py) {
            $resolved = & $py.Source ("-{0}" -f $series) -c "import sys; print(sys.executable)" 2>$null
            if ($LASTEXITCODE -eq 0 -and $resolved) {
                $candidate = ([string]($resolved | Select-Object -Last 1)).Trim()
                if (Test-PyDroidPythonBuildHost -Executable $candidate -Major $Major -Minor $Minor) { return $candidate }
            }
        }
    } catch {}

    $command = Get-Command python.exe -ErrorAction SilentlyContinue
    if (-not $command) { $command = Get-Command python -ErrorAction SilentlyContinue }
    if ($command -and (Test-PyDroidPythonBuildHost -Executable $command.Source -Major $Major -Minor $Minor)) {
        return [string]$command.Source
    }
    return $null
}

Export-ModuleMember -Function 'Test-PyDroidPythonSeries', 'Test-PyDroidPythonBuildHost', 'Get-PythonVersionLabel', 'Resolve-PyDroidPythonExecutable'
