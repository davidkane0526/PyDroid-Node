param(
    [Parameter(Mandatory = $true)]
    [string]$ManifestPath
)

$ErrorActionPreference = "SilentlyContinue"
try {
    if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) { exit 0 }
    $items = @(Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json)
    foreach ($item in $items) {
        $path = [string]$item
        if ([string]::IsNullOrWhiteSpace($path) -or -not (Test-Path -LiteralPath $path)) { continue }
        if (Test-Path -LiteralPath $path -PathType Container) {
            & $env:ComSpec /d /s /c ('rmdir /s /q "{0}"' -f $path) | Out-Null
        } else {
            Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
        }
    }
} finally {
    Remove-Item -LiteralPath $ManifestPath -Force -ErrorAction SilentlyContinue
}
