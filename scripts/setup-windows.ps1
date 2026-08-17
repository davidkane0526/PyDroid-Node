$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$toolsDirectory = Join-Path $projectRoot ".tools"
$downloads = Join-Path $toolsDirectory "downloads"
$runtime = Join-Path $toolsDirectory "python313-runtime"
$python = Join-Path $runtime "python.exe"
$archive = Join-Path $downloads "python-3.13.15-embed-amd64.zip"
$getPip = Join-Path $downloads "get-pip.py"

$archiveSha256 = "D1F04D990AEE1253D8569E8E5104E30FA9F5FA830899F14843448872D936A2CF"
$getPipSha256 = "FB24E693BAB954209A063D90953621412CCAD4A500905A726286E038F508DDF6"

function Get-FileDigest([string]$path, [string]$algorithm) {
    return (Get-FileHash -LiteralPath $path -Algorithm $algorithm).Hash.ToUpperInvariant()
}

function Invoke-DownloadWithRetry([string]$uri, [string]$outFile) {
    $attempts = 3
    for ($attempt = 1; $attempt -le $attempts; $attempt++) {
        try {
            Invoke-WebRequest -Uri $uri -OutFile $outFile -UseBasicParsing
            return
        } catch {
            if ($attempt -ge $attempts) { throw }
            Write-Warning "Download failed ($attempt/$attempts): $($_.Exception.Message)"
            Start-Sleep -Seconds (2 * $attempt)
        }
    }
}

New-Item -ItemType Directory -Force -Path $downloads | Out-Null
if (-not (Test-Path -LiteralPath $archive)) {
    Invoke-DownloadWithRetry "https://www.python.org/ftp/python/3.13.15/python-3.13.15-embed-amd64.zip" $archive
}
if (-not (Test-Path -LiteralPath $getPip)) {
    Invoke-DownloadWithRetry "https://bootstrap.pypa.io/get-pip.py" $getPip
}

if ((Get-FileDigest $archive "SHA256") -ne $archiveSha256) {
    throw "Python embedded runtime checksum verification failed"
}
if ((Get-FileDigest $getPip "SHA256") -ne $getPipSha256) {
    throw "get-pip.py checksum verification failed"
}

if (-not (Test-Path -LiteralPath $python)) {
    Expand-Archive -LiteralPath $archive -DestinationPath $runtime
}

$pathConfig = Join-Path $runtime "python313._pth"
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
