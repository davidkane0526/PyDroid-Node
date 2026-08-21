# PyDroid workspace cleanup helper. Windows PowerShell 5.1 compatible.
# Deterministic policy: one cleanup operation. Failure is reported; there is no alternate cleaner.

function Remove-PyDroidBuildDirectory {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
}

Export-ModuleMember -Function 'Remove-PyDroidBuildDirectory'
