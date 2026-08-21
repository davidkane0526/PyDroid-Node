# PyDroid JDK helpers. Windows PowerShell 5.1 compatible.
# Deterministic policy: validate one selected JDK path only.

function Resolve-JavaHomeCandidate {
    param([string]$JavaHomePath)
    if ([string]::IsNullOrWhiteSpace($JavaHomePath)) { return $null }

    $candidate = [Environment]::ExpandEnvironmentVariables($JavaHomePath.Trim().Trim('"'))
    if ([string]::IsNullOrWhiteSpace($candidate)) { return $null }

    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
        $leaf = Split-Path $candidate -Leaf
        if ($leaf -match '^(java|javac)\.exe$') {
            $candidate = Split-Path (Split-Path $candidate -Parent) -Parent
        }
    } elseif ((Split-Path $candidate -Leaf) -ieq 'bin') {
        $candidate = Split-Path $candidate -Parent
    }

    try { return [IO.Path]::GetFullPath($candidate) } catch { return $candidate }
}

function Invoke-JavaVersionProbe {
    param(
        [Parameter(Mandatory = $true)][string]$ExecutablePath,
        [string]$Arguments = '-version'
    )

    if (-not (Test-Path -LiteralPath $ExecutablePath -PathType Leaf)) {
        throw "JDK 可执行文件不存在：$ExecutablePath"
    }

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $ExecutablePath
    $psi.Arguments = $Arguments
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $psi
    try {
        if (-not $process.Start()) { throw "无法启动：$ExecutablePath" }
        $stdout = $process.StandardOutput.ReadToEnd()
        $stderr = $process.StandardError.ReadToEnd()
        $process.WaitForExit()
        if ($process.ExitCode -ne 0) {
            throw "命令失败（退出码 $($process.ExitCode)）：$ExecutablePath $Arguments"
        }
        return [pscustomobject]@{ StdOut = [string]$stdout; StdErr = [string]$stderr }
    } finally {
        $process.Dispose()
    }
}

function Get-JavaMajorVersion {
    param([string]$JavaHomePath)

    $resolved = Resolve-JavaHomeCandidate $JavaHomePath
    if ([string]::IsNullOrWhiteSpace($resolved)) { return $null }

    $java = Join-Path $resolved 'bin\java.exe'
    $javac = Join-Path $resolved 'bin\javac.exe'
    if (-not (Test-Path -LiteralPath $java -PathType Leaf)) { return $null }
    if (-not (Test-Path -LiteralPath $javac -PathType Leaf)) { return $null }

    $probe = Invoke-JavaVersionProbe -ExecutablePath $java -Arguments '-version'
    $text = (([string]$probe.StdOut) + "`n" + ([string]$probe.StdErr)).Trim()
    foreach ($pattern in @(
        '(?im)^\s*(?:openjdk|java)\s+version\s+["'']?(?:(?:1)\.)?(\d+)',
        '(?im)\bversion\s+["'']?(?:(?:1)\.)?(\d+)'
    )) {
        $match = [regex]::Match($text, $pattern)
        if ($match.Success) { return [int]$match.Groups[1].Value }
    }
    return $null
}

Export-ModuleMember -Function 'Resolve-JavaHomeCandidate', 'Invoke-JavaVersionProbe', 'Get-JavaMajorVersion'
