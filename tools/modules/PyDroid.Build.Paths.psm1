# PyDroid Phase 7 build-tool module. Windows PowerShell 5.1 compatible.

function Resolve-AbsolutePath {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return $null }
    return [System.IO.Path]::GetFullPath($Path)
}

function Test-PathWithinRoot {
    param(
        [string]$Path,
        [string]$Root
    )
    if ([string]::IsNullOrWhiteSpace($Path) -or [string]::IsNullOrWhiteSpace($Root)) { return $false }
    try {
        $candidate = [System.IO.Path]::GetFullPath($Path).TrimEnd([char[]]'\/') + [System.IO.Path]::DirectorySeparatorChar
        $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd([char[]]'\/') + [System.IO.Path]::DirectorySeparatorChar
        return $candidate.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)
    } catch {
        return $false
    }
}

function Get-PackageDependencySpec {
    param($PackageObject, [string]$Name)
    foreach ($sectionName in @('devDependencies', 'dependencies', 'optionalDependencies')) {
        $section = $PackageObject.$sectionName
        if (-not $section) { continue }
        $property = $section.PSObject.Properties | Where-Object { $_.Name -eq $Name } | Select-Object -First 1
        if ($property) { return [string]$property.Value }
    }
    return $null
}

function Get-PnpmLockedVersion {
    param([string]$Root, [string]$Name)
    $lockFile = Join-Path $Root 'pnpm-lock.yaml'
    if (-not (Test-Path -LiteralPath $lockFile)) { return $null }
    try {
        $lockText = Get-Content -LiteralPath $lockFile -Raw
        $pattern = '(?ms)^\s+{0}:\s*\r?\n\s+specifier:[^\r\n]*\r?\n\s+version:\s*([^\s(]+)' -f [regex]::Escape($Name)
        $match = [regex]::Match($lockText, $pattern)
        if ($match.Success) { return $match.Groups[1].Value }
    } catch {}
    return $null
}

function Find-ExistingFile {
    param([string[]]$Candidates)
    foreach ($c in $Candidates) {
        if ($c -and (Test-Path -LiteralPath $c)) {
            return $c
        }
    }
    return $null
}

function Get-ExtendedLengthPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    $full = [System.IO.Path]::GetFullPath($Path)
    if ($full.StartsWith('\\?\')) { return $full }
    if ($full.StartsWith('\\')) {
        return ('\\?\UNC\' + $full.Substring(2))
    }
    return ('\\?\' + $full)
}

Export-ModuleMember -Function 'Resolve-AbsolutePath', 'Test-PathWithinRoot', 'Get-PackageDependencySpec', 'Get-PnpmLockedVersion', 'Find-ExistingFile', 'Get-ExtendedLengthPath'
