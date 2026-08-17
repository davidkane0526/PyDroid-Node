<#
.SYNOPSIS
    构建 PyDroid Flow：Android debug APK + Windows 未压缩桌面版（win-unpacked），并复用 DK 共享工具链/缓存。

.DESCRIPTION
    - 项目源码目录保持只读，脚本只读取项目，不写入任何项目文件。
    - 脚本把源码同步到 $WorkRoot\builds\<项目名> 临时工作区，在外部完成构建。
    - 自动探测已安装工具，并优先复用 DK_TOOL_ROOT/ToolRoot；缺失工具安装到共享 ToolRoot。
    - 最终产物平铺到 $OutputRoot：
          <productName>-<版本>.apk
          <productName>-<版本>-Desktop\    （win-unpacked 未压缩桌面版）
    - 构建完成后会清理工作区里的 APK/release/dist/android build 等打包产物，
      不在临时目录残留重复的打包文件。

.PARAMETER ProjectRoot
    项目源码根目录。缺省时使用当前目录（要求当前目录含 package.json）。

.PARAMETER ToolRoot
    跨项目共享工具根目录。优先 DK_TOOL_ROOT，其次 PYDROID_TOOL_ROOT；当前机器可自动复用 D:\Code。

.PARAMETER CacheRoot
    跨项目共享下载缓存。默认读取 DK_CACHE_ROOT；否则使用 ToolRoot\BuildCache。用于 pnpm store、npm、Electron、electron-builder、Gradle 与下载缓存。

.PARAMETER WorkRoot
    临时工作区目录。默认读取 PYDROID_BUILD_HOME；若已有 D:\PyDroidTemp 则复用，否则使用 LocalAppData\PyDroidBuild。

.PARAMETER OutputRoot
    最终产物输出目录。默认等于 WorkRoot。

.PARAMETER SearchRoots
    未指定 -ProjectRoot 时，在这些目录中搜索含 package.json 的可编译项目。
    默认搜索 WorkRoot、ToolRoot 和脚本所在目录。

.PARAMETER SkipAndroid
    跳过 Android APK 构建。

.PARAMETER SkipDesktop
    跳过桌面版构建。

.PARAMETER KeepHistory
    默认会先清理输出目录中旧的 PyDroid-Flow-*.apk 和 PyDroid-Flow-*-Desktop，
    只保留最新一份。加此参数则保留旧版本产物。

.PARAMETER SkipToolInstall
    只检测工具，缺失时报错并给出提示，不自动下载安装。

.PARAMETER KeepWorkspace
    构建结束后保留 release/dist/android build 等工作区产物，便于排查问题。

.PARAMETER DownloadRetryCount
    网络下载与旧版桌面打包的重试次数，默认 3。

.PARAMETER AndroidApiLevel
    Android compile SDK；0 表示从 android/variables.gradle 自动读取。

.PARAMETER ElectronMirror
    可选 Electron 下载镜像地址。

.PARAMETER ElectronBuilderMirror
    可选 electron-builder binaries 镜像地址。

.PARAMETER NetworkMode
    网络模式：Auto 自动复用环境变量或 Windows 系统代理；Direct 强制 pnpm 直连；Manual 使用 ProxyUrl。

.PARAMETER ProxyUrl
    手动代理地址，例如 http://127.0.0.1:7890。

.PARAMETER RegistryUrl
    可选 npm registry。留空时使用项目/用户的 pnpm 默认配置。

.PARAMETER PnpmFetchTimeoutSeconds
    pnpm 单个网络请求超时，默认 600 秒。

.PARAMETER PnpmNetworkConcurrency
    pnpm 网络并发，默认 16。较低的并发对本地代理和不稳定网络更友好。

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File D:\PyDroidTemp\build-pydroid.ps1 `
        -ProjectRoot "D:\下载\PyDroid-Node-runtime-architecture-rc1-clean\PyDroid Node"

.EXAMPLE
    # 指定工具目录/工作目录/输出目录
    powershell -ExecutionPolicy Bypass -File D:\PyDroidTemp\build-pydroid.ps1 `
        -ProjectRoot "E:\Code\PyDroid Node" `
        -ToolRoot "D:\Code" `
        -CacheRoot "D:\Code\BuildCache" `
        -WorkRoot "D:\PyDroidTemp" `
        -OutputRoot "D:\PyDroidTemp"

.EXAMPLE
    # 只构建 APK
    powershell -ExecutionPolicy Bypass -File D:\PyDroidTemp\build-pydroid.ps1 `
        -ProjectRoot "D:\Code\PyDroid" -SkipDesktop

.EXAMPLE
    # 只构建桌面版
    powershell -ExecutionPolicy Bypass -File D:\PyDroidTemp\build-pydroid.ps1 `
        -ProjectRoot "D:\Code\PyDroid" -SkipAndroid
#>

[CmdletBinding()]
param(
    [string]$ProjectRoot,
    [string]$ToolRoot,
    [string]$CacheRoot,
    [string]$WorkRoot,
    [string]$OutputRoot,
    [string[]]$SearchRoots,
    [switch]$SkipAndroid,
    [switch]$SkipDesktop,
    [switch]$KeepHistory,
    [switch]$SkipToolInstall,
    [switch]$KeepWorkspace,
    [int]$DownloadRetryCount = 3,
    [string]$NodeVersion,
    [string]$PythonVersion,
    [int]$AndroidApiLevel = 0,
    [int]$JdkMajor = 21,
    [string]$JavaHome,
    [string]$ElectronMirror,
    [string]$ElectronBuilderMirror,
    [ValidateSet("Auto", "Direct", "Manual")]
    [string]$NetworkMode = "Auto",
    [string]$ProxyUrl,
    [string]$RegistryUrl,
    [ValidateRange(60, 3600)]
    [int]$PnpmFetchTimeoutSeconds = 600,
    [ValidateRange(1, 64)]
    [int]$PnpmNetworkConcurrency = 16
)

$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Get-DefaultWorkRoot {
    if ($env:PYDROID_BUILD_HOME) { return $env:PYDROID_BUILD_HOME }
    if (Test-Path -LiteralPath "D:\PyDroidTemp") { return "D:\PyDroidTemp" }
    $local = [Environment]::GetFolderPath("LocalApplicationData")
    if ([string]::IsNullOrWhiteSpace($local)) { $local = $PSScriptRoot }
    return (Join-Path $local "PyDroidBuild")
}

function Get-DefaultToolRoot {
    param([string]$ResolvedWorkRoot)
    if ($env:DK_TOOL_ROOT) { return $env:DK_TOOL_ROOT }
    if ($env:PYDROID_TOOL_ROOT -and $env:PYDROID_TOOL_ROOT -ine "D:\Code\Language") { return $env:PYDROID_TOOL_ROOT }
    if (Test-Path -LiteralPath "D:\Code\NodeJs\node.exe") { return "D:\Code" }
    if ($env:PYDROID_TOOL_ROOT) { return $env:PYDROID_TOOL_ROOT }
    if (Test-Path -LiteralPath "D:\Code") { return "D:\Code" }
    if (Test-Path -LiteralPath "D:\Code\Language") { return "D:\Code\Language" }
    return (Join-Path $ResolvedWorkRoot "tools")
}

function Get-DefaultCacheRoot {
    param([string]$ResolvedToolRoot,[string]$ResolvedWorkRoot)
    if ($env:DK_CACHE_ROOT) { return $env:DK_CACHE_ROOT }
    if ($ResolvedToolRoot) { return (Join-Path $ResolvedToolRoot "BuildCache") }
    return (Join-Path $ResolvedWorkRoot "cache")
}

function Get-ProjectAndroidApiLevel {
    param([string]$Root, [int]$Override)
    if ($Override -gt 0) { return $Override }
    $variables = Join-Path $Root "android\variables.gradle"
    if (Test-Path -LiteralPath $variables) {
        $text = Get-Content -LiteralPath $variables -Raw
        $m = [regex]::Match($text, 'compileSdkVersion\s*=\s*(\d+)')
        if ($m.Success) { return [int]$m.Groups[1].Value }
    }
    return 36
}

function Normalize-ProxyUrl {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
    $valueTrimmed = $Value.Trim()
    if ($valueTrimmed -match '^[a-zA-Z][a-zA-Z0-9+.-]*://') { return $valueTrimmed }
    return "http://$valueTrimmed"
}

function Get-WindowsInternetProxy {
    try {
        $key = Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction Stop
        if ([int]$key.ProxyEnable -ne 1 -or [string]::IsNullOrWhiteSpace([string]$key.ProxyServer)) { return $null }
        $raw = [string]$key.ProxyServer
        if ($raw -match ';' -or $raw -match '=') {
            $parts = @{}
            foreach ($piece in ($raw -split ';')) {
                if ($piece -match '^\s*([^=]+)=(.+)$') { $parts[$matches[1].Trim().ToLowerInvariant()] = $matches[2].Trim() }
            }
            if ($parts.ContainsKey('https')) { return Normalize-ProxyUrl $parts['https'] }
            if ($parts.ContainsKey('http')) { return Normalize-ProxyUrl $parts['http'] }
            if ($parts.Count -gt 0) { return Normalize-ProxyUrl (($parts.Values | Select-Object -First 1)) }
        }
        return Normalize-ProxyUrl $raw
    } catch {
        return $null
    }
}

function Test-LocalProxyEndpoint {
    param([string]$Url)
    if ([string]::IsNullOrWhiteSpace($Url)) { return $true }
    try {
        $uri = [Uri]$Url
        $hostName = $uri.Host
        if ($hostName -notin @('127.0.0.1', 'localhost', '::1')) { return $true }
        $port = $uri.Port
        if ($port -le 0) { return $true }
        $client = New-Object System.Net.Sockets.TcpClient
        try {
            $async = $client.BeginConnect($hostName, $port, $null, $null)
            if (-not $async.AsyncWaitHandle.WaitOne(1500, $false)) { return $false }
            $client.EndConnect($async)
            return $client.Connected
        } finally {
            $client.Close()
        }
    } catch {
        return $false
    }
}

function Configure-Network {
    $script:ResolvedProxyUrl = $null
    $script:ResolvedProxySource = 'direct'

    if ($NetworkMode -eq 'Direct') {
        foreach ($name in @('HTTPS_PROXY','HTTP_PROXY','https_proxy','http_proxy','ALL_PROXY','all_proxy','GLOBAL_AGENT_HTTP_PROXY','GLOBAL_AGENT_HTTPS_PROXY','ELECTRON_GET_USE_PROXY','npm_config_proxy','npm_config_https_proxy','PNPM_CONFIG_PROXY','PNPM_CONFIG_HTTPS_PROXY')) {
            Remove-Item "Env:$name" -ErrorAction SilentlyContinue
        }
        Write-Step '网络模式：直连（已清除本次构建进程的 HTTP/HTTPS 代理环境变量）'
    } elseif ($NetworkMode -eq 'Manual') {
        if ([string]::IsNullOrWhiteSpace($ProxyUrl)) { throw '网络模式为 Manual，但未填写 ProxyUrl。' }
        $script:ResolvedProxyUrl = Normalize-ProxyUrl $ProxyUrl
        $script:ResolvedProxySource = 'manual'
    } else {
        foreach ($name in @('HTTPS_PROXY','https_proxy','HTTP_PROXY','http_proxy','ALL_PROXY','all_proxy','npm_config_https_proxy','npm_config_proxy','PNPM_CONFIG_HTTPS_PROXY','PNPM_CONFIG_PROXY')) {
            $candidate = [Environment]::GetEnvironmentVariable($name, 'Process')
            if (-not [string]::IsNullOrWhiteSpace($candidate)) {
                $script:ResolvedProxyUrl = Normalize-ProxyUrl $candidate
                $script:ResolvedProxySource = "environment:$name"
                break
            }
        }
        if (-not $script:ResolvedProxyUrl) {
            $systemProxy = Get-WindowsInternetProxy
            if ($systemProxy) {
                $script:ResolvedProxyUrl = $systemProxy
                $script:ResolvedProxySource = 'Windows Internet Settings'
            }
        }
    }

    if ($script:ResolvedProxyUrl) {
        if (-not (Test-LocalProxyEndpoint $script:ResolvedProxyUrl)) {
            throw "检测到本地代理 $($script:ResolvedProxyUrl)，但代理端口不可访问。请启动代理软件，或在 GUI 中选择‘直连’/填写正确的手动代理。"
        }
        $env:HTTPS_PROXY = $script:ResolvedProxyUrl
        $env:HTTP_PROXY = $script:ResolvedProxyUrl
        $env:https_proxy = $script:ResolvedProxyUrl
        $env:http_proxy = $script:ResolvedProxyUrl
        $env:ALL_PROXY = $script:ResolvedProxyUrl
        $env:all_proxy = $script:ResolvedProxyUrl
        # @electron/get only enables its proxy bootstrap when this flag is present.
        $env:ELECTRON_GET_USE_PROXY = '1'
        $env:GLOBAL_AGENT_HTTP_PROXY = $script:ResolvedProxyUrl
        $env:GLOBAL_AGENT_HTTPS_PROXY = $script:ResolvedProxyUrl
        $env:npm_config_proxy = $script:ResolvedProxyUrl
        $env:npm_config_https_proxy = $script:ResolvedProxyUrl
        $env:PNPM_CONFIG_PROXY = $script:ResolvedProxyUrl
        $env:PNPM_CONFIG_HTTPS_PROXY = $script:ResolvedProxyUrl
        Write-Step "网络代理：$($script:ResolvedProxyUrl)（来源：$($script:ResolvedProxySource)）"
    } elseif ($NetworkMode -eq 'Auto') {
        Write-Step '网络代理：未检测到环境变量或 Windows 固定代理，本次 pnpm 使用直连。'
        try {
            $internet = Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction SilentlyContinue
            if ($internet.AutoConfigURL) {
                Write-Warning "检测到 Windows PAC 自动代理：$($internet.AutoConfigURL)。pnpm 不能直接使用 PAC URL；如需代理，请在 GUI 中选择‘手动代理’并填写代理软件的 HTTP/Mixed 端口。"
            }
        } catch {}
    }

    $fetchRetries = [string][Math]::Max(2, $DownloadRetryCount)
    $fetchTimeoutMs = [string]($PnpmFetchTimeoutSeconds * 1000)
    $networkConcurrency = [string]$PnpmNetworkConcurrency
    # pnpm supports environment based configuration. Set both pnpm- and npm-compatible
    # spellings because this build script is intentionally compatible with multiple pnpm generations.
    $env:PNPM_CONFIG_FETCH_RETRIES = $fetchRetries
    $env:PNPM_CONFIG_FETCH_TIMEOUT = $fetchTimeoutMs
    $env:PNPM_CONFIG_NETWORK_CONCURRENCY = $networkConcurrency
    $env:npm_config_fetch_retries = $fetchRetries
    $env:npm_config_fetch_timeout = $fetchTimeoutMs
    $env:npm_config_network_concurrency = $networkConcurrency
    Write-Step "pnpm 网络参数：timeout=$PnpmFetchTimeoutSeconds s；retries=$([Math]::Max(2, $DownloadRetryCount))；concurrency=$PnpmNetworkConcurrency；prefer-offline=on"
    if ($RegistryUrl) { Write-Step "npm registry：$RegistryUrl" }
}

function Invoke-Download {
    param([Parameter(Mandatory=$true)][string]$Uri, [Parameter(Mandatory=$true)][string]$OutFile)
    $attempts = [Math]::Max(1, $DownloadRetryCount)
    $parent = Split-Path $OutFile -Parent
    if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    $downloadName = Split-Path $OutFile -Leaf
    for ($attempt = 1; $attempt -le $attempts; $attempt++) {
        try {
            Write-BuildStage -Percent $script:CurrentBuildStagePercent -Message ("正在下载：{0}（{1}/{2}）" -f $downloadName, $attempt, $attempts)
            Write-Host ("下载 [{0}/{1}] {2}" -f $attempt, $attempts, $Uri) -ForegroundColor DarkGray
            if ($script:ResolvedProxyUrl) {
                Invoke-WebRequest -Uri $Uri -OutFile $OutFile -UseBasicParsing -TimeoutSec $PnpmFetchTimeoutSeconds -Proxy $script:ResolvedProxyUrl
            } else {
                Invoke-WebRequest -Uri $Uri -OutFile $OutFile -UseBasicParsing -TimeoutSec $PnpmFetchTimeoutSeconds
            }
            return
        } catch {
            if ($attempt -ge $attempts) { throw }
            Write-Warning ("下载失败：{0}。稍后自动重试。" -f $_.Exception.Message)
            Start-Sleep -Seconds ([Math]::Min(8, 2 * $attempt))
        }
    }
}

# ---------------------------------------------------------------
# 路径解析
# ---------------------------------------------------------------

function Resolve-AbsolutePath {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return $null }
    return [System.IO.Path]::GetFullPath($Path)
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

function Select-ProjectRoot {
    $searchRoots = @()
    if ($SearchRoots -and $SearchRoots.Count -gt 0) {
        $searchRoots = $SearchRoots
    } else {
        $searchRoots = @($WorkRoot, $ToolRoot, $PSScriptRoot)
    }

    $candidateDirs = @()
    foreach ($root in $searchRoots) {
        if (-not $root -or -not (Test-Path -LiteralPath $root)) { continue }
        $candidateDirs += $root
        $candidateDirs += Get-ChildItem -LiteralPath $root -Directory -Force -ErrorAction SilentlyContinue |
            ForEach-Object { $_.FullName }

        $repoDir = Join-Path $root "PyDroid\repo"
        if (Test-Path -LiteralPath $repoDir) { $candidateDirs += $repoDir }

        $buildRoot = Join-Path $root "builds"
        if (Test-Path -LiteralPath $buildRoot) {
            $candidateDirs += Get-ChildItem -LiteralPath $buildRoot -Directory -Force -ErrorAction SilentlyContinue |
                ForEach-Object { $_.FullName }
        }
    }

    $projects = @(
        $candidateDirs |
            Where-Object {
                $_ -and
                (Test-Path -LiteralPath (Join-Path $_ "package.json")) -and
                ((Test-Path -LiteralPath (Join-Path $_ "android")) -or
                 (Test-Path -LiteralPath (Join-Path $_ "desktop")))
            } |
            ForEach-Object { [System.IO.Path]::GetFullPath($_) } |
            Select-Object -Unique
    )

    if ($projects.Count -eq 0) {
        $manual = Read-Host "没有发现可编译的项目，请手动输入项目根目录"
        if ([string]::IsNullOrWhiteSpace($manual)) {
            throw "未提供有效的项目根目录。"
        }
        return [System.IO.Path]::GetFullPath($manual)
    }

    if ($projects.Count -eq 1) {
        Write-Host "自动选择唯一的项目：$($projects[0])" -ForegroundColor DarkGray
        return $projects[0]
    }

    Write-Host ""
    Write-Host "发现以下可编译的项目：" -ForegroundColor Cyan
    for ($i = 0; $i -lt $projects.Count; $i++) {
        Write-Host ("[{0}] {1}" -f ($i + 1), $projects[$i])
    }
    Write-Host "[0] 手动输入其他路径"

    $choice = Read-Host "请选择要编译的项目编号"
    if ($choice -eq "0") {
        $manual = Read-Host "请输入项目根目录"
        if ([string]::IsNullOrWhiteSpace($manual)) {
            throw "未提供有效的项目根目录。"
        }
        return [System.IO.Path]::GetFullPath($manual)
    }

    $index = 0
    if (-not [int]::TryParse($choice, [ref]$index) -or $index -lt 1 -or $index -gt $projects.Count) {
        throw "无效的项目编号：$choice"
    }
    return $projects[$index - 1]
}

if (-not $WorkRoot) { $WorkRoot = Get-DefaultWorkRoot }
if (-not $ToolRoot) { $ToolRoot = Get-DefaultToolRoot -ResolvedWorkRoot $WorkRoot }
if (-not $CacheRoot) { $CacheRoot = Get-DefaultCacheRoot -ResolvedToolRoot $ToolRoot -ResolvedWorkRoot $WorkRoot }
if (-not $NodeVersion) { $NodeVersion = if ($env:PYDROID_NODE_VERSION) { $env:PYDROID_NODE_VERSION } else { "24.19.0" } }
if (-not $PythonVersion) { $PythonVersion = if ($env:PYDROID_PYTHON_VERSION) { $env:PYDROID_PYTHON_VERSION } else { "3.12.10" } }
$pythonVersionParts = $PythonVersion.Split(".")
if ($pythonVersionParts.Count -lt 2) { throw "PythonVersion 必须至少包含主版本和次版本，例如 3.12.10。" }
$pythonMajor = [int]$pythonVersionParts[0]
$pythonMinor = [int]$pythonVersionParts[1]
$pythonSeries = ("{0}.{1}" -f $pythonMajor, $pythonMinor)
$pythonToolDirName = ("python{0}{1}" -f $pythonMajor, $pythonMinor)

if (-not $ProjectRoot) {
    if (Test-Path (Join-Path (Get-Location) "package.json")) {
        $ProjectRoot = (Get-Location).Path
    } else {
        $ProjectRoot = Select-ProjectRoot
    }
}

$ProjectRoot = Resolve-AbsolutePath $ProjectRoot
$ToolRoot    = Resolve-AbsolutePath $ToolRoot
$CacheRoot   = Resolve-AbsolutePath $CacheRoot
$WorkRoot    = Resolve-AbsolutePath $WorkRoot
if (-not $OutputRoot) { $OutputRoot = $WorkRoot }
$OutputRoot  = Resolve-AbsolutePath $OutputRoot

if (-not (Test-Path (Join-Path $ProjectRoot "package.json"))) {
    throw "项目根目录缺少 package.json：$ProjectRoot"
}
if (-not (Test-Path (Join-Path $ProjectRoot "android")) -and -not $SkipAndroid) {
    throw "项目根目录缺少 android/ 目录，且未使用 -SkipAndroid：$ProjectRoot"
}
if (-not (Test-Path (Join-Path $ProjectRoot "desktop")) -and -not $SkipDesktop) {
    throw "项目根目录缺少 desktop/ 目录，且未使用 -SkipDesktop：$ProjectRoot"
}
if ($SkipAndroid -and $SkipDesktop) {
    throw "不能同时使用 -SkipAndroid 和 -SkipDesktop，至少保留一种构建。"
}

$package = Get-Content -LiteralPath (Join-Path $ProjectRoot "package.json") -Raw | ConvertFrom-Json
$packageManagerSpec = [string]$package.packageManager
$electronSpec = Get-PackageDependencySpec -PackageObject $package -Name 'electron'
$electronBuilderSpec = Get-PackageDependencySpec -PackageObject $package -Name 'electron-builder'
$electronLockedVersion = Get-PnpmLockedVersion -Root $ProjectRoot -Name 'electron'
$electronBuilderLockedVersion = Get-PnpmLockedVersion -Root $ProjectRoot -Name 'electron-builder'
$version = [string]$package.version
if (-not $version) { $version = "0.0.0" }
$productName = [string]$package.build.productName
if ([string]::IsNullOrWhiteSpace($productName)) { $productName = [string]$package.name }
if ([string]::IsNullOrWhiteSpace($productName)) { $productName = Split-Path $ProjectRoot -Leaf }
$outputBaseName = $productName.Trim()
foreach ($invalidChar in [IO.Path]::GetInvalidFileNameChars()) {
    $outputBaseName = $outputBaseName.Replace([string]$invalidChar, "-")
}
$outputBaseName = ($outputBaseName -replace '\s+', '-').Trim([char[]]'-.')
if ([string]::IsNullOrWhiteSpace($outputBaseName)) { $outputBaseName = "PyDroid-Flow" }
$resolvedAndroidApi = Get-ProjectAndroidApiLevel -Root $ProjectRoot -Override $AndroidApiLevel

$projectKey = [string]$package.name
if ([string]::IsNullOrWhiteSpace($projectKey)) {
    $projectKey = Split-Path $ProjectRoot -Leaf
}
$projectKey = ($projectKey -replace '[^A-Za-z0-9._-]', '-').Trim([char[]]'-')
if (-not $projectKey) { $projectKey = "pydroid-flow" }

$workspace = Join-Path $WorkRoot "builds\$projectKey"
$projectPrefix = $ProjectRoot.TrimEnd([char[]]'\/') + [IO.Path]::DirectorySeparatorChar
$workspaceFull = [IO.Path]::GetFullPath($workspace)
if ($workspaceFull.StartsWith($projectPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "工作区不能位于项目源码目录内部：$workspaceFull"
}
$downloads = Join-Path $CacheRoot "downloads"
$storeDir  = Join-Path $CacheRoot "pnpm-store"
$gradleHome = Join-Path $CacheRoot "gradle"
$electronCache = Join-Path $CacheRoot "electron"
$electronBuilderCache = Join-Path $CacheRoot "electron-builder"
$npmCache = Join-Path $CacheRoot "npm"
$corepackCache = Join-Path $CacheRoot "corepack"

foreach ($d in @($ToolRoot, $CacheRoot, $WorkRoot, $OutputRoot, $workspace, $downloads, $storeDir, $gradleHome, $electronCache, $electronBuilderCache, $npmCache, $corepackCache)) {
    New-Item -ItemType Directory -Force -Path $d | Out-Null
}

# ---------------------------------------------------------------
# 工具函数
# ---------------------------------------------------------------

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

# Machine-readable stage events are consumed by build-pydroid-gui.ps1.
# They are intentionally plain stdout so the CLI build remains usable everywhere.
$script:CurrentBuildStagePercent = 0
function Write-BuildStage {
    param(
        [ValidateRange(0, 100)][int]$Percent,
        [Parameter(Mandatory=$true)][string]$Message
    )
    $script:CurrentBuildStagePercent = $Percent
    Write-Host ("@@PYDROID_STAGE@@|{0}|{1}" -f $Percent, ($Message -replace '[\r\n|]+', ' '))
}

function Test-NativeSuccess {
    if ($LASTEXITCODE -ge 8) {
        throw "命令失败，退出码 $LASTEXITCODE。"
    }
}

function Invoke-Exe {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$WorkingDirectory
    )
    if ($WorkingDirectory) {
        Push-Location $WorkingDirectory
    }
    try {
        if ($Arguments.Count -gt 0) {
            & $FilePath @Arguments
        } else {
            & $FilePath
        }
        if ($LASTEXITCODE -ne 0) {
            throw "命令失败（退出码 $LASTEXITCODE）：$FilePath $($Arguments -join ' ')"
        }
    } finally {
        if ($WorkingDirectory) { Pop-Location }
    }
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

# ---------------------------------------------------------------
# Node / pnpm
# ---------------------------------------------------------------

$script:NodeDir = $null
$script:PnpmCommand = $null
$script:PnpmUseCorepack = $false

function Find-Node {
    if ($env:PYDROID_NODE_EXECUTABLE -and (Test-Path -LiteralPath $env:PYDROID_NODE_EXECUTABLE)) {
        return (Split-Path $env:PYDROID_NODE_EXECUTABLE -Parent)
    }

    # 用户选择的共享工具根目录优先，避免系统 PATH 中其它 Node 抢占。
    $candidates = @(
        (Join-Path $ToolRoot "NodeJs"),
        (Join-Path $ToolRoot "NodeJS"),
        (Join-Path $ToolRoot "Language\NodeJS"),
        (Join-Path $WorkRoot "tools\nodejs"),
        (Join-Path $WorkRoot "tools\node")
    )
    foreach ($c in $candidates) {
        if (Test-Path (Join-Path $c "node.exe")) { return $c }
    }

    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) { return (Split-Path $cmd.Source -Parent) }
    return $null
}

function Install-Node {
    if ($SkipToolInstall) {
        throw "未找到 Node.js，且已指定 -SkipToolInstall。请安装可用的 Node.js 后重试。"
    }
    Write-Step "未找到 Node.js，正在下载便携版 Node.js 到共享工具目录 $ToolRoot\NodeJs ..."
    $zip = Join-Path $downloads ("node-v{0}-win-x64.zip" -f $NodeVersion)
    if (-not (Test-Path -LiteralPath $zip)) {
        Invoke-Download -Uri ("https://nodejs.org/dist/v{0}/node-v{0}-win-x64.zip" -f $NodeVersion) -OutFile $zip
    }
    $temp = Join-Path $CacheRoot ".node-extract"
    if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $temp | Out-Null
    Expand-Archive -LiteralPath $zip -DestinationPath $temp -Force

    $inner = Get-ChildItem -LiteralPath $temp -Directory | Where-Object { Test-Path (Join-Path $_.FullName "node.exe") } | Select-Object -First 1
    if (-not $inner) { throw "Node.js 压缩包解压后未找到 node.exe。" }

    $dest = Join-Path $ToolRoot "NodeJs"
    if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
    Move-Item -LiteralPath $inner.FullName -Destination $dest
    Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
    return $dest
}

function Find-Pnpm {
    $cmd = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
    if (-not $cmd) { $cmd = Get-Command pnpm -ErrorAction SilentlyContinue }
    if ($cmd -and $cmd.Source) { return $cmd.Source }
    return $null
}

function Invoke-Pnpm {
    param([string[]]$Arguments)
    Push-Location $workspace
    try {
        if ($script:PnpmUseCorepack) {
            & $script:PnpmCommand "pnpm" @Arguments
        } else {
            & $script:PnpmCommand @Arguments
        }
        if ($LASTEXITCODE -ne 0) {
            throw "pnpm 命令失败（退出码 $LASTEXITCODE）：pnpm $($Arguments -join ' ')"
        }
    } finally {
        Pop-Location
    }
}

function Get-PnpmVersion {
    Push-Location $workspace
    try {
        if ($script:PnpmUseCorepack) {
            $output = & $script:PnpmCommand "pnpm" "--version" 2>$null
        } else {
            $output = & $script:PnpmCommand "--version" 2>$null
        }
        if ($LASTEXITCODE -eq 0 -and $output) { return [string](($output | Select-Object -Last 1).Trim()) }
    } catch {}
    finally { Pop-Location }
    return $null
}

# ---------------------------------------------------------------
# Java / Android SDK / Python
# ---------------------------------------------------------------

function Resolve-JavaHomeCandidate {
    param([string]$JavaHomePath)
    if ([string]::IsNullOrWhiteSpace($JavaHomePath)) { return $null }

    $candidate = [Environment]::ExpandEnvironmentVariables($JavaHomePath.Trim().Trim('"'))
    if ([string]::IsNullOrWhiteSpace($candidate)) { return $null }

    # 允许传入 JAVA_HOME、本身的 bin 目录，甚至 java.exe/javac.exe 完整路径。
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
        $leaf = Split-Path $candidate -Leaf
        if ($leaf -match '^(java|javac)\.exe$') {
            $candidate = Split-Path (Split-Path $candidate -Parent) -Parent
        }
    } elseif ((Split-Path $candidate -Leaf) -ieq 'bin' -and (Test-Path -LiteralPath (Join-Path $candidate 'java.exe'))) {
        $candidate = Split-Path $candidate -Parent
    }

    try { return [IO.Path]::GetFullPath($candidate) } catch { return $candidate }
}

function Get-JavaMajorVersion {
    param([string]$JavaHomePath)
    $resolved = Resolve-JavaHomeCandidate $JavaHomePath
    if ([string]::IsNullOrWhiteSpace($resolved)) { return $null }
    $java = Join-Path $resolved "bin\java.exe"
    $javac = Join-Path $resolved "bin\javac.exe"
    # Android 构建需要完整 JDK，而不是只有 java.exe 的 JRE。
    if (-not (Test-Path -LiteralPath $java -PathType Leaf) -or -not (Test-Path -LiteralPath $javac -PathType Leaf)) { return $null }

    # 不同发行版的 java -version 文本并不完全一致。javac -version 的第一项通常
    # 最稳定（例如 `javac 21.0.8`），所以同时读取 java/javac，再按明确模式解析。
    $texts = New-Object System.Collections.Generic.List[string]
    foreach ($probe in @(@($javac, '-version'), @($java, '-version'))) {
        try {
            $raw = (& $probe[0] $probe[1] 2>&1 | Out-String).Trim()
            if ($raw) { [void]$texts.Add($raw) }
        } catch {}
    }
    foreach ($text in $texts) {
        foreach ($pattern in @(
            '(?im)\bjavac\s+(?:(?:1)\.)?(\d+)(?:[._\s-]|$)',
            '(?im)\bversion\s+["'']?(?:(?:1)\.)?(\d+)(?:[._"''\s-]|$)',
            '(?im)\bopenjdk\s+(?:(?:1)\.)?(\d+)(?:[._\s-]|$)',
            '(?im)\bjava\s+(?:(?:1)\.)?(\d+)(?:[._\s-]|$)'
        )) {
            $m = [regex]::Match($text, $pattern)
            if ($m.Success) { return [int]$m.Groups[1].Value }
        }
    }
    return $null
}

function Get-JavaProbeText {
    param([string]$JavaHomePath)
    $resolved = Resolve-JavaHomeCandidate $JavaHomePath
    if ([string]::IsNullOrWhiteSpace($resolved)) { return "" }
    $java = Join-Path $resolved "bin\java.exe"
    $javac = Join-Path $resolved "bin\javac.exe"
    $parts = @()
    foreach ($probe in @(@($javac, '-version'), @($java, '-version'))) {
        if (-not (Test-Path -LiteralPath $probe[0] -PathType Leaf)) { continue }
        try {
            $raw = (& $probe[0] $probe[1] 2>&1 | Out-String).Trim()
            if ($raw) { $parts += $raw }
        } catch {}
    }
    return ($parts -join ' | ')
}

function Test-JavaHome {
    param([string]$JavaHomePath)
    $major = Get-JavaMajorVersion $JavaHomePath
    return ($null -ne $major -and $major -eq $JdkMajor)
}

function Find-JavaHomeInRoot {
    param(
        [string]$RootPath,
        [int]$MaxDepth = 2
    )
    if ([string]::IsNullOrWhiteSpace($RootPath)) { return $null }

    $root = Resolve-JavaHomeCandidate $RootPath
    if ([string]::IsNullOrWhiteSpace($root)) { return $null }

    # 如果用户已经直接给了 JAVA_HOME、bin 目录或 java.exe/javac.exe，直接验证。
    if (Test-JavaHome $root) { return $root }
    if (-not (Test-Path -LiteralPath $root -PathType Container)) { return $null }

    # 允许用户只填写类似 D:\Code\Language\Java 这样的“Java 容器目录”。
    # 最多向下两层，避免对整个磁盘做递归扫描。
    $queue = New-Object System.Collections.Queue
    $queue.Enqueue([pscustomobject]@{ Path = $root; Depth = 0 })
    $visited = @{}
    while ($queue.Count -gt 0) {
        $item = $queue.Dequeue()
        $currentPath = [string]$item.Path
        $depth = [int]$item.Depth
        $key = $currentPath.ToLowerInvariant()
        if ($visited.ContainsKey($key)) { continue }
        $visited[$key] = $true

        if ($depth -gt 0 -and (Test-JavaHome $currentPath)) { return $currentPath }
        if ($depth -ge $MaxDepth) { continue }

        foreach ($dir in @(Get-ChildItem -LiteralPath $currentPath -Directory -ErrorAction SilentlyContinue)) {
            $queue.Enqueue([pscustomobject]@{ Path = $dir.FullName; Depth = ($depth + 1) })
        }
    }
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

function Get-JavaHomesFromPath {
    $results = New-Object System.Collections.Generic.List[string]
    foreach ($whereName in @('java', 'javac')) {
        try {
            foreach ($javaPath in @(& where.exe $whereName 2>$null)) {
                if (-not [string]::IsNullOrWhiteSpace($javaPath)) {
                    $candidateHome = Split-Path (Split-Path $javaPath.Trim() -Parent) -Parent
                    if ($candidateHome) { [void]$results.Add($candidateHome) }
                }
            }
        } catch {}
    }

    foreach ($commandName in @('java.exe', 'javac.exe')) {
        foreach ($command in @(Get-Command $commandName -All -ErrorAction SilentlyContinue)) {
            if ($command.Source) {
                $candidateHome = Split-Path (Split-Path $command.Source -Parent) -Parent
                if ($candidateHome) { [void]$results.Add($candidateHome) }
            }
        }
    }
    return @($results | Select-Object -Unique)
}

function Find-JavaHome {
    # 0) GUI/命令行手动指定时，它是绝对优先且具有“禁止自动下载”的语义。
    #    可以填写真正的 JAVA_HOME，也可以填写包含多个 JDK 子目录的 Java 根目录。
    if (-not [string]::IsNullOrWhiteSpace($JavaHome)) {
        $explicitRoot = Resolve-JavaHomeCandidate $JavaHome
        if ([string]::IsNullOrWhiteSpace($explicitRoot)) { throw "手动指定的 JDK 路径为空。" }

        # 手动路径的含义是“相信用户选择的位置”，因此先检查这个目录本身。
        # 只要 bin\java.exe 与 bin\javac.exe 都存在，就不应该因为发行版版本文本
        # 格式不同而误判成“没安装”。若能识别到版本，则仍严格阻止错误主版本。
        $directJava = Join-Path $explicitRoot 'bin\java.exe'
        $directJavac = Join-Path $explicitRoot 'bin\javac.exe'
        if ((Test-Path -LiteralPath $directJava -PathType Leaf) -and (Test-Path -LiteralPath $directJavac -PathType Leaf)) {
            $directMajor = Get-JavaMajorVersion $explicitRoot
            if ($null -ne $directMajor -and $directMajor -ne $JdkMajor) {
                throw ("你手动指定的目录包含完整 JDK，但版本是 {0}，项目要求 JDK {1}：{2}" -f $directMajor, $JdkMajor, $explicitRoot)
            }
            if ($null -eq $directMajor) {
                Write-Step ("JDK 版本文本无法自动解析，但已确认 java.exe/javac.exe 存在；按手动路径继续：{0}" -f $explicitRoot)
                $probeText = Get-JavaProbeText $explicitRoot
                if ($probeText) { Write-Step ("JDK 探测输出：{0}" -f $probeText) }
            } else {
                Write-Step ("使用手动指定的 JDK {0}：{1}" -f $directMajor, $explicitRoot)
            }
            return $explicitRoot
        }

        # 也允许填写一个 Java 容器目录（例如 D:\Code\Language\Java），
        # 此时向下寻找真正带 bin\java.exe + bin\javac.exe 的 JDK 目录。
        $explicit = Find-JavaHomeInRoot -RootPath $explicitRoot -MaxDepth 3
        if ($explicit) {
            Write-Step "使用手动指定目录中的 JDK：$explicit"
            return $explicit
        }

        # 最后用 where.exe 的实际命中结果兜底。若 PATH 中的 JDK 位于用户所选目录下，
        # 直接复用它；这覆盖软链接、junction 和某些安装器生成的目录结构。
        foreach ($pathHome in @(Get-JavaHomesFromPath)) {
            $resolvedPathHome = Resolve-JavaHomeCandidate $pathHome
            if (-not $resolvedPathHome) { continue }
            $underExplicit = $resolvedPathHome.StartsWith($explicitRoot.TrimEnd('\') + '\', [System.StringComparison]::OrdinalIgnoreCase) -or ($resolvedPathHome -ieq $explicitRoot)
            if ($underExplicit -and (Test-JavaHome $resolvedPathHome)) {
                Write-Step "通过 PATH/where.exe 找到手动目录中的 JDK：$resolvedPathHome"
                return $resolvedPathHome
            }
        }
        throw ("你手动指定了 JDK 目录：{0}`n没有找到可用的 JDK {1}。请确认该目录本身或其子目录包含 bin\java.exe 和 bin\javac.exe。`n脚本不会自动下载 JDK。" -f $explicitRoot, $JdkMajor)
    }

    # 1) 环境变量优先。环境变量也允许指向 Java 容器目录。
    foreach ($envHome in @($env:PYDROID_JAVA_HOME, $env:JAVA_HOME)) {
        $resolved = Find-JavaHomeInRoot -RootPath $envHome -MaxDepth 2
        if ($resolved) { return $resolved }
    }

    # 2) 已经存在的共享工具链继续优先复用。
    $sharedCandidates = @(
        (Join-Path $ToolRoot ("Java\temurin-{0}\current" -f $JdkMajor)),
        (Join-Path $ToolRoot ("Java\jdk-{0}" -f $JdkMajor)),
        (Join-Path $ToolRoot ("JDK\{0}" -f $JdkMajor)),
        (Join-Path $ToolRoot ("jdk-{0}" -f $JdkMajor)),
        (Join-Path $ToolRoot "Java"),
        (Join-Path $ToolRoot "Language\Java"),
        (Join-Path $WorkRoot ("PyDroid\tools\jdk-{0}" -f $JdkMajor)),
        (Join-Path $WorkRoot ("tools\jdk-{0}" -f $JdkMajor))
    )
    foreach ($candidate in $sharedCandidates) {
        $resolved = Find-JavaHomeInRoot -RootPath $candidate -MaxDepth 2
        if ($resolved) { return $resolved }
    }

    # 3) Windows 已安装 JDK。Microsoft OpenJDK 的 JAVA_HOME 是可选安装项，
    #    所以即使环境变量没有配置，也必须主动检查注册表和常见安装目录。
    $systemCandidates = @()
    $systemCandidates += @(Get-JavaHomesFromRegistry)
    $systemCandidates += @(Get-JavaHomesFromCommonLocations)
    $systemCandidates += @(Get-JavaHomesFromPath)
    foreach ($candidate in @($systemCandidates | Select-Object -Unique)) {
        $resolved = Find-JavaHomeInRoot -RootPath $candidate -MaxDepth 1
        if ($resolved) { return $resolved }
    }

    return $null
}

function Install-Jdk {
    if ($SkipToolInstall) {
        throw "未找到 JDK $JdkMajor，且已指定 -SkipToolInstall。请安装兼容 JDK 后设置 JAVA_HOME/PYDROID_JAVA_HOME。"
    }
    Write-Step "未找到 JDK $JdkMajor，正在下载 Microsoft OpenJDK 到共享工具目录 $ToolRoot\Java\jdk-$JdkMajor ..."
    $zip = Join-Path $downloads ("microsoft-jdk-{0}-windows-x64.zip" -f $JdkMajor)
    if (-not (Test-Path -LiteralPath $zip)) {
        Invoke-Download -Uri ("https://aka.ms/download-jdk/microsoft-jdk-{0}-windows-x64.zip" -f $JdkMajor) -OutFile $zip
    }
    $temp = Join-Path $CacheRoot ".jdk-extract"
    if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $temp | Out-Null
    Expand-Archive -LiteralPath $zip -DestinationPath $temp -Force

    $inner = Get-ChildItem -LiteralPath $temp -Directory | Where-Object { Test-Path (Join-Path $_.FullName "bin\java.exe") } | Select-Object -First 1
    if (-not $inner) { throw "JDK 压缩包解压后未找到 java.exe。" }

    $dest = Join-Path $ToolRoot ("Java\jdk-{0}" -f $JdkMajor)
    New-Item -ItemType Directory -Force -Path (Split-Path $dest -Parent) | Out-Null
    if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
    Move-Item -LiteralPath $inner.FullName -Destination $dest
    Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
    if (-not (Test-JavaHome $dest)) { throw "JDK $JdkMajor 安装完成但版本检查失败：$dest" }
    return $dest
}

function Find-AndroidSdk {
    $candidates = @()
    if ($env:ANDROID_HOME) { $candidates += $env:ANDROID_HOME }
    if ($env:ANDROID_SDK_ROOT) { $candidates += $env:ANDROID_SDK_ROOT }
    $candidates += (Join-Path $ToolRoot "Android\Sdk")
    $candidates += (Join-Path $ToolRoot "Android")
    $candidates += (Join-Path $ToolRoot "android-sdk")
    if ($env:LOCALAPPDATA) { $candidates += (Join-Path $env:LOCALAPPDATA "Android\Sdk") }
    $candidates += @(
        (Join-Path $WorkRoot "tools\android-sdk"),
        (Join-Path $WorkRoot "PyDroid\tools\android-sdk")
    )
    foreach ($c in $candidates) {
        if (-not $c) { continue }
        if (Test-Path (Join-Path $c "platforms\android-$resolvedAndroidApi\android.jar")) {
            return $c
        }
    }
    # 有 SDK 根但缺 platform 36 时也返回，由 Install-AndroidSdk 补包
    foreach ($c in $candidates) {
        if (-not $c) { continue }
        if (Test-Path (Join-Path $c "cmdline-tools")) {
            return $c
        }
        if (Test-Path (Join-Path $c "platform-tools\adb.exe")) {
            return $c
        }
    }
    return $null
}

function Install-AndroidSdk {
    param([string]$SdkRoot)

    if ($SkipToolInstall) {
        throw "未找到 Android SDK（需要 platforms;android-$resolvedAndroidApi），且已指定 -SkipToolInstall。请安装后设置 ANDROID_HOME。"
    }
    if ([string]::IsNullOrWhiteSpace($SdkRoot)) {
        $SdkRoot = Join-Path $ToolRoot "Android\Sdk"
    }
    $sdkRoot = Resolve-AbsolutePath $SdkRoot
    Write-Step "正在准备 Android SDK：$sdkRoot ..."
    New-Item -ItemType Directory -Force -Path $sdkRoot | Out-Null

    $sdkManager = Find-ExistingFile @(
        (Join-Path $sdkRoot "cmdline-tools\latest\bin\sdkmanager.bat"),
        (Join-Path $sdkRoot "cmdline-tools\bin\sdkmanager.bat")
    )
    if (-not $sdkManager) {
        $zip = Find-ExistingFile @(
            (Join-Path $WorkRoot "PyDroid\tools\downloads\commandlinetools-win.zip"),
            (Join-Path $downloads "commandlinetools-win.zip")
        )
        if (-not $zip) {
            $zip = Join-Path $downloads "commandlinetools-win.zip"
            Write-Host "正在下载 Android commandline-tools ..."
            Invoke-Download -Uri "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip" -OutFile $zip
        }

        $temp = Join-Path $CacheRoot ".cmdline-tools-extract"
        if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Recurse -Force }
        New-Item -ItemType Directory -Force -Path $temp | Out-Null
        Expand-Archive -LiteralPath $zip -DestinationPath $temp -Force

        $cmdline = Join-Path $temp "cmdline-tools"
        if (-not (Test-Path -LiteralPath $cmdline)) {
            $cmdline = Get-ChildItem -LiteralPath $temp -Recurse -Directory -Filter "cmdline-tools" | Select-Object -First 1
        }
        if (-not $cmdline -or -not (Test-Path -LiteralPath (Join-Path $cmdline "bin\sdkmanager.bat"))) {
            throw "Android commandline-tools 解压后未找到 sdkmanager.bat。"
        }

        $latestDir = Join-Path $sdkRoot "cmdline-tools\latest"
        if (Test-Path -LiteralPath $latestDir) { Remove-Item -LiteralPath $latestDir -Recurse -Force }
        New-Item -ItemType Directory -Force -Path (Split-Path $latestDir -Parent) | Out-Null
        Move-Item -LiteralPath $cmdline -Destination $latestDir
        Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
    }

    # 预写许可证，避免 sdkmanager 交互卡住
    $licensesDir = Join-Path $sdkRoot "licenses"
    New-Item -ItemType Directory -Force -Path $licensesDir | Out-Null
    $licenseFiles = @{
        "android-sdk-license"         = "24333f8a63b6825ea9c5514f83c2829b004d1fee"
        "android-sdk-preview-license" = "84831b9409646a918e30573bab4c9c91346d8abd"
        "android-sdk-arm-dbt-license"  = "859f317696f67ef3d7f30a50a5560e7834b43903"
        "google-gdk-license"           = "33b6a2b64607f11b759f320ef9dff4ae5c47d97a"
    }
    foreach ($k in $licenseFiles.Keys) {
        $lf = Join-Path $licensesDir $k
        if (-not (Test-Path -LiteralPath $lf)) {
            Set-Content -LiteralPath $lf -Value $licenseFiles[$k] -Encoding ASCII
        }
    }

    if (-not $sdkManager) {
        $sdkManager = Join-Path $sdkRoot "cmdline-tools\latest\bin\sdkmanager.bat"
    }
    $packages = @("platform-tools", ("platforms;android-{0}" -f $resolvedAndroidApi), ("build-tools;{0}.0.0" -f $resolvedAndroidApi))
    Write-BuildStage -Percent $script:CurrentBuildStagePercent -Message "正在下载/安装 Android SDK 组件"
    Write-Step "通过 sdkmanager 安装：$($packages -join ', ')"
    $yes = (("y`n") * 40)
    $yes | & $sdkManager "--sdk_root=$sdkRoot" @packages
    if ($LASTEXITCODE -ne 0) {
        throw "Android SDK 包安装失败（退出码 $LASTEXITCODE）。"
    }

    if (-not (Test-Path (Join-Path $sdkRoot "platforms\android-$resolvedAndroidApi\android.jar"))) {
        throw "Android SDK platform $resolvedAndroidApi 仍未安装成功。"
    }
    return $sdkRoot
}

function Find-Python312 {
    if ($env:PYDROID_PYTHON_EXECUTABLE -and (Test-Path -LiteralPath $env:PYDROID_PYTHON_EXECUTABLE)) {
        return $env:PYDROID_PYTHON_EXECUTABLE
    }
    $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
    if (-not $pythonCommand) { $pythonCommand = Get-Command python -ErrorAction SilentlyContinue }
    if ($pythonCommand) {
        try {
            & $pythonCommand.Source -c "import sys; raise SystemExit(0 if sys.version_info[:2] == ($pythonMajor, $pythonMinor) else 1)"
            if ($LASTEXITCODE -eq 0) { return $pythonCommand.Source }
        } catch {}
    }
    $candidates = @(
        (Join-Path $ToolRoot ("Python\{0}\python.exe" -f $pythonSeries)),
        (Join-Path $ToolRoot "Python\python.exe"),
        (Join-Path $ToolRoot "Language\Python\python.exe"),
        (Join-Path $WorkRoot ("tools\{0}\python.exe" -f $pythonToolDirName))
    )
    foreach ($c in $candidates) {
        if (Test-Path -LiteralPath $c) {
            try {
                & $c -c "import sys; raise SystemExit(0 if sys.version_info[:2] == ($pythonMajor, $pythonMinor) else 1)"
                if ($LASTEXITCODE -eq 0) { return $c }
            } catch {
                # 继续找下一个
            }
        }
    }
    # 尝试 py 启动器
    try {
        $pyOutput = & py ("-{0}" -f $pythonSeries) -c "import sys; print(sys.executable)" 2>$null
        if ($LASTEXITCODE -eq 0 -and $pyOutput) {
            $p = ($pyOutput | Select-Object -Last 1).Trim()
            if (Test-Path -LiteralPath $p) { return $p }
        }
    } catch {
        # 忽略
    }
    return $null
}

function Install-Python312 {
    if ($SkipToolInstall) {
        throw "未找到 Python $pythonSeries（完整版），且已指定 -SkipToolInstall。请安装后设置 PYDROID_PYTHON_EXECUTABLE。"
    }
    Write-Step "未找到完整版 Python $pythonSeries，正在安装到共享工具目录 $ToolRoot\Python\$pythonSeries ..."
    $installer = Join-Path $downloads ("python-{0}-amd64.exe" -f $PythonVersion)
    if (-not (Test-Path -LiteralPath $installer)) {
        Invoke-Download -Uri ("https://www.python.org/ftp/python/{0}/python-{0}-amd64.exe" -f $PythonVersion) -OutFile $installer
    }
    $dest = Join-Path $ToolRoot ("Python\{0}" -f $pythonSeries)
    $installerArgs = @(
        "/quiet",
        "InstallAllUsers=0",
        "PrependPath=0",
        "Include_launcher=0",
        "Include_test=0",
        "Include_doc=0",
        "Include_debug=0",
        "Include_dev=0",
        "Shortcuts=0",
        ('TargetDir="{0}"' -f $dest)
    )
    $proc = Start-Process -FilePath $installer -ArgumentList $installerArgs -Wait -PassThru
    if ($proc.ExitCode -ne 0 -or -not (Test-Path (Join-Path $dest "python.exe"))) {
        throw "Python $pythonSeries 安装失败。"
    }
    return (Join-Path $dest "python.exe")
}

# ---------------------------------------------------------------
# 工作区同步 / 清理
# ---------------------------------------------------------------

function Sync-Source {
    Write-BuildStage -Percent 15 -Message "清理临时工作区旧构建缓存"
    Write-Step "清理临时工作区旧构建缓存（静默）..."
    $transientDirs = @(
        "android\.gradle",
        "android\app\build",
        "android\build",
        "android\capacitor-cordova-android-plugins\build",
        "release", "dist", "dist-desktop", "temp", ".vite", ".pytest_cache"
    )
    foreach ($relative in $transientDirs) {
        $full = Join-Path $workspace $relative
        if (Test-Path -LiteralPath $full) {
            Remove-Item -LiteralPath $full -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    Write-BuildStage -Percent 20 -Message "同步项目源码到临时工作区"
    Write-Step "同步项目源码到临时工作区：$workspace"
    $excludeDirs = @(
        ".git", ".idea", ".vscode", "node_modules", ".tools",
        "dist", "dist-desktop", "release", "temp", ".vite", ".pytest_cache",
        "android\.gradle", "android\app\build", "android\build",
        "android\capacitor-cordova-android-plugins\build"
    )
    $excludeFiles = @("*.log", "*.tsbuildinfo", "local.properties", "desktop-python.json")
    $robocopyArgs = @(
        $ProjectRoot, $workspace, "/MIR",
        "/XD", $excludeDirs,
        "/XF", $excludeFiles,
        "/NFL", "/NDL", "/NJH", "/NJS", "/NP", "/NS", "/NC"
    )
    # robocopy may enumerate thousands of stale Android/Python build products as EXTRA.
    # Suppress the raw listing here; the GUI already shows the explicit sync stage.
    & robocopy @robocopyArgs | Out-Null
    $robocopyExitCode = $LASTEXITCODE
    if ($robocopyExitCode -ge 8) {
        throw "源码同步失败，robocopy 退出码 $robocopyExitCode。"
    }
}

function Patch-WorkspaceDesktopPackage {
    # 仅修补临时工作区，不修改源码目录。兼容两类历史问题：
    # 1) Electron/electron-builder 缓存被写入项目内部；
    # 2) 旧脚本把 native pnpm.exe 当作 JavaScript 交给 node.exe 执行。
    $file = Join-Path $workspace "scripts\desktop-package.mjs"
    if (-not (Test-Path -LiteralPath $file)) { return }
    $content = Get-Content -LiteralPath $file -Raw
    $original = $content

    $content = [regex]::Replace($content, 'const\s+cache\s*=\s*path\.join\(root,\s*["'']\.tools["''],\s*["'']electron-builder-cache["'']\)\s*;', 'const cache = process.env.ELECTRON_BUILDER_CACHE || path.join(root, ".tools", "electron-builder-cache");')
    $content = [regex]::Replace($content, 'ELECTRON_CACHE:\s*path\.join\(root,\s*["'']\.tools["''],\s*["'']electron-cache["'']\),', 'ELECTRON_CACHE: process.env.ELECTRON_CACHE || path.join(root, ".tools", "electron-cache"),')

    if ($content -match 'args:\s*\[process\.env\.npm_execpath,\s*\.\.\.args\]') {
        $safeInvocation = @'
function packageManagerInvocation(args) {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && fs.existsSync(npmExecPath)) {
    const lower = npmExecPath.toLowerCase();
    if (/\.(?:js|cjs|mjs)$/.test(lower)) {
      return {
        command: process.env.npm_node_execpath || process.execPath,
        args: [npmExecPath, ...args],
        shell: false,
      };
    }
    if (/\.(?:cmd|bat)$/.test(lower)) {
      return { command: npmExecPath, args, shell: process.platform === "win32" };
    }
    return { command: npmExecPath, args, shell: false };
  }
  return {
    command: process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    args,
    shell: process.platform === "win32",
  };
}
'@
        $legacyPattern = '(?ms)^function\s+packageManagerInvocation\(args\)\s*\{.*?^\}'
        $patched = [regex]::Replace($content, $legacyPattern, $safeInvocation.TrimEnd(), 1)
        if ($patched -eq $content) {
            throw "检测到旧版 pnpm.exe 调用逻辑，但无法安全修补 desktop-package.mjs。请更新项目的 desktop-package.mjs。"
        }
        $content = $patched
    }

    if ($content -ne $original) {
        [System.IO.File]::WriteAllText($file, $content, (New-Object System.Text.UTF8Encoding($false)))
        Write-Host "已修补工作区 desktop-package.mjs：共享 Electron 缓存 / native pnpm launcher 兼容。" -ForegroundColor DarkYellow
    }

    # 清除工作区内旧缓存残留，真正缓存统一由 CacheRoot 管理。
    foreach ($oldCache in @(
        (Join-Path $workspace ".tools\electron-builder-cache"),
        (Join-Path $workspace ".tools\electron-cache")
    )) {
        if (Test-Path -LiteralPath $oldCache) {
            Remove-Item -LiteralPath $oldCache -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

function Patch-WorkspaceAndroidPackage {
    # 当前机器上 Gradle daemon 启动可能被安全软件拦截（CreateProcess error=5）。
    # 改用 --no-daemon + 匹配的 GRADLE_OPTS，可以稳定绕开 daemon 启动问题。
    $file = Join-Path $workspace "scripts\android-package.ps1"
    if (-not (Test-Path -LiteralPath $file)) { return }
    $content = Get-Content -LiteralPath $file -Raw
    if ($content -match "--no-daemon") { return }

    $content = $content -replace '\.\\gradlew\.bat assembleDebug --no-watch-fs', '.\gradlew.bat assembleDebug --no-watch-fs --no-daemon'
    [System.IO.File]::WriteAllText($file, $content, (New-Object System.Text.UTF8Encoding($true)))
    Write-Host "已修补工作区 android-package.ps1：Gradle 使用 --no-daemon 构建。" -ForegroundColor DarkYellow
}

function Clear-WorkspaceOutputs {
    Write-Step "清理工作区中的构建产物：$workspace"
    $paths = @(
        "release", "dist", "dist-desktop", "temp",
        "android\app\build", "android\build",
        "android\capacitor-cordova-android-plugins\build"
    )
    foreach ($p in $paths) {
        $full = Join-Path $workspace $p
        if (Test-Path -LiteralPath $full) {
            Remove-Item -LiteralPath $full -Recurse -Force
        }
    }
}

function Ensure-PythonRuntimeForDesktop {
    $runtimeLink = Join-Path $workspace ".tools\python312-runtime"
    $runtimeTarget = Join-Path $ToolRoot "Python\runtime-3.12"
    if (Test-Path -LiteralPath (Join-Path $runtimeLink "python.exe")) {
        Write-Step "复用 Python 便携运行时：$runtimeTarget"
        return
    }
    Write-BuildStage -Percent 48 -Message "首次准备桌面 Python 3.12 运行时（可能需要联网下载）"
    Write-Step "准备桌面版所需的 Python 3.12 便携运行时 ..."
    New-Item -ItemType Directory -Force -Path (Join-Path $workspace ".tools") | Out-Null
    New-Item -ItemType Directory -Force -Path $runtimeTarget | Out-Null
    if (-not (Test-Path -LiteralPath $runtimeLink)) {
        New-Item -ItemType Junction -Path $runtimeLink -Target $runtimeTarget | Out-Null
    } else {
        $item = Get-Item -LiteralPath $runtimeLink -Force
        if ($item.LinkType -ne "Junction") {
            Write-Warning "$runtimeLink 已存在但不是目录联接，将使用工作区本地运行时。"
            $runtimeTarget = $runtimeLink
        }
    }
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $workspace "scripts\setup-windows.ps1")
    if ($LASTEXITCODE -ne 0) {
        throw "Python 便携运行时初始化失败。"
    }
}

# ---------------------------------------------------------------
# 构建步骤
# ---------------------------------------------------------------

function Invoke-DesktopCompatibilityPackage {
    Write-Warning "常规 desktop:package 失败，尝试兼容打包。"
    Invoke-Pnpm @("desktop:build")

    $rendererSource = Join-Path $workspace "dist-desktop"
    $rendererStage = Join-Path $workspace "desktop\package-renderer"
    if (-not (Test-Path -LiteralPath (Join-Path $rendererSource "index.html"))) {
        throw "兼容打包失败：dist-desktop\index.html 不存在。"
    }
    if (Test-Path -LiteralPath $rendererStage) {
        Remove-Item -LiteralPath $rendererStage -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $rendererStage | Out-Null
    Copy-Item -Path (Join-Path $rendererSource "*") -Destination $rendererStage -Recurse -Force

    try {
        $partialRelease = Join-Path $workspace "release\win-unpacked"
        Remove-Item -LiteralPath $partialRelease -Recurse -Force -ErrorAction SilentlyContinue

        $resourcePreservingSucceeded = $false
        try {
            Write-Warning "先尝试仅关闭 Windows 代码签名，保留 exe 图标和元数据。"
            Invoke-Pnpm @(
                "exec", "electron-builder", "--win", "dir",
                "--config.win.signExecutable=false"
            )
            $resourcePreservingSucceeded = $true
        } catch {
            Write-Warning "关闭签名后仍失败：$($_.Exception.Message)"
        }

        if (-not $resourcePreservingSucceeded) {
            Remove-Item -LiteralPath $partialRelease -Recurse -Force -ErrorAction SilentlyContinue
            Write-Warning "最后尝试跳过 exe 资源编辑；此模式可能使用 Electron 默认图标/元数据。"
            Invoke-Pnpm @(
                "exec", "electron-builder", "--win", "dir",
                "--config.win.signAndEditExecutable=false",
                "--config.win.signExecutable=false"
            )
        }

        $unpacked = Join-Path $workspace "release\win-unpacked"
        $exe = Get-ChildItem -LiteralPath $unpacked -Filter "*.exe" -File -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $exe) { throw "兼容打包完成但未找到 win-unpacked\*.exe。" }

        $smokeLog = Join-Path $workspace "release\desktop-package-smoke.log"
        Remove-Item -LiteralPath $smokeLog -Force -ErrorAction SilentlyContinue
        $oldSmoke = $env:PYDROID_DESKTOP_SMOKE
        $oldSmokeLog = $env:PYDROID_DESKTOP_SMOKE_LOG
        try {
            $env:PYDROID_DESKTOP_SMOKE = "1"
            $env:PYDROID_DESKTOP_SMOKE_LOG = $smokeLog
            $smokeProcess = Start-Process -FilePath $exe.FullName -PassThru
            if (-not $smokeProcess.WaitForExit(120000)) {
                try { & taskkill.exe /PID $smokeProcess.Id /T /F | Out-Null } catch {}
                throw "兼容打包 smoke test 超时。"
            }
            if ($smokeProcess.ExitCode -ne 0) { throw "兼容打包 smoke test 退出码 $($smokeProcess.ExitCode)。" }
        } finally {
            $env:PYDROID_DESKTOP_SMOKE = $oldSmoke
            $env:PYDROID_DESKTOP_SMOKE_LOG = $oldSmokeLog
        }
        if (-not (Test-Path -LiteralPath $smokeLog) -or (Get-Content -LiteralPath $smokeLog -Raw).Trim() -ne "passed") {
            throw "兼容打包 smoke test 未报告 passed。"
        }
        if ($resourcePreservingSucceeded) {
            Write-Host "兼容打包成功：已关闭代码签名，但保留 exe 资源编辑，smoke test 已通过。" -ForegroundColor DarkYellow
        } else {
            Write-Host "兼容打包成功：使用无 exe 资源编辑模式，smoke test 已通过。" -ForegroundColor DarkYellow
        }
    } finally {
        Remove-Item -LiteralPath $rendererStage -Recurse -Force -ErrorAction SilentlyContinue
    }
}
function Build-Desktop {
    Write-BuildStage -Percent 48 -Message "准备 Windows Desktop 构建环境"
    Write-Step "构建未压缩桌面版（win-unpacked）..."
    Ensure-PythonRuntimeForDesktop
    # Electron/electron-builder 版本仍由各项目 package.json 决定，二进制缓存跨项目共享。
    $env:ELECTRON_CACHE = $electronCache
    $env:ELECTRON_BUILDER_CACHE = $electronBuilderCache
    $env:PYDROID_DESKTOP_PACKAGE_RETRIES = [string][Math]::Max(1, $DownloadRetryCount)
    $env:PYDROID_DESKTOP_PLAIN_EXE_FALLBACK = "1"
    if ($ElectronMirror) { $env:ELECTRON_MIRROR = $ElectronMirror }
    if ($ElectronBuilderMirror) { $env:ELECTRON_BUILDER_BINARIES_MIRROR = $ElectronBuilderMirror }
    New-Item -ItemType Directory -Force -Path $env:ELECTRON_CACHE | Out-Null
    New-Item -ItemType Directory -Force -Path $env:ELECTRON_BUILDER_CACHE | Out-Null

    Write-BuildStage -Percent 55 -Message "构建 Windows Desktop"
    $desktopPackageFile = Join-Path $workspace "scripts\desktop-package.mjs"
    $packageScriptHandlesRetry = $false
    if (Test-Path -LiteralPath $desktopPackageFile) {
        $packageScriptHandlesRetry = (Get-Content -LiteralPath $desktopPackageFile -Raw) -match "PYDROID_DESKTOP_PACKAGE_RETRIES"
    }
    $outerAttempts = if ($packageScriptHandlesRetry) { 1 } else { [Math]::Max(1, $DownloadRetryCount) }
    $packaged = $false
    for ($attempt = 1; $attempt -le $outerAttempts; $attempt++) {
        try {
            if ($attempt -gt 1) { Write-Warning "desktop:package 重试 $attempt/$outerAttempts ..." }
            Invoke-Pnpm @("desktop:package")
            $packaged = $true
            break
        } catch {
            if ($attempt -ge $outerAttempts) {
                Write-Warning $_.Exception.Message
            } else {
                Start-Sleep -Seconds ([Math]::Min(8, 2 * $attempt))
            }
        }
    }
    if (-not $packaged) {
        Invoke-DesktopCompatibilityPackage
    }

    $unpacked = Join-Path $workspace "release\win-unpacked"
    if (-not (Test-Path -LiteralPath $unpacked) -or -not (Get-ChildItem -LiteralPath $unpacked -Filter "*.exe" -File -ErrorAction SilentlyContinue)) {
        throw "桌面版构建完成但未找到 release\win-unpacked\*.exe。"
    }
}

function Build-Android {
    Write-BuildStage -Percent 68 -Message "检查 Android JDK、SDK 与 Python 3.12"
    Write-Step "构建 Android debug APK ..."
    $jdk = Find-JavaHome
    if (-not $jdk) { $jdk = Install-Jdk }
    Write-Step ("JDK {0}：{1}" -f $JdkMajor, $jdk)
    # sdkmanager 本身就需要 Java，因此必须在准备/补齐 Android SDK 之前启用刚找到的 JDK。
    $env:JAVA_HOME = $jdk
    $env:Path = "$(Join-Path $jdk 'bin');$env:Path"

    $sdk = Find-AndroidSdk
    if (-not $sdk -or -not (Test-Path (Join-Path $sdk "platforms\android-$resolvedAndroidApi\android.jar"))) {
        $sdk = Install-AndroidSdk -SdkRoot $sdk
    }
    $python = Find-Python312
    if (-not $python) { $python = Install-Python312 }

    $env:JAVA_HOME = $jdk
    $env:ANDROID_HOME = $sdk
    $env:ANDROID_SDK_ROOT = $sdk
    $env:GRADLE_USER_HOME = $gradleHome
    $env:PYDROID_PYTHON_EXECUTABLE = $python
    # 与 --no-daemon 配合，避免 Gradle 因 JVM 参数不一致再 fork 单次 daemon
    $env:GRADLE_OPTS = "-Xmx1536m"

    # 停止旧的 Gradle daemon，避免因旧 daemon 使用不同的 JAVA_HOME
    # 导致新 daemon 启动时 CreateProcess error=5（拒绝访问）。
    Write-BuildStage -Percent 78 -Message "准备 Android Gradle 构建"
    Write-Step "停止旧的 Gradle daemon，确保 Android 构建使用当前 JDK ..."
    Push-Location (Join-Path $workspace "android")
    try {
        & .\gradlew.bat --stop 2>$null
    } catch {
        Write-Warning "Gradle daemon 停止失败（可忽略）：$($_.Exception.Message)"
    } finally {
        Pop-Location
    }

    Write-BuildStage -Percent 82 -Message "编译 Android APK"
    Invoke-Pnpm @("android:package")

    $apk = Join-Path $workspace "android\app\build\outputs\apk\debug\app-debug.apk"
    if (-not (Test-Path -LiteralPath $apk)) {
        throw "Android 构建完成但未找到 app-debug.apk。"
    }
    return $apk
}

function Copy-Outputs {
    param(
        [string]$ApkSource,
        [switch]$HasApk,
        [switch]$HasDesktop
    )

    Write-BuildStage -Percent 90 -Message "整理并复制最终构建产物"
    New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null

    if (-not $KeepHistory) {
        if ($HasApk) {
            Write-Step "清理输出目录中的旧版 $outputBaseName APK（只保留最新一份）..."
            Get-ChildItem -LiteralPath $OutputRoot -Filter "$outputBaseName-*.apk" -File -ErrorAction SilentlyContinue |
                Remove-Item -Force -ErrorAction SilentlyContinue
        }
        if ($HasDesktop) {
            Write-Step "清理输出目录中的旧版 $outputBaseName Desktop（只保留最新一份）..."
            Get-ChildItem -LiteralPath $OutputRoot -Directory -Filter "$outputBaseName-*-Desktop" -ErrorAction SilentlyContinue |
                Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    $desktopDest = $null
    $apkDest = $null

    if ($HasApk) {
        $apkDest = Join-Path $OutputRoot "$outputBaseName-$version.apk"
        Write-Step "复制 APK 到 $apkDest"
        Copy-Item -LiteralPath $ApkSource -Destination $apkDest -Force
    }

    if ($HasDesktop) {
        $desktopDest = Join-Path $OutputRoot "$outputBaseName-$version-Desktop"
        Write-Step "复制未压缩桌面版到 $desktopDest"
        if (Test-Path -LiteralPath $desktopDest) {
            Remove-Item -LiteralPath $desktopDest -Recurse -Force
        }
        $unpacked = Join-Path $workspace "release\win-unpacked"
        $robocopyArgs = @($unpacked, $desktopDest, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NP")
        & robocopy @robocopyArgs
        Test-NativeSuccess
    }

    Write-Host ""
    Write-Host "==================== 构建完成 ====================" -ForegroundColor Green
    Write-Host "版本：$version"
    if ($HasApk)    { Write-Host "APK：$apkDest" -ForegroundColor Yellow }
    if ($HasDesktop) { Write-Host "桌面版：$desktopDest" -ForegroundColor Yellow }
    Write-Host "工作区：$workspace（已清理打包产物）"
    Write-Host "==================================================" -ForegroundColor Green
}

# ---------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------

Write-BuildStage -Percent 2 -Message "读取项目与构建配置"
Write-Step "项目：$ProjectRoot"
Write-Step "版本：$version"
if ($packageManagerSpec -or $electronSpec -or $electronBuilderSpec) {
    Write-Step "项目工具链约束"
    if ($packageManagerSpec) { Write-Host "packageManager：$packageManagerSpec" }
    if ($electronSpec) {
        $lockedText = if ($electronLockedVersion) { "；lockfile=$electronLockedVersion" } else { "" }
        Write-Host "Electron：package.json=$electronSpec$lockedText"
    }
    if ($electronBuilderSpec) {
        $lockedText = if ($electronBuilderLockedVersion) { "；lockfile=$electronBuilderLockedVersion" } else { "" }
        Write-Host "electron-builder：package.json=$electronBuilderSpec$lockedText"
    }
}
Write-Step "共享工具目录：$ToolRoot"
Write-Step "共享缓存目录：$CacheRoot"
Write-Step "工作目录：$WorkRoot"
Write-Step "最终输出目录：$OutputRoot"
Write-Step "Android compile SDK：$resolvedAndroidApi"
Write-Step "下载重试次数：$DownloadRetryCount"
Write-Step "网络模式：$NetworkMode"

# Node / pnpm
Write-BuildStage -Percent 8 -Message "检查 Node、pnpm 与网络配置"
$script:NodeDir = Find-Node
if (-not $script:NodeDir) {
    $script:NodeDir = Install-Node
}
# 先把共享 Node 放到 PATH，再探测 pnpm/corepack，避免系统中其它 Node 目录抢占。
$env:Path = "$script:NodeDir;$ToolRoot\NodeJs;$ToolRoot\NodeJS;$env:Path"
$script:PnpmCommand = Find-Pnpm
if (-not $script:PnpmCommand) {
    if ($SkipToolInstall) {
        throw "未找到 pnpm/corepack，且已指定 -SkipToolInstall。"
    }
    Write-Step "未找到 pnpm，使用 corepack 启用 pnpm ..."
    $corepack = Find-ExistingFile @(
        (Join-Path $script:NodeDir "corepack.cmd"),
        (Join-Path $ToolRoot "NodeJS\corepack.cmd")
    )
    if (-not $corepack) {
        throw "Node.js 目录中未找到 corepack.cmd，无法自动启用 pnpm。"
    }
    $script:PnpmCommand = $corepack
    $script:PnpmUseCorepack = $true
}

$env:npm_config_cache = $npmCache
$env:PNPM_STORE_DIR = $storeDir
$env:COREPACK_HOME = $corepackCache
$env:ELECTRON_CACHE = $electronCache
$env:ELECTRON_BUILDER_CACHE = $electronBuilderCache
$env:GRADLE_USER_HOME = $gradleHome

# 配置代理/超时/并发。必须在 pnpm/corepack 和后续 Electron 下载之前完成。
Configure-Network

$nodeExe = Join-Path $script:NodeDir 'node.exe'
$actualNodeVersion = $null
try { $actualNodeVersion = [string]((& $nodeExe --version | Select-Object -Last 1).Trim()) } catch {}
$actualPnpmVersion = Get-PnpmVersion
Write-Step "实际构建工具"
if ($actualNodeVersion) { Write-Host "Node：$actualNodeVersion（$nodeExe）" } else { Write-Host "Node：$nodeExe" }
if ($actualPnpmVersion) { Write-Host "pnpm：$actualPnpmVersion（$script:PnpmCommand）" } else { Write-Host "pnpm：$script:PnpmCommand" }
if ($packageManagerSpec -match '^pnpm@([^+]+)' -and $actualPnpmVersion) {
    $expectedPnpmVersion = $matches[1]
    if ($expectedPnpmVersion -ne $actualPnpmVersion) {
        Write-Warning "项目声明 packageManager=$packageManagerSpec，但当前 pnpm=$actualPnpmVersion。构建会继续；若 lockfile 不兼容，建议通过 Corepack/共享工具链使用项目声明版本。"
    }
}

# 同步源码到工作区
Sync-Source

# 修补工作区内的桌面打包脚本，使 electron-builder 缓存位于项目外部
Patch-WorkspaceDesktopPackage

# 修补工作区内的 Android 打包脚本，使用 --no-daemon 避免 daemon 启动被拦截
Patch-WorkspaceAndroidPackage

# 安装 JS 依赖（使用外部 pnpm store，避免重复下载；网络失败时整次安装可重试）
Write-BuildStage -Percent 30 -Message "检查/更新 JS 依赖（本地缓存优先，缺失时才联网）"
Write-Step "安装/更新 JS 依赖（pnpm install --frozen-lockfile --prefer-offline）..."
$installArgs = @("install", "--frozen-lockfile", "--prefer-offline", "--store-dir", $storeDir)
if ($RegistryUrl) { $installArgs += @("--registry", $RegistryUrl) }
$installAttempts = [Math]::Max(1, $DownloadRetryCount)
$installSucceeded = $false
for ($installAttempt = 1; $installAttempt -le $installAttempts; $installAttempt++) {
    try {
        Write-Host ("pnpm install [{0}/{1}]" -f $installAttempt, $installAttempts) -ForegroundColor DarkGray
        Invoke-Pnpm $installArgs
        $installSucceeded = $true
        break
    } catch {
        if ($installAttempt -ge $installAttempts) {
            $effectiveProxy = if ($script:ResolvedProxyUrl) { $script:ResolvedProxyUrl } else { "<direct>" }
            throw ("pnpm install 连续 {0} 次失败。当前网络模式={1}，代理={2}，timeout={3}s，concurrency={4}。最后错误：{5}" -f $installAttempts, $NetworkMode, $effectiveProxy, $PnpmFetchTimeoutSeconds, $PnpmNetworkConcurrency, $_.Exception.Message)
        }
        Write-Warning ("pnpm install 失败：{0}。保留已下载到 store 的内容，稍后重试。" -f $_.Exception.Message)
        Start-Sleep -Seconds ([Math]::Min(15, 3 * $installAttempt))
    }
}
if (-not $installSucceeded) { throw "pnpm install 未完成。" }

# 构建前清理一次，避免旧产物干扰
Write-BuildStage -Percent 40 -Message "清理旧构建产物"
Clear-WorkspaceOutputs

$apkSource = $null
$hasApk = -not $SkipAndroid
$hasDesktop = -not $SkipDesktop

if ($hasDesktop) {
    Build-Desktop
}

if ($hasApk) {
    $apkSource = Build-Android
}

Copy-Outputs -ApkSource $apkSource -HasApk:$hasApk -HasDesktop:$hasDesktop

# 构建后默认清理临时打包产物；需要排查问题时可使用 -KeepWorkspace。
if (-not $KeepWorkspace) {
    Write-BuildStage -Percent 97 -Message "清理临时构建产物"
    Clear-WorkspaceOutputs
} else {
    Write-Host "保留工作区用于排查：$workspace" -ForegroundColor DarkYellow
}

Write-BuildStage -Percent 100 -Message "构建完成"
Write-Host ""
Write-Host "提示：如需查看脚本帮助，运行：" -ForegroundColor DarkGray
Write-Host "  powershell -ExecutionPolicy Bypass -File "$PSCommandPath" -?" -ForegroundColor DarkGray
