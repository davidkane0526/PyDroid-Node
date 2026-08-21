param(
    [string]$WorkRoot,
    [string]$RuntimeRoot
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $WorkRoot) { $WorkRoot = if ($env:PYDROID_BUILD_HOME) { $env:PYDROID_BUILD_HOME } else { "D:\PyDroidTemp" } }
if (-not $RuntimeRoot) {
    $RuntimeRoot = if ($env:PYDROID_DESKTOP_PYTHON_RUNTIME) {
        $env:PYDROID_DESKTOP_PYTHON_RUNTIME
    } else {
        Join-Path $WorkRoot "tools\pydroid-flow\Python\runtime-3.13"
    }
}

$downloads = Join-Path $WorkRoot "downloads\pydroid-flow"
$python = Join-Path $RuntimeRoot "python.exe"
$archive = Join-Path $downloads "python-3.13.14-embed-amd64.zip"
$getPip = Join-Path $downloads "get-pip.py"

$archiveSha256 = "90B4E5B9898B72D744650524BFF92377C367F44BD5FBD09E3148656C080AD907"
$getPipSha256 = "FB24E693BAB954209A063D90953621412CCAD4A500905A726286E038F508DDF6"

function Get-FileDigest([string]$Path, [string]$Algorithm) {
    return (Get-FileHash -LiteralPath $Path -Algorithm $Algorithm).Hash.ToUpperInvariant()
}

function Invoke-Download([string]$Uri, [string]$OutFile) {
    Invoke-WebRequest -Uri $Uri -OutFile $OutFile -UseBasicParsing
}

New-Item -ItemType Directory -Force -Path $downloads | Out-Null
if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) {
    Invoke-Download "https://www.python.org/ftp/python/3.13.14/python-3.13.14-embed-amd64.zip" $archive
}
if (-not (Test-Path -LiteralPath $getPip -PathType Leaf)) {
    Invoke-Download "https://bootstrap.pypa.io/get-pip.py" $getPip
}

if ((Get-FileDigest $archive "SHA256") -ne $archiveSha256) { throw "Python embedded runtime checksum verification failed" }
if ((Get-FileDigest $getPip "SHA256") -ne $getPipSha256) { throw "get-pip.py checksum verification failed" }

if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
    New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
    Expand-Archive -LiteralPath $archive -DestinationPath $RuntimeRoot
}

$pathConfig = Join-Path $RuntimeRoot "python313._pth"
$pathLines = @(Get-Content -LiteralPath $pathConfig)
if ($pathLines -notcontains "Lib\site-packages") { $pathLines += "Lib\site-packages" }
$pathLines = $pathLines | ForEach-Object { if ($_ -eq "#import site") { "import site" } else { $_ } }
Set-Content -LiteralPath $pathConfig -Value $pathLines -Encoding ASCII

$pipPackage = Join-Path $RuntimeRoot "Lib\site-packages\pip"
if (-not (Test-Path -LiteralPath $pipPackage -PathType Container)) {
    & $python $getPip --no-warn-script-location
    if ($LASTEXITCODE -ne 0) { throw "get-pip failed with exit code $LASTEXITCODE" }
}
& $python -m pip install --no-warn-script-location -r (Join-Path $projectRoot "requirements-dev.txt")
if ($LASTEXITCODE -ne 0) { throw "desktop Python requirements installation failed with exit code $LASTEXITCODE" }

Write-Host "Portable Windows Python runtime is ready: $RuntimeRoot"
Write-Host "Build GUI field 'Desktop Python folder' should use this exact path."
