# PyDroid Phase 7 build-tool module. Windows PowerShell 5.1 compatible.

function Resolve-JavaHomeCandidate {
    param([string]$JavaHomePath)
    if ([string]::IsNullOrWhiteSpace($JavaHomePath)) { return $null }

    $candidate = [Environment]::ExpandEnvironmentVariables($JavaHomePath.Trim().Trim('"'))
    if ([string]::IsNullOrWhiteSpace($candidate)) { return $null }

    # 允许传入：
    #   1) 真正的 JAVA_HOME，例如 D:\Code\Language\Java
    #   2) JDK 的 bin 目录，例如 D:\Code\Language\Java\bin
    #   3) java.exe / javac.exe 的完整路径。
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
        $leaf = Split-Path $candidate -Leaf
        if ($leaf -match '^(java|javac)\.exe$') {
            $candidate = Split-Path (Split-Path $candidate -Parent) -Parent
        }
    } elseif ((Split-Path $candidate -Leaf) -ieq 'bin') {
        $javaInBin = Join-Path $candidate 'java.exe'
        $javacInBin = Join-Path $candidate 'javac.exe'
        if ((Test-Path -LiteralPath $javaInBin -PathType Leaf) -or
            (Test-Path -LiteralPath $javacInBin -PathType Leaf)) {
            $candidate = Split-Path $candidate -Parent
        }
    }

    try { return [IO.Path]::GetFullPath($candidate) } catch { return $candidate }
}

function Invoke-JavaVersionProbe {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ExecutablePath,
        [string]$Arguments = '-version'
    )

    $result = [ordered]@{
        Success  = $false
        ExitCode = $null
        StdOut   = ''
        StdErr   = ''
        Error    = ''
    }

    if (-not (Test-Path -LiteralPath $ExecutablePath -PathType Leaf)) {
        $result.Error = "文件不存在：$ExecutablePath"
        return [pscustomobject]$result
    }

    $process = $null
    try {
        # 不使用：& java.exe -version 2>&1
        # 原因：Windows PowerShell 5.1 下 native stderr 与
        # $ErrorActionPreference='Stop' 组合时可能把正常的 java -version
        # 输出当成错误处理。Java 恰好通常把版本信息写到 stderr。
        # 使用 ProcessStartInfo 分别读取 stdout/stderr，可彻底绕开该问题。
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $ExecutablePath
        $psi.Arguments = $Arguments
        $psi.UseShellExecute = $false
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.CreateNoWindow = $true

        $process = New-Object System.Diagnostics.Process
        $process.StartInfo = $psi
        if (-not $process.Start()) {
            $result.Error = "无法启动：$ExecutablePath"
            return [pscustomobject]$result
        }

        $stdout = $process.StandardOutput.ReadToEnd()
        $stderr = $process.StandardError.ReadToEnd()
        $process.WaitForExit()

        $result.ExitCode = $process.ExitCode
        $result.StdOut = [string]$stdout
        $result.StdErr = [string]$stderr
        $result.Success = ($process.ExitCode -eq 0)
        return [pscustomobject]$result
    } catch {
        $result.Error = $_.Exception.Message
        return [pscustomobject]$result
    } finally {
        if ($process) {
            try { $process.Dispose() } catch {}
        }
    }
}

function Get-JavaMajorVersion {
    param([string]$JavaHomePath)

    $resolved = Resolve-JavaHomeCandidate $JavaHomePath
    if ([string]::IsNullOrWhiteSpace($resolved)) { return $null }

    $java = Join-Path $resolved 'bin\java.exe'
    $javac = Join-Path $resolved 'bin\javac.exe'

    # Android/Gradle 构建需要完整 JDK，不能只存在 java.exe。
    if (-not (Test-Path -LiteralPath $java -PathType Leaf)) { return $null }
    if (-not (Test-Path -LiteralPath $javac -PathType Leaf)) { return $null }

    # 先用 java -version。不同发行版的常见格式包括：
    #   openjdk version "21.0.8" ...
    #   java version "1.8.0_..." ...
    $javaProbe = Invoke-JavaVersionProbe -ExecutablePath $java -Arguments '-version'
    $javaText = (([string]$javaProbe.StdOut) + "`n" + ([string]$javaProbe.StdErr)).Trim()
    if (-not [string]::IsNullOrWhiteSpace($javaText)) {
        foreach ($pattern in @(
            '(?im)^\s*(?:openjdk|java)\s+version\s+["'']?(?:(?:1)\.)?(\d+)',
            '(?im)\bversion\s+["'']?(?:(?:1)\.)?(\d+)'
        )) {
            $m = [regex]::Match($javaText, $pattern)
            if ($m.Success) { return [int]$m.Groups[1].Value }
        }
    }

    # java 的输出格式异常时，再用 javac -version 兜底。
    # 常见格式：javac 21.0.8
    $javacProbe = Invoke-JavaVersionProbe -ExecutablePath $javac -Arguments '-version'
    $javacText = (([string]$javacProbe.StdOut) + "`n" + ([string]$javacProbe.StdErr)).Trim()
    if (-not [string]::IsNullOrWhiteSpace($javacText)) {
        $m = [regex]::Match($javacText, '(?im)^\s*javac\s+(?:(?:1)\.)?(\d+)')
        if ($m.Success) { return [int]$m.Groups[1].Value }
    }

    Write-Verbose ("JDK 版本解析失败：{0}; java exit={1}; javac exit={2}; java error={3}; javac error={4}" -f `
        $resolved, $javaProbe.ExitCode, $javacProbe.ExitCode, $javaProbe.Error, $javacProbe.Error)
    return $null
}

function Get-JavaHomesFromRegistry {
    $results = New-Object System.Collections.Generic.List[string]

    # Oracle-compatible JavaSoft keys. Microsoft OpenJDK only writes these when
    # FeatureOracleJavaSoft was selected, so this is useful but not sufficient alone.
    foreach ($root in @(
        'HKLM:\SOFTWARE\JavaSoft\JDK',
        'HKLM:\SOFTWARE\WOW6432Node\JavaSoft\JDK',
        'HKCU:\SOFTWARE\JavaSoft\JDK'
    )) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        foreach ($key in @(Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue)) {
            try {
                $javaHome = (Get-ItemProperty -LiteralPath $key.PSPath -Name JavaHome -ErrorAction Stop).JavaHome
                if ($javaHome) { [void]$results.Add([string]$javaHome) }
            } catch {}
        }
    }

    # Native EXE/MSI installers normally expose InstallLocation in Windows uninstall metadata.
    foreach ($root in @(
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'
    )) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        foreach ($key in @(Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue)) {
            try {
                $item = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction Stop
                $displayName = [string]$item.DisplayName
                $installLocation = [string]$item.InstallLocation
                if ($displayName -match '(?i)(OpenJDK|JDK|Java)' -and $installLocation) {
                    [void]$results.Add($installLocation)
                }
            } catch {}
        }
    }

    return @($results | Select-Object -Unique)
}

function Get-JavaHomesFromCommonLocations {
    $results = New-Object System.Collections.Generic.List[string]
    $patterns = New-Object System.Collections.Generic.List[string]

    if ($env:ProgramFiles) {
        foreach ($relative in @(
            'Microsoft\jdk-*',
            'Eclipse Adoptium\jdk-*',
            'Java\jdk-*',
            'Amazon Corretto\jdk*',
            'Zulu\zulu*'
        )) { [void]$patterns.Add((Join-Path $env:ProgramFiles $relative)) }
    }
    if (${env:ProgramFiles(x86)}) {
        foreach ($relative in @('Microsoft\jdk-*', 'Java\jdk-*')) {
            [void]$patterns.Add((Join-Path ${env:ProgramFiles(x86)} $relative))
        }
    }
    if ($env:LOCALAPPDATA) {
        foreach ($relative in @(
            'Programs\Microsoft\jdk-*',
            'Programs\Eclipse Adoptium\jdk-*'
        )) { [void]$patterns.Add((Join-Path $env:LOCALAPPDATA $relative)) }
    }

    foreach ($pattern in $patterns) {
        foreach ($dir in @(Get-Item -Path $pattern -ErrorAction SilentlyContinue | Where-Object { $_.PSIsContainer })) {
            [void]$results.Add($dir.FullName)
        }
    }
    return @($results | Select-Object -Unique)
}

function Add-JavaHomeFromExecutablePath {
    param(
        [System.Collections.Generic.List[string]]$Results,
        [string]$ExecutablePath
    )
    if ($null -eq $Results -or [string]::IsNullOrWhiteSpace($ExecutablePath)) { return }

    $path = $ExecutablePath.Trim().Trim('"')
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return }
    $leaf = Split-Path $path -Leaf
    if ($leaf -notmatch '^(java|javac)\.exe$') { return }

    $bin = Split-Path $path -Parent
    if ((Split-Path $bin -Leaf) -ieq 'bin') {
        $candidateHome = Split-Path $bin -Parent
        if ($candidateHome) { [void]$Results.Add($candidateHome) }
    }
}

function Get-JavaHomesFromPath {
    $results = New-Object System.Collections.Generic.List[string]

    # 先使用 PowerShell 自身的命令解析。java.exe 和 javac.exe 都检查，
    # 避免“where javac 能找到，但脚本只查 where java”的情况。
    foreach ($commandName in @('java.exe', 'javac.exe')) {
        foreach ($command in @(Get-Command $commandName -All -ErrorAction SilentlyContinue)) {
            $source = $null
            if ($command.Source) { $source = [string]$command.Source }
            elseif ($command.Path) { $source = [string]$command.Path }
            if ($source) {
                Add-JavaHomeFromExecutablePath -Results $results -ExecutablePath $source
            }
        }
    }

    # 再兼容用户日常用的 where.exe。这里临时把 native stderr 的处理
    # 调成 Continue，避免 Windows PowerShell 5.1 + Stop 再次触发同类问题。
    $whereExe = $null
    if ($env:SystemRoot) {
        $candidateWhere = Join-Path $env:SystemRoot 'System32\where.exe'
        if (Test-Path -LiteralPath $candidateWhere -PathType Leaf) { $whereExe = $candidateWhere }
    }
    if (-not $whereExe) {
        $whereCommand = Get-Command 'where.exe' -ErrorAction SilentlyContinue
        if ($whereCommand) { $whereExe = [string]$whereCommand.Source }
    }

    if ($whereExe) {
        foreach ($name in @('java', 'javac')) {
            $oldPreference = $ErrorActionPreference
            try {
                $ErrorActionPreference = 'Continue'
                $whereOutput = @(& $whereExe $name 2>$null)
                foreach ($path in $whereOutput) {
                    if (-not [string]::IsNullOrWhiteSpace([string]$path)) {
                        Add-JavaHomeFromExecutablePath -Results $results -ExecutablePath ([string]$path)
                    }
                }
            } catch {
                Write-Verbose "where.exe $name 探测失败：$($_.Exception.Message)"
            } finally {
                $ErrorActionPreference = $oldPreference
            }
        }
    }

    return @($results | Select-Object -Unique)
}

Export-ModuleMember -Function 'Resolve-JavaHomeCandidate', 'Invoke-JavaVersionProbe', 'Get-JavaMajorVersion', 'Get-JavaHomesFromRegistry', 'Get-JavaHomesFromCommonLocations', 'Add-JavaHomeFromExecutablePath', 'Get-JavaHomesFromPath'
