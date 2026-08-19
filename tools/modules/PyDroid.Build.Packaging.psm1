# PyDroid workspace/output cleanup helpers. Windows PowerShell 5.1 compatible.
# Keep this module self-contained. Nested -Force imports can evict a module instance
# previously imported by the GUI build script under Windows PowerShell 5.1.

function ConvertTo-PyDroidExtendedLengthPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    $full = [System.IO.Path]::GetFullPath($Path)
    if ($full.StartsWith('\\?\')) { return $full }
    if ($full.StartsWith('\\')) { return ('\\?\UNC\' + $full.Substring(2)) }
    return ('\\?\' + $full)
}

function Remove-PyDroidBuildDirectoryRobust {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$WorkRoot,
        [switch]$Quiet
    )
    if (-not (Test-Path -LiteralPath $Path)) { return }
    try {
        Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
    } catch {
        if (-not $Quiet) { Write-Warning ("PowerShell 清理目录失败，将切换到 Windows 长路径清理：{0}" -f $Path) }
    }
    if (-not (Test-Path -LiteralPath $Path)) { return }

    $extendedPath = ConvertTo-PyDroidExtendedLengthPath -Path $Path
    & cmd.exe /d /c rd /s /q "`"$extendedPath`"" 2>$null | Out-Null
    $global:LASTEXITCODE = 0
    if (-not (Test-Path -LiteralPath $Path)) { return }

    $cleanupRoot = Join-Path $WorkRoot "cleanup-empty"
    $emptyDir = Join-Path $cleanupRoot ([Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $emptyDir | Out-Null
    try {
        $cleanupArgs = @(
            $emptyDir, $Path, "/MIR", "/XJ", "/R:1", "/W:1",
            "/NFL", "/NDL", "/NJH", "/NJS", "/NP", "/NS", "/NC"
        )
        & robocopy @cleanupArgs | Out-Null
        $robocopyExitCode = $LASTEXITCODE
        $global:LASTEXITCODE = 0
        if ($robocopyExitCode -ge 8) { throw "robocopy 长路径清理失败，退出码：$robocopyExitCode；目录：$Path" }
        & cmd.exe /d /c rd /s /q "`"$Path`"" 2>$null | Out-Null
        $global:LASTEXITCODE = 0
    } finally {
        Remove-Item -LiteralPath $emptyDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $Path) { throw "无法清理构建目录：$Path。请确认该目录未被其他进程占用。" }
}

Export-ModuleMember -Function 'Remove-PyDroidBuildDirectoryRobust'
