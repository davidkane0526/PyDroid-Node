# PyDroid JDK helpers. Windows PowerShell 5.1 compatible.
# Policy: explicit Java is a strict override; otherwise discover already-installed JDKs read-only.
# Discovery never installs/downloads Java and never mutates machine configuration.

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

function Test-PyDroidJavaHome {
    param([string]$JavaHomePath, [Parameter(Mandatory = $true)][int]$RequiredMajor)
    $major = Get-JavaMajorVersion $JavaHomePath
    return ($null -ne $major -and $major -eq $RequiredMajor)
}

function Find-PyDroidJavaHomeInRoot {
    param(
        [string]$RootPath,
        [Parameter(Mandatory = $true)][int]$RequiredMajor,
        [int]$MaxDepth = 2
    )
    $root = Resolve-JavaHomeCandidate $RootPath
    if ([string]::IsNullOrWhiteSpace($root) -or -not (Test-Path -LiteralPath $root -PathType Container)) { return $null }
    if (Test-PyDroidJavaHome -JavaHomePath $root -RequiredMajor $RequiredMajor) { return $root }
    if ($MaxDepth -le 0) { return $null }

    $queue = New-Object System.Collections.Generic.Queue[object]
    $queue.Enqueue([pscustomobject]@{ Path = $root; Depth = 0 })
    while ($queue.Count -gt 0) {
        $item = $queue.Dequeue()
        if ($item.Depth -ge $MaxDepth) { continue }
        foreach ($dir in @(Get-ChildItem -LiteralPath $item.Path -Directory -ErrorAction SilentlyContinue | Sort-Object Name)) {
            if (Test-PyDroidJavaHome -JavaHomePath $dir.FullName -RequiredMajor $RequiredMajor) { return $dir.FullName }
            $queue.Enqueue([pscustomobject]@{ Path = $dir.FullName; Depth = ($item.Depth + 1) })
        }
    }
    return $null
}

function Get-PyDroidJavaHomesFromRegistry {
    $results = New-Object System.Collections.Generic.List[string]
    foreach ($keyPath in @(
        'HKLM:\SOFTWARE\JavaSoft\JDK',
        'HKLM:\SOFTWARE\WOW6432Node\JavaSoft\JDK',
        'HKCU:\SOFTWARE\JavaSoft\JDK'
    )) {
        if (-not (Test-Path -LiteralPath $keyPath)) { continue }
        foreach ($key in @(Get-ChildItem -LiteralPath $keyPath -ErrorAction SilentlyContinue | Sort-Object PSChildName)) {
            try {
                $home = (Get-ItemProperty -LiteralPath $key.PSPath -Name JavaHome -ErrorAction Stop).JavaHome
                if ($home) { [void]$results.Add([string]$home) }
            } catch {}
        }
    }
    return @($results | Select-Object -Unique)
}

function Resolve-PyDroidJavaHome {
    param(
        [string]$ConfiguredHome,
        [Parameter(Mandatory = $true)][string]$ToolRoot,
        [Parameter(Mandatory = $true)][int]$RequiredMajor
    )

    if (-not [string]::IsNullOrWhiteSpace($ConfiguredHome)) {
        $explicit = Find-PyDroidJavaHomeInRoot -RootPath $ConfiguredHome -RequiredMajor $RequiredMajor -MaxDepth 2
        if (-not $explicit) { throw "显式 JDK 路径未找到 JDK $RequiredMajor：$ConfiguredHome" }
        return $explicit
    }

    $roots = New-Object System.Collections.Generic.List[string]
    foreach ($value in @($env:PYDROID_JAVA_HOME, $env:JAVA_HOME)) {
        if ($value) { [void]$roots.Add([string]$value) }
    }
    foreach ($path in @(
        (Join-Path $ToolRoot 'Java'),
        (Join-Path $ToolRoot 'Language\Java'),
        (Join-Path $ToolRoot 'JDK'),
        (Join-Path $ToolRoot ("jdk-{0}" -f $RequiredMajor))
    )) { [void]$roots.Add($path) }
    if ($env:ProgramFiles) {
        [void]$roots.Add((Join-Path $env:ProgramFiles 'Java'))
        [void]$roots.Add((Join-Path $env:ProgramFiles 'Microsoft'))
        [void]$roots.Add((Join-Path $env:ProgramFiles 'Eclipse Adoptium'))
    }

    foreach ($root in @($roots | Where-Object { $_ } | Select-Object -Unique)) {
        $resolved = Find-PyDroidJavaHomeInRoot -RootPath $root -RequiredMajor $RequiredMajor -MaxDepth 2
        if ($resolved) { return $resolved }
    }

    foreach ($candidate in @(Get-PyDroidJavaHomesFromRegistry)) {
        $resolved = Find-PyDroidJavaHomeInRoot -RootPath $candidate -RequiredMajor $RequiredMajor -MaxDepth 1
        if ($resolved) { return $resolved }
    }

    foreach ($commandName in @('javac.exe', 'java.exe')) {
        foreach ($command in @(Get-Command $commandName -All -ErrorAction SilentlyContinue)) {
            if (-not $command.Source) { continue }
            $resolved = Find-PyDroidJavaHomeInRoot -RootPath $command.Source -RequiredMajor $RequiredMajor -MaxDepth 0
            if ($resolved) { return $resolved }
        }
    }
    return $null
}

Export-ModuleMember -Function 'Resolve-JavaHomeCandidate', 'Invoke-JavaVersionProbe', 'Get-JavaMajorVersion', 'Test-PyDroidJavaHome', 'Find-PyDroidJavaHomeInRoot', 'Resolve-PyDroidJavaHome'
