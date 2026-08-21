# PyDroid Node/pnpm build-tool helpers. Windows PowerShell 5.1 compatible.
# Policy: explicit paths are strict overrides; otherwise discover already-installed local tools.
# Discovery never installs, downloads, mutates PATH persistently, or retries with a different tool after execution starts.

function Expand-PyDroidToolPath {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
    return [Environment]::ExpandEnvironmentVariables($Value.Trim().Trim('"'))
}

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
        [Parameter(Mandatory = $true)][string]$ToolRoot,
        [Parameter(Mandatory = $true)][string]$RequiredVersion
    )

    if (-not [string]::IsNullOrWhiteSpace($ConfiguredExecutable)) {
        $explicit = Expand-PyDroidToolPath $ConfiguredExecutable
        if (-not (Test-PyDroidNodeCandidate -Executable $explicit -RequiredVersion $RequiredVersion)) {
            throw "显式 Node 路径无效或版本不满足 $RequiredVersion：$explicit"
        }
        return $explicit
    }

    $candidates = New-Object System.Collections.Generic.List[string]
    if ($env:PYDROID_NODE_EXECUTABLE) { [void]$candidates.Add((Expand-PyDroidToolPath $env:PYDROID_NODE_EXECUTABLE)) }
    [void]$candidates.Add((Join-Path $ToolRoot 'NodeJs\node.exe'))
    [void]$candidates.Add((Join-Path $ToolRoot 'Language\NodeJs\node.exe'))
    if ($env:ProgramFiles) { [void]$candidates.Add((Join-Path $env:ProgramFiles 'nodejs\node.exe')) }

    foreach ($candidate in @($candidates | Where-Object { $_ } | Select-Object -Unique)) {
        if (Test-PyDroidNodeCandidate -Executable $candidate -RequiredVersion $RequiredVersion) { return $candidate }
    }

    foreach ($commandName in @('node.exe', 'node')) {
        foreach ($command in @(Get-Command $commandName -All -ErrorAction SilentlyContinue)) {
            if ($command.Source -and (Test-PyDroidNodeCandidate -Executable $command.Source -RequiredVersion $RequiredVersion)) {
                return [string]$command.Source
            }
        }
    }
    return $null
}


function Test-PyDroidPnpmCandidate {
    param(
        [Parameter(Mandatory = $true)][string]$Executable,
        [Parameter(Mandatory = $true)][string]$RequiredVersion
    )
    if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { return $false }
    try {
        $raw = [string]((& $Executable --version | Select-Object -Last 1)).Trim()
        return ($raw -eq $RequiredVersion)
    } catch { return $false }
}

function Resolve-PyDroidPnpmExecutable {
    param(
        [string]$ConfiguredExecutable,
        [Parameter(Mandatory = $true)][string]$RequiredVersion
    )

    if (-not [string]::IsNullOrWhiteSpace($ConfiguredExecutable)) {
        $explicit = Expand-PyDroidToolPath $ConfiguredExecutable
        if (-not (Test-PyDroidPnpmCandidate -Executable $explicit -RequiredVersion $RequiredVersion)) {
            throw "显式 pnpm 路径无效或版本不是 $RequiredVersion：$explicit"
        }
        return $explicit
    }

    $candidates = New-Object System.Collections.Generic.List[string]
    if ($env:PYDROID_PNPM_EXECUTABLE) { [void]$candidates.Add((Expand-PyDroidToolPath $env:PYDROID_PNPM_EXECUTABLE)) }
    if ($env:LOCALAPPDATA) { [void]$candidates.Add((Join-Path $env:LOCALAPPDATA 'pnpm\bin\pnpm.cmd')) }
    if ($env:APPDATA) { [void]$candidates.Add((Join-Path $env:APPDATA 'npm\pnpm.cmd')) }

    foreach ($candidate in @($candidates | Where-Object { $_ } | Select-Object -Unique)) {
        if (Test-PyDroidPnpmCandidate -Executable $candidate -RequiredVersion $RequiredVersion) { return $candidate }
    }

    foreach ($commandName in @('pnpm.cmd', 'pnpm')) {
        foreach ($command in @(Get-Command $commandName -All -ErrorAction SilentlyContinue)) {
            if ($command.Source -and (Test-PyDroidPnpmCandidate -Executable $command.Source -RequiredVersion $RequiredVersion)) {
                return [string]$command.Source
            }
        }
    }
    return $null
}

Export-ModuleMember -Function 'Test-PyDroidNodeCandidate', 'Test-PyDroidPnpmCandidate', 'Resolve-PyDroidNodeExecutable', 'Resolve-PyDroidPnpmExecutable'
