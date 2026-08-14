# cap sync resolves node_modules (a junction to D:\PyDroidTemp on this machine)
# through require.resolve realpath and writes physical paths into
# android/capacitor.settings.gradle. Rewrite them to project-relative paths so
# that builds work on other machines where node_modules lives inside the repo.
$projectRoot = Split-Path -Parent $PSScriptRoot
$file = Join-Path $projectRoot "android\capacitor.settings.gradle"
if (-not (Test-Path $file)) { throw "Missing $file" }
$content = Get-Content $file -Raw
$fixed = $content -replace "'[^']*[/\\]node_modules[/\\]", "'../node_modules/"
# Always rewrite as UTF-8 without BOM (Gradle rejects a BOM; Get-Content
# strips the BOM before we can compare it, so gate on the raw bytes instead).
$hasBom = [System.IO.File]::ReadAllBytes($file).Length -ge 3 -and [System.IO.File]::ReadAllBytes($file)[0] -eq 0xEF -and [System.IO.File]::ReadAllBytes($file)[1] -eq 0xBB -and [System.IO.File]::ReadAllBytes($file)[2] -eq 0xBF
if ($fixed -ne $content -or $hasBom) {
    [System.IO.File]::WriteAllText($file, $fixed, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "capacitor.settings.gradle paths fixed to project-relative node_modules"
}
