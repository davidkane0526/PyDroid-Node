$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$toolsDirectory = Join-Path $projectRoot ".tools"
$downloads = Join-Path $toolsDirectory "downloads"
$runtime = Join-Path $toolsDirectory "python312-runtime"
$python = Join-Path $runtime "python.exe"
$archive = Join-Path $downloads "python-3.12.10-embed-amd64.zip"
$getPip = Join-Path $downloads "get-pip.py"

$archiveMd5 = "FE8EF205F2E9C3BA44D0CF9954E1ABD3"
$archiveSha256 = "4ACBED6DD1C744B0376E3B1CF57CE906F9DC9E95E68824584C8099A63025A3C3"
$getPipSha256 = "FB24E693BAB954209A063D90953621412CCAD4A500905A726286E038F508DDF6"

function Get-CertutilHash([string]$path, [string]$algorithm) {
    return ((& certutil.exe -hashfile $path $algorithm)[1] -replace " ", "").ToUpperInvariant()
}

New-Item -ItemType Directory -Force -Path $downloads | Out-Null
if (-not (Test-Path -LiteralPath $archive)) {
    Invoke-WebRequest -Uri "https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip" -OutFile $archive
}
if (-not (Test-Path -LiteralPath $getPip)) {
    Invoke-WebRequest -Uri "https://bootstrap.pypa.io/get-pip.py" -OutFile $getPip
}

if ((Get-CertutilHash $archive "MD5") -ne $archiveMd5 -or
    (Get-CertutilHash $archive "SHA256") -ne $archiveSha256) {
    throw "Python embedded runtime checksum verification failed"
}
if ((Get-CertutilHash $getPip "SHA256") -ne $getPipSha256) {
    throw "get-pip.py checksum verification failed"
}

if (-not (Test-Path -LiteralPath $python)) {
    Expand-Archive -LiteralPath $archive -DestinationPath $runtime
}

$pathConfig = Join-Path $runtime "python312._pth"
$pathLines = @(Get-Content -LiteralPath $pathConfig)
if ($pathLines -notcontains "Lib\site-packages") {
    $pathLines += "Lib\site-packages"
}
$pathLines = $pathLines | ForEach-Object { if ($_ -eq "#import site") { "import site" } else { $_ } }
Set-Content -LiteralPath $pathConfig -Value $pathLines -Encoding ASCII

$pipPackage = Join-Path $runtime "Lib\site-packages\pip"
if (-not (Test-Path -LiteralPath $pipPackage)) {
    & $python $getPip --no-warn-script-location
}
& $python -m pip install --no-warn-script-location -r (Join-Path $projectRoot "requirements-dev.txt")

Write-Host "Portable Windows Python runtime is ready: $python"
