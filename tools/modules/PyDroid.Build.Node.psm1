# PyDroid Node/pnpm build-tool helpers. Windows PowerShell 5.1 compatible.

function Test-PyDroidNodeCandidate {
    param(
        [Parameter(Mandatory = $true)][string]$Executable,
        [Parameter(Mandatory = $true)][string]$RequiredVersion
    )
    if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { return $false }
    try {
        $raw = [string]((& $Executable --version | Select-Object -Last 1)).Trim()
        $actual = New-Object System.Version($raw.TrimStart("v"))
        $required = New-Object System.Version(([string]$RequiredVersion).Trim().TrimStart("v"))
        return ($actual.Major -eq $required.Major -and $actual -ge $required)
    } catch {
        return $false
    }
}

function Find-PyDroidNode {
    param(
        [Parameter(Mandatory = $true)][string]$RequiredVersion,
        [Parameter(Mandatory = $true)][string]$ToolRoot,
        [Parameter(Mandatory = $true)][string]$WorkRoot
    )
    if ($env:PYDROID_NODE_EXECUTABLE -and (Test-Path -LiteralPath $env:PYDROID_NODE_EXECUTABLE)) {
        if (Test-PyDroidNodeCandidate -Executable $env:PYDROID_NODE_EXECUTABLE -RequiredVersion $RequiredVersion) {
            return (Split-Path $env:PYDROID_NODE_EXECUTABLE -Parent)
        }
        Write-Warning ("忽略 PYDROID_NODE_EXECUTABLE={0}：版本低于项目要求 Node {1}，或版本无法识别。" -f $env:PYDROID_NODE_EXECUTABLE, $RequiredVersion)
    }

    $candidates = @(
        (Join-Path $ToolRoot "NodeJs"),
        (Join-Path $ToolRoot "NodeJS"),
        (Join-Path $ToolRoot "Language\NodeJS"),
        (Join-Path $WorkRoot "tools\nodejs"),
        (Join-Path $WorkRoot "tools\node")
    )
    foreach ($candidate in $candidates) {
        $exe = Join-Path $candidate "node.exe"
        if (Test-PyDroidNodeCandidate -Executable $exe -RequiredVersion $RequiredVersion) { return $candidate }
        if (Test-Path -LiteralPath $exe -PathType Leaf) {
            try {
                $foundVersion = [string]((& $exe --version | Select-Object -Last 1)).Trim()
                Write-Warning ("跳过 Node {0}（{1}）：项目要求同一主版本且不低于 {2}。" -f $foundVersion, $exe, $RequiredVersion)
            } catch {}
        }
    }

    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source -and (Test-PyDroidNodeCandidate -Executable $cmd.Source -RequiredVersion $RequiredVersion)) {
        return (Split-Path $cmd.Source -Parent)
    }
    return $null
}

function Find-Pnpm {
    $cmd = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
    if (-not $cmd) { $cmd = Get-Command pnpm -ErrorAction SilentlyContinue }
    if ($cmd -and $cmd.Source) { return $cmd.Source }
    return $null
}

Export-ModuleMember -Function 'Test-PyDroidNodeCandidate', 'Find-PyDroidNode', 'Find-Pnpm'
