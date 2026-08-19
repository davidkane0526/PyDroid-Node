# PyDroid Python build-host helpers. Windows PowerShell 5.1 compatible.

function Test-PyDroidPythonSeries {
    param(
        [Parameter(Mandatory = $true)][string]$Executable,
        [Parameter(Mandatory = $true)][int]$Major,
        [Parameter(Mandatory = $true)][int]$Minor
    )
    if ([string]::IsNullOrWhiteSpace($Executable) -or -not (Test-Path -LiteralPath $Executable -PathType Leaf)) { return $false }
    try {
        & $Executable -c "import sys; raise SystemExit(0 if sys.version_info[:2] == ($Major, $Minor) else 1)" 2>$null | Out-Null
        return ($LASTEXITCODE -eq 0)
    } catch { return $false }
}

function Test-PyDroidPythonBuildHost {
    param(
        [Parameter(Mandatory = $true)][string]$Executable,
        [Parameter(Mandatory = $true)][int]$Major,
        [Parameter(Mandatory = $true)][int]$Minor
    )
    if (-not (Test-PyDroidPythonSeries -Executable $Executable -Major $Major -Minor $Minor)) { return $false }
    try {
        & $Executable -c "import struct, venv, ensurepip; raise SystemExit(0 if struct.calcsize('P') * 8 == 64 else 1)" 2>$null | Out-Null
        return ($LASTEXITCODE -eq 0)
    } catch { return $false }
}

function Get-PythonVersionLabel {
    param([string]$Executable)
    if ([string]::IsNullOrWhiteSpace($Executable) -or -not (Test-Path -LiteralPath $Executable -PathType Leaf)) { return "不可用" }
    try {
        $label = & $Executable -c "import sys; print('.'.join(map(str, sys.version_info[:3])))" 2>$null
        if ($LASTEXITCODE -eq 0 -and $label) { return ([string]($label | Select-Object -Last 1)).Trim() }
    } catch {}
    return "未知"
}

function Get-RegisteredPython313Candidates {
    $result = New-Object System.Collections.Generic.List[string]
    $roots = @(
        "HKCU:\Software\Python\PythonCore",
        "HKLM:\Software\Python\PythonCore",
        "HKLM:\Software\WOW6432Node\Python\PythonCore"
    )

    foreach ($root in $roots) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        try {
            foreach ($versionKey in @(Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue)) {
                if ($versionKey.PSChildName -notmatch '^3\.13(?:$|[-.])') { continue }
                $installPathKey = Join-Path $versionKey.PSPath "InstallPath"
                try {
                    $key = Get-Item -LiteralPath $installPathKey -ErrorAction Stop
                    $installDir = [string]$key.GetValue("")
                    if (-not [string]::IsNullOrWhiteSpace($installDir)) {
                        $candidate = Join-Path $installDir "python.exe"
                        if (-not $result.Contains($candidate)) { $result.Add($candidate) }
                    }
                    foreach ($valueName in @("ExecutablePath", "WindowedExecutablePath")) {
                        try {
                            $value = [string]$key.GetValue($valueName)
                            if (-not [string]::IsNullOrWhiteSpace($value) -and -not $result.Contains($value)) {
                                $result.Add($value)
                            }
                        } catch {}
                    }
                } catch {}
            }
        } catch {}
    }
    return @($result)
}

function Test-WindowsInstallerServiceAvailable {
    try {
        $service = Get-Service -Name "msiserver" -ErrorAction Stop
        if ($service.StartType -eq [System.ServiceProcess.ServiceStartMode]::Disabled) {
            return $false
        }
        if ($service.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Running) {
            try {
                Start-Service -Name "msiserver" -ErrorAction Stop
                $service.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Running, [TimeSpan]::FromSeconds(5))
            } catch {
                return $false
            }
        }
        $service.Refresh()
        return ($service.Status -eq [System.ServiceProcess.ServiceControllerStatus]::Running)
    } catch {
        return $false
    }
}

Export-ModuleMember -Function 'Test-PyDroidPythonSeries', 'Test-PyDroidPythonBuildHost', 'Get-PythonVersionLabel', 'Get-RegisteredPython313Candidates', 'Test-WindowsInstallerServiceAvailable'
