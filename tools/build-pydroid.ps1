<#
.SYNOPSIS
    构建 PyDroid Flow：Android debug APK + Windows 未压缩桌面版（win-unpacked），只读复用 DK 共享工具链，并将写入集中到独立临时目录/缓存。

.DESCRIPTION
    - 项目源码目录保持只读，脚本只读取项目，不写入任何项目文件。
    - 脚本把源码同步到 $WorkRoot\builds\<项目名> 临时工作区，在外部完成构建。
    - 自动探测已安装工具，并只读复用 DK_TOOL_ROOT/ToolRoot；缺失工具安装到 WorkRoot 下的 PyDroid 临时工具目录。
    - JDK 探测兼容 Windows PowerShell 5.1：独立读取 java/javac 版本输出，并同时识别 JAVA_HOME、bin、java.exe、javac.exe 与 PATH。
    - 最终产物平铺到 $OutputRoot：
          <productName>-<版本>.apk
          <productName>-<版本>-Desktop\    （win-unpacked 未压缩桌面版）
    - 构建完成后会清理 release/dist 等可再生打包产物；Android Gradle/增量构建缓存
      默认保留以加速后续构建，使用 -CleanBuild 可执行完整清理。

.PARAMETER ProjectRoot
    项目源码根目录。缺省时使用当前目录（要求当前目录含 package.json）。

.PARAMETER ToolRoot
    跨项目共享工具根目录（只读）。优先 DK_TOOL_ROOT，其次 PYDROID_TOOL_ROOT；当前机器可自动复用 D:\Code。构建器不会向此目录写入、安装或更新任何文件。

.PARAMETER CacheRoot
    构建缓存目录。默认读取 DK_CACHE_ROOT；否则使用 WorkRoot\cache。用于 pnpm store、npm、Electron、electron-builder、Gradle 与下载缓存；不会默认落到 ToolRoot。

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
    构建结束后保留 release/dist 等临时打包产物，便于排查问题。
    Android 的 Gradle/增量构建缓存默认跨构建保留，以提高后续编译速度。

.PARAMETER CleanBuild
    执行完整清理构建。启用后会删除 android\.gradle、android\app\build、
    android\build 和 capacitor-cordova-android-plugins\build。
    默认不删除这些目录，以复用 Gradle 增量构建缓存。

.PARAMETER DisableGradleDaemon
    禁用 Gradle daemon。默认启用并复用 daemon；仅当安全软件或系统策略明确阻止
    Gradle daemon 启动时才建议使用此开关。

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
        -CacheRoot "D:\PyDroidTemp" `
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
    [switch]$CleanBuild,
    [switch]$DisableGradleDaemon,
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

$script:BuildScriptRevision = "1.4.33-dev-r9-phase4-queue-indicator"

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
$pythonPinnedInstallerVersion = "3.13.14"
$pythonPinnedInstallerSha256 = "C54D9B9BBB8A36E6489363DDD01139707FD781D72F1F9E90C7EC65D0061368E0"
$pythonNuGetPackageId = "python"
$pythonNuGetPackageVersion = $pythonPinnedInstallerVersion
$requiredPythonSeries = "3.13"
if (-not $PythonVersion) { $PythonVersion = if ($env:PYDROID_PYTHON_VERSION) { $env:PYDROID_PYTHON_VERSION } else { $requiredPythonSeries } }
$requestedPythonVersion = ([string]$PythonVersion).Trim()
$requestedPythonParts = $requestedPythonVersion.Split(".")
$requestedPythonSeries = $null
if ($requestedPythonParts.Count -ge 2) {
    $requestedMajor = 0
    $requestedMinor = 0
    if ([int]::TryParse($requestedPythonParts[0], [ref]$requestedMajor) -and [int]::TryParse($requestedPythonParts[1], [ref]$requestedMinor)) {
        $requestedPythonSeries = ("{0}.{1}" -f $requestedMajor, $requestedMinor)
    }
}
if ($requestedPythonSeries -ne $requiredPythonSeries) {
    Write-Warning ("检测到旧版或不兼容的 PythonVersion={0}；当前 PyDroid Android/Chaquopy 固定使用 Python {1}，已自动迁移。" -f $requestedPythonVersion, $requiredPythonSeries)
}
# PythonVersion is a compatibility-series setting, not an installer filename. Always
# normalize legacy GUI/environment values (for example 3.12 or 3.13.14) to 3.13.
$PythonVersion = $requiredPythonSeries
$pythonMajor = 3
$pythonMinor = 13
$pythonSeries = $requiredPythonSeries
$pythonToolDirName = "python313"
# PythonSeries is the compatibility requirement. Auto-install is pinned independently
# so stored values such as "3.13" or "3.13.x" can never become a download URL directly.
$pythonInstallerVersion = $pythonPinnedInstallerVersion

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

# ToolRoot is strictly read-only. If an old configuration points CacheRoot into ToolRoot,
# move caches to WorkRoot instead of writing into the shared tool tree.
if ((Test-PathWithinRoot -Path $CacheRoot -Root $ToolRoot) -and
    -not (Test-PathWithinRoot -Path $ToolRoot -Root $WorkRoot)) {
    $oldCacheRoot = $CacheRoot
    $CacheRoot = Resolve-AbsolutePath (Join-Path $WorkRoot "cache")
    Write-Warning ("缓存目录 {0} 位于只读共享工具目录 {1} 内，已改用临时缓存：{2}" -f $oldCacheRoot, $ToolRoot, $CacheRoot)
}

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

$privateToolsRoot = Join-Path $WorkRoot "tools\$projectKey"
$workspace = Join-Path $WorkRoot "builds\$projectKey"
$projectPrefix = $ProjectRoot.TrimEnd([char[]]'\/') + [IO.Path]::DirectorySeparatorChar
$workspaceFull = [IO.Path]::GetFullPath($workspace)
if ($workspaceFull.StartsWith($projectPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "工作区不能位于项目源码目录内部：$workspaceFull"
}
$downloads = Join-Path $CacheRoot "downloads"
$storeDir  = Join-Path $CacheRoot "pnpm-store"
$gradleHome = Join-Path (Join-Path $CacheRoot "gradle") $projectKey
$electronCache = Join-Path $CacheRoot "electron"
$electronBuilderCache = Join-Path $CacheRoot "electron-builder"
$npmCache = Join-Path $CacheRoot "npm"
$corepackCache = Join-Path $CacheRoot "corepack"

foreach ($d in @($CacheRoot, $WorkRoot, $OutputRoot, $privateToolsRoot, $workspace, $downloads, $storeDir, $gradleHome, $electronCache, $electronBuilderCache, $npmCache, $corepackCache)) {
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

function Test-NodeCandidate {
    param([Parameter(Mandatory = $true)][string]$Executable)

    if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { return $false }
    try {
        $raw = [string]((& $Executable --version | Select-Object -Last 1)).Trim()
        $actualText = $raw.TrimStart("v")
        $requiredText = ([string]$NodeVersion).Trim().TrimStart("v")
        $actual = New-Object System.Version($actualText)
        $required = New-Object System.Version($requiredText)
        return ($actual.Major -eq $required.Major -and $actual -ge $required)
    } catch {
        return $false
    }
}

function Find-Node {
    if ($env:PYDROID_NODE_EXECUTABLE -and (Test-Path -LiteralPath $env:PYDROID_NODE_EXECUTABLE)) {
        if (Test-NodeCandidate -Executable $env:PYDROID_NODE_EXECUTABLE) {
            return (Split-Path $env:PYDROID_NODE_EXECUTABLE -Parent)
        }
        Write-Warning ("忽略 PYDROID_NODE_EXECUTABLE={0}：版本低于项目要求 Node {1}，或版本无法识别。" -f $env:PYDROID_NODE_EXECUTABLE, $NodeVersion)
    }

    # 用户选择的共享工具根目录优先，但必须满足项目声明的最低 Node 版本。
    $candidates = @(
        (Join-Path $ToolRoot "NodeJs"),
        (Join-Path $ToolRoot "NodeJS"),
        (Join-Path $ToolRoot "Language\NodeJS"),
        (Join-Path $WorkRoot "tools\nodejs"),
        (Join-Path $WorkRoot "tools\node")
    )
    foreach ($c in $candidates) {
        $exe = Join-Path $c "node.exe"
        if (Test-NodeCandidate -Executable $exe) { return $c }
        if (Test-Path -LiteralPath $exe -PathType Leaf) {
            try {
                $foundVersion = [string]((& $exe --version | Select-Object -Last 1)).Trim()
                Write-Warning ("跳过 Node {0}（{1}）：项目要求同一主版本且不低于 {2}。" -f $foundVersion, $exe, $NodeVersion)
            } catch {}
        }
    }

    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source -and (Test-NodeCandidate -Executable $cmd.Source)) {
        return (Split-Path $cmd.Source -Parent)
    }
    return $null
}

function Install-Node {
    if ($SkipToolInstall) {
        throw "未找到满足版本要求的 Node.js，且已指定 -SkipToolInstall。项目需要 Node $NodeVersion 或同一主版本的更高版本。"
    }
    Write-Step "未找到满足版本要求的 Node.js，正在下载 Node.js $NodeVersion 到临时工具目录 $privateToolsRoot\NodeJs ..."
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

    $dest = Join-Path $privateToolsRoot "NodeJs"
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
        # 关键：原生命令 stdout 不能直接留在 PowerShell 成功输出流中。
        # Build-Android 等函数需要返回路径；若 pnpm 的 [WARN]/构建日志混入成功输出流，
        # PowerShell 会把“日志 + 路径”一起赋值给变量，最终导致 Copy-Item/Join-Path
        # 把日志文本误当成文件路径。这里把 stdout 显式打印到主机，不向调用者返回。
        if ($script:PnpmUseCorepack) {
            & $script:PnpmCommand "pnpm" @Arguments |
                ForEach-Object { Write-Host ([string]$_) }
        } else {
            & $script:PnpmCommand @Arguments |
                ForEach-Object { Write-Host ([string]$_) }
        }
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            throw "pnpm 命令失败（退出码 $exitCode）：pnpm $($Arguments -join ' ')"
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

function Get-JavaHomeDiagnostic {
    param([string]$JavaHomePath)

    $resolved = Resolve-JavaHomeCandidate $JavaHomePath
    if ([string]::IsNullOrWhiteSpace($resolved)) {
        return '路径为空或无法解析。'
    }

    if (-not (Test-Path -LiteralPath $resolved -PathType Container)) {
        return "目录不存在：$resolved"
    }

    $java = Join-Path $resolved 'bin\java.exe'
    $javac = Join-Path $resolved 'bin\javac.exe'
    $missing = @()
    if (-not (Test-Path -LiteralPath $java -PathType Leaf)) { $missing += $java }
    if (-not (Test-Path -LiteralPath $javac -PathType Leaf)) { $missing += $javac }
    if ($missing.Count -gt 0) {
        return ("不是完整 JDK，缺少：{0}" -f ($missing -join '；'))
    }

    $major = Get-JavaMajorVersion $resolved
    if ($null -ne $major) {
        if ($major -eq $JdkMajor) {
            return "有效 JDK $major：$resolved"
        }
        return "检测到完整 JDK $major，但当前构建要求 JDK $JdkMajor：$resolved"
    }

    $javaProbe = Invoke-JavaVersionProbe -ExecutablePath $java -Arguments '-version'
    $javacProbe = Invoke-JavaVersionProbe -ExecutablePath $javac -Arguments '-version'
    $parts = @("完整 JDK 文件存在，但无法解析版本：$resolved")
    if (-not [string]::IsNullOrWhiteSpace([string]$javaProbe.Error)) {
        $parts += "java.exe 启动错误：$($javaProbe.Error)"
    }
    if (-not [string]::IsNullOrWhiteSpace([string]$javacProbe.Error)) {
        $parts += "javac.exe 启动错误：$($javacProbe.Error)"
    }
    $rawJava = ((([string]$javaProbe.StdOut) + ' ' + ([string]$javaProbe.StdErr)).Trim() -replace '[\r\n]+', ' ')
    $rawJavac = ((([string]$javacProbe.StdOut) + ' ' + ([string]$javacProbe.StdErr)).Trim() -replace '[\r\n]+', ' ')
    if ($rawJava) { $parts += "java -version：$rawJava" }
    if ($rawJavac) { $parts += "javac -version：$rawJavac" }
    return ($parts -join "`n")
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

    # 最常见情况：用户直接指定真正的 JAVA_HOME。
    # 例如 D:\Code\Language\Java，其中 bin\java.exe / bin\javac.exe
    # 就在下一层 bin 目录内。此处直接验证，不需要递归搜索。
    if (Test-JavaHome $root) { return $root }
    if (-not (Test-Path -LiteralPath $root -PathType Container)) { return $null }

    # 兼容把“Java 容器目录”作为根目录的情况，例如：
    # D:\Code\Language\Java\jdk-21\bin\java.exe
    # 最多向下 MaxDepth 层，避免对整个磁盘递归扫描。
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

function Find-JavaHome {
    # 0) GUI/命令行手动指定时绝对优先，并具有“禁止自动下载”的语义。
    # 可以填写真正的 JAVA_HOME、bin 目录、java.exe/javac.exe，
    # 也可以填写包含 JDK 子目录的 Java 容器目录。
    if (-not [string]::IsNullOrWhiteSpace($JavaHome)) {
        $explicitRoot = [Environment]::ExpandEnvironmentVariables($JavaHome.Trim().Trim('"'))
        $explicit = Find-JavaHomeInRoot -RootPath $explicitRoot -MaxDepth 2
        if ($explicit) {
            $major = Get-JavaMajorVersion $explicit
            Write-Step ("使用手动指定的 JDK {0}：{1}" -f $major, $explicit)
            return $explicit
        }

        # 手动指定失败时必须告诉用户真正原因，不能只说“找不到 Java”。
        $diagnostics = New-Object System.Collections.Generic.List[string]
        [void]$diagnostics.Add((Get-JavaHomeDiagnostic $explicitRoot))
        if (Test-Path -LiteralPath $explicitRoot -PathType Container) {
            foreach ($dir in @(Get-ChildItem -LiteralPath $explicitRoot -Directory -ErrorAction SilentlyContinue)) {
                $resolvedDir = Resolve-JavaHomeCandidate $dir.FullName
                $javaCandidate = Join-Path $resolvedDir 'bin\java.exe'
                $javacCandidate = Join-Path $resolvedDir 'bin\javac.exe'
                if ((Test-Path -LiteralPath $javaCandidate -PathType Leaf) -or
                    (Test-Path -LiteralPath $javacCandidate -PathType Leaf)) {
                    [void]$diagnostics.Add((Get-JavaHomeDiagnostic $resolvedDir))
                }
            }
        }
        $detail = @($diagnostics | Where-Object { $_ } | Select-Object -Unique) -join "`n- "
        throw ("你手动指定了 Java/JDK：{0}`n但没有找到可用于本次构建的 JDK {1}。`n诊断：`n- {2}`n`n脚本不会在你手动指定 Java 后擅自下载另一个 JDK。" -f $explicitRoot, $JdkMajor, $detail)
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
        (Join-Path $ToolRoot 'Java'),
        (Join-Path $ToolRoot 'Language\Java'),
        (Join-Path $privateToolsRoot ("Java\jdk-{0}" -f $JdkMajor)),
        (Join-Path $WorkRoot ("PyDroid\tools\jdk-{0}" -f $JdkMajor)),
        (Join-Path $WorkRoot ("tools\jdk-{0}" -f $JdkMajor))
    )
    foreach ($candidate in $sharedCandidates) {
        $resolved = Find-JavaHomeInRoot -RootPath $candidate -MaxDepth 2
        if ($resolved) { return $resolved }
    }

    # 3) Windows 已安装 JDK。Microsoft OpenJDK 的 JAVA_HOME 是可选安装项，
    # 所以即使环境变量没有配置，也主动检查注册表、常见目录、PATH。
    $systemCandidates = @()
    $systemCandidates += @(Get-JavaHomesFromRegistry)
    $systemCandidates += @(Get-JavaHomesFromCommonLocations)
    $systemCandidates += @(Get-JavaHomesFromPath)
    foreach ($candidate in @($systemCandidates | Where-Object { $_ } | Select-Object -Unique)) {
        $resolved = Find-JavaHomeInRoot -RootPath $candidate -MaxDepth 1
        if ($resolved) { return $resolved }
    }

    return $null
}

function Install-Jdk {
    if ($SkipToolInstall) {
        throw "未找到 JDK $JdkMajor，且已指定 -SkipToolInstall。请安装兼容 JDK 后设置 JAVA_HOME/PYDROID_JAVA_HOME。"
    }
    Write-Step "未找到 JDK $JdkMajor，正在下载 Microsoft OpenJDK 到临时工具目录 $privateToolsRoot\Java\jdk-$JdkMajor ..."
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

    $dest = Join-Path $privateToolsRoot ("Java\jdk-{0}" -f $JdkMajor)
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
        (Join-Path $privateToolsRoot "Android\Sdk"),
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

function Add-AndroidSdkOverlayDirectory {
    param(
        [string]$Source,
        [string]$Destination
    )
    if (-not (Test-Path -LiteralPath $Source -PathType Container)) { return }
    if (Test-Path -LiteralPath $Destination) { return }
    New-Item -ItemType Directory -Force -Path (Split-Path $Destination -Parent) | Out-Null
    try {
        New-Item -ItemType Junction -Path $Destination -Target $Source | Out-Null
    } catch {
        # Junction creation should normally work on local NTFS volumes. Fall back to copying
        # only inside WorkRoot, never into the read-only shared ToolRoot.
        Copy-Item -LiteralPath $Source -Destination $Destination -Recurse -Force
    }
}

function New-TemporaryAndroidSdkOverlay {
    param([string]$SharedSdkRoot)

    $overlay = Join-Path $privateToolsRoot "Android\Sdk"
    New-Item -ItemType Directory -Force -Path $overlay | Out-Null
    $buildToolsVersion = ("{0}.0.0" -f $resolvedAndroidApi)

    Add-AndroidSdkOverlayDirectory -Source (Join-Path $SharedSdkRoot "cmdline-tools") -Destination (Join-Path $overlay "cmdline-tools")
    Add-AndroidSdkOverlayDirectory -Source (Join-Path $SharedSdkRoot "platform-tools") -Destination (Join-Path $overlay "platform-tools")
    Add-AndroidSdkOverlayDirectory -Source (Join-Path $SharedSdkRoot ("platforms\android-{0}" -f $resolvedAndroidApi)) -Destination (Join-Path $overlay ("platforms\android-{0}" -f $resolvedAndroidApi))
    Add-AndroidSdkOverlayDirectory -Source (Join-Path $SharedSdkRoot ("build-tools\{0}" -f $buildToolsVersion)) -Destination (Join-Path $overlay ("build-tools\{0}" -f $buildToolsVersion))

    $sharedLicenses = Join-Path $SharedSdkRoot "licenses"
    $overlayLicenses = Join-Path $overlay "licenses"
    if ((Test-Path -LiteralPath $sharedLicenses -PathType Container) -and -not (Test-Path -LiteralPath $overlayLicenses)) {
        Copy-Item -LiteralPath $sharedLicenses -Destination $overlayLicenses -Recurse -Force
    }

    Write-Warning ("共享 Android SDK 只读且缺少组件；不会修改 {0}，改在临时 SDK 视图中补齐：{1}" -f $SharedSdkRoot, $overlay)
    return $overlay
}

function Install-AndroidSdk {
    param([string]$SdkRoot)

    if ([string]::IsNullOrWhiteSpace($SdkRoot)) {
        $SdkRoot = Join-Path $privateToolsRoot "Android\Sdk"
    }

    $sdkRoot = Resolve-AbsolutePath $SdkRoot
    Write-Step "Android SDK：$sdkRoot"
    if (-not (Test-Path -LiteralPath $sdkRoot -PathType Container)) {
        New-Item -ItemType Directory -Force -Path $sdkRoot | Out-Null
    }

    # 先逐项检查。已有组件绝不重复安装，只补真正缺少的部分。
    $platformToolsAdb = Join-Path $sdkRoot "platform-tools\adb.exe"
    $platformJar = Join-Path $sdkRoot ("platforms\android-{0}\android.jar" -f $resolvedAndroidApi)
    $buildToolsVersion = ("{0}.0.0" -f $resolvedAndroidApi)
    $buildToolsDir = Join-Path $sdkRoot ("build-tools\{0}" -f $buildToolsVersion)
    $buildToolsAapt2 = Join-Path $buildToolsDir "aapt2.exe"

    $missingPackages = @()

    if (Test-Path -LiteralPath $platformToolsAdb -PathType Leaf) {
        Write-Host "✓ platform-tools 已存在：$platformToolsAdb" -ForegroundColor DarkGreen
    } else {
        Write-Host "✗ platform-tools 缺失" -ForegroundColor DarkYellow
        $missingPackages += "platform-tools"
    }

    if (Test-Path -LiteralPath $platformJar -PathType Leaf) {
        Write-Host ("✓ platforms;android-{0} 已存在：{1}" -f $resolvedAndroidApi, $platformJar) -ForegroundColor DarkGreen
    } else {
        Write-Host ("✗ platforms;android-{0} 缺失" -f $resolvedAndroidApi) -ForegroundColor DarkYellow
        $missingPackages += ("platforms;android-{0}" -f $resolvedAndroidApi)
    }

    if (Test-Path -LiteralPath $buildToolsAapt2 -PathType Leaf) {
        Write-Host ("✓ build-tools;{0} 已存在：{1}" -f $buildToolsVersion, $buildToolsDir) -ForegroundColor DarkGreen
    } else {
        Write-Host ("✗ build-tools;{0} 缺失" -f $buildToolsVersion) -ForegroundColor DarkYellow
        $missingPackages += ("build-tools;{0}" -f $buildToolsVersion)
    }

    if ($missingPackages.Count -eq 0) {
        Write-Step "Android SDK 所需组件均已存在，无需下载。"
        return [string]$sdkRoot
    }

    if ((Test-PathWithinRoot -Path $sdkRoot -Root $ToolRoot) -and
        -not (Test-PathWithinRoot -Path $ToolRoot -Root $WorkRoot)) {
        $overlayRoot = New-TemporaryAndroidSdkOverlay -SharedSdkRoot $sdkRoot
        return (Install-AndroidSdk -SdkRoot $overlayRoot)
    }

    if ($SkipToolInstall) {
        throw ("Android SDK 缺少组件：{0}，且已指定 -SkipToolInstall。" -f ($missingPackages -join ", "))
    }

    # 只有真的需要补包时才要求 sdkmanager。
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
        if (Test-Path -LiteralPath $temp) {
            Remove-Item -LiteralPath $temp -Recurse -Force
        }
        New-Item -ItemType Directory -Force -Path $temp | Out-Null
        Expand-Archive -LiteralPath $zip -DestinationPath $temp -Force

        $cmdline = Join-Path $temp "cmdline-tools"
        if (-not (Test-Path -LiteralPath $cmdline)) {
            $cmdlineItem = Get-ChildItem -LiteralPath $temp -Recurse -Directory -Filter "cmdline-tools" |
                Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "bin\sdkmanager.bat") } |
                Select-Object -First 1
            if ($cmdlineItem) {
                $cmdline = $cmdlineItem.FullName
            }
        }

        if (-not $cmdline -or -not (Test-Path -LiteralPath (Join-Path $cmdline "bin\sdkmanager.bat"))) {
            throw "Android commandline-tools 解压后未找到 sdkmanager.bat。"
        }

        $latestDir = Join-Path $sdkRoot "cmdline-tools\latest"
        if (Test-Path -LiteralPath $latestDir) {
            Remove-Item -LiteralPath $latestDir -Recurse -Force
        }
        New-Item -ItemType Directory -Force -Path (Split-Path $latestDir -Parent) | Out-Null
        Move-Item -LiteralPath $cmdline -Destination $latestDir
        Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue

        $sdkManager = Join-Path $latestDir "bin\sdkmanager.bat"
    }

    # 预写许可证，避免 sdkmanager 等待交互。
    $licensesDir = Join-Path $sdkRoot "licenses"
    New-Item -ItemType Directory -Force -Path $licensesDir | Out-Null
    $licenseFiles = @{
        "android-sdk-license"         = "24333f8a63b6825ea9c5514f83c2829b004d1fee"
        "android-sdk-preview-license" = "84831b9409646a918e30573bab4c9c91346d8abd"
        "android-sdk-arm-dbt-license" = "859f317696f67ef3d7f30a50a5560e7834b43903"
        "google-gdk-license"           = "33b6a2b64607f11b759f320ef9dff4ae5c47d97a"
    }
    foreach ($k in $licenseFiles.Keys) {
        $lf = Join-Path $licensesDir $k
        if (-not (Test-Path -LiteralPath $lf -PathType Leaf)) {
            Set-Content -LiteralPath $lf -Value $licenseFiles[$k] -Encoding ASCII
        }
    }

    Write-BuildStage -Percent $script:CurrentBuildStagePercent -Message "补齐缺失的 Android SDK 组件"
    Write-Step ("仅安装缺失组件：{0}" -f ($missingPackages -join ", "))

    # 重要：
    # PowerShell 函数内 native command 的 stdout 会进入函数成功输出流。
    # 如果直接写：
    #   $sdk = Install-AndroidSdk ...
    # 那么 sdkmanager 的 "Loading package information..." 等文本也会被装进 $sdk。
    # 这里显式消费所有 sdkmanager 输出并用 Write-Host 显示，保证函数唯一返回值只有 SDK 根目录。
    $yes = (("y`n") * 40)
    $oldEap = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $yes | & $sdkManager "--sdk_root=$sdkRoot" @missingPackages 2>&1 |
            ForEach-Object {
                if ($_ -ne $null) {
                    Write-Host ([string]$_)
                }
            }
        $sdkExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $oldEap
    }

    if ($sdkExitCode -ne 0) {
        throw "Android SDK 包安装失败（退出码 $sdkExitCode）。"
    }

    # 安装后逐项复核，避免 sdkmanager 返回 0 但组件不完整。
    $missingAfterInstall = @()
    if (-not (Test-Path -LiteralPath $platformToolsAdb -PathType Leaf)) {
        $missingAfterInstall += "platform-tools"
    }
    if (-not (Test-Path -LiteralPath $platformJar -PathType Leaf)) {
        $missingAfterInstall += ("platforms;android-{0}" -f $resolvedAndroidApi)
    }
    if (-not (Test-Path -LiteralPath $buildToolsAapt2 -PathType Leaf)) {
        $missingAfterInstall += ("build-tools;{0}" -f $buildToolsVersion)
    }

    if ($missingAfterInstall.Count -gt 0) {
        throw ("sdkmanager 执行结束，但以下组件仍不完整：{0}" -f ($missingAfterInstall -join ", "))
    }

    Write-Step "Android SDK 缺失组件已补齐。"
    return [string]$sdkRoot
}

function Test-PythonSeries {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Executable
    )

    if ([string]::IsNullOrWhiteSpace($Executable) -or -not (Test-Path -LiteralPath $Executable -PathType Leaf)) {
        return $false
    }

    try {
        & $Executable -c "import sys; raise SystemExit(0 if sys.version_info[:2] == ($pythonMajor, $pythonMinor) else 1)" 2>$null | Out-Null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

function Test-PythonBuildHost {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Executable
    )

    if (-not (Test-PythonSeries -Executable $Executable)) { return $false }
    try {
        # Chaquopy invokes `python -m venv` while preparing build packages.
        # The Windows embeddable distribution intentionally omits venv and is therefore
        # suitable for the packaged desktop runtime, but NOT for Android buildPython.
        # Android buildPython on a Windows x64 builder must also be a 64-bit interpreter.
        & $Executable -c "import struct, venv, ensurepip; raise SystemExit(0 if struct.calcsize('P') * 8 == 64 else 1)" 2>$null | Out-Null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

function Get-PythonVersionLabel {
    param([string]$Executable)
    if ([string]::IsNullOrWhiteSpace($Executable) -or -not (Test-Path -LiteralPath $Executable -PathType Leaf)) {
        return "不可用"
    }
    try {
        $label = & $Executable -c "import sys; print('.'.join(map(str, sys.version_info[:3])))" 2>$null
        if ($LASTEXITCODE -eq 0 -and $label) { return ([string]($label | Select-Object -Last 1)).Trim() }
    } catch {}
    return "未知"
}

function Get-PythonBuildHostDiagnostic {
    param([string]$Executable)

    if ([string]::IsNullOrWhiteSpace($Executable)) { return "python.exe 路径为空" }
    if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { return "python.exe 不存在：$Executable" }

    $details = New-Object System.Collections.Generic.List[string]
    $details.Add(("version={0}" -f (Get-PythonVersionLabel $Executable)))
    foreach ($module in @("venv", "ensurepip")) {
        try {
            $probe = & $Executable -c ("import {0}; print('ok')" -f $module) 2>&1
            if ($LASTEXITCODE -eq 0) {
                $details.Add(("{0}=ok" -f $module))
            } else {
                $tail = ([string]($probe | Select-Object -Last 1)).Trim()
                $details.Add(("{0}=failed({1})" -f $module, $tail))
            }
        } catch {
            $details.Add(("{0}=failed({1})" -f $module, $_.Exception.Message))
        }
    }
    return ($details -join "; ")
}

function Get-RegisteredPython313Candidates {
    $result = New-Object System.Collections.Generic.List[string]
    $roots = @(
        "HKCU:\Software\Python\PythonCore",
        "HKLM:\Software\Python\PythonCore",
        "HKLM:\Software\WOW6432Node\Python\PythonCore"
    )

    foreach ($root in $roots) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        try {
            foreach ($versionKey in @(Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue)) {
                if ($versionKey.PSChildName -notmatch '^3\.13(?:$|[-.])') { continue }
                $installPathKey = Join-Path $versionKey.PSPath "InstallPath"
                try {
                    $key = Get-Item -LiteralPath $installPathKey -ErrorAction Stop
                    $installDir = [string]$key.GetValue("")
                    if (-not [string]::IsNullOrWhiteSpace($installDir)) {
                        $candidate = Join-Path $installDir "python.exe"
                        if (-not $result.Contains($candidate)) { $result.Add($candidate) }
                    }
                    foreach ($valueName in @("ExecutablePath", "WindowedExecutablePath")) {
                        try {
                            $value = [string]$key.GetValue($valueName)
                            if (-not [string]::IsNullOrWhiteSpace($value) -and -not $result.Contains($value)) {
                                $result.Add($value)
                            }
                        } catch {}
                    }
                } catch {}
            }
        } catch {}
    }
    return @($result)
}

function Test-WindowsInstallerServiceAvailable {
    try {
        $service = Get-Service -Name "msiserver" -ErrorAction Stop
        if ($service.StartType -eq [System.ServiceProcess.ServiceStartMode]::Disabled) {
            return $false
        }
        if ($service.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Running) {
            try {
                Start-Service -Name "msiserver" -ErrorAction Stop
                $service.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Running, [TimeSpan]::FromSeconds(5))
            } catch {
                return $false
            }
        }
        $service.Refresh()
        return ($service.Status -eq [System.ServiceProcess.ServiceControllerStatus]::Running)
    } catch {
        return $false
    }
}

function Install-Python313FromNuGet {
    if ($SkipToolInstall) {
        throw "未找到带 venv 的完整 Python $pythonSeries，且已指定 -SkipToolInstall。"
    }

    # CPython's official NuGet package is specifically intended for CI/build scenarios.
    # Current Python 3.13 NuGet layouts include pip, venv/ensurepip and development files,
    # while avoiding Windows Installer/MSI entirely.
    $dest = Join-Path $privateToolsRoot ("Python\{0}" -f $pythonSeries)
    $packageFile = Join-Path $downloads ("python.{0}.nupkg" -f $pythonNuGetPackageVersion)
    $packageUrl = ("https://api.nuget.org/v3-flatcontainer/{0}/{1}/{0}.{1}.nupkg" -f $pythonNuGetPackageId, $pythonNuGetPackageVersion)
    $stagingRoot = Join-Path $CacheRoot (".python-nuget-{0}" -f $pythonNuGetPackageVersion)

    for ($attempt = 1; $attempt -le 2; $attempt++) {
        if (-not (Test-Path -LiteralPath $packageFile -PathType Leaf)) {
            Write-Step ("下载官方 CPython NuGet 构建包：Python {0}（{1}/2）" -f $pythonNuGetPackageVersion, $attempt)
            Invoke-Download -Uri $packageUrl -OutFile $packageFile
        }

        if (Test-Path -LiteralPath $stagingRoot) {
            Remove-BuildDirectoryRobust -Path $stagingRoot -Quiet
        }
        New-Item -ItemType Directory -Force -Path $stagingRoot | Out-Null

        try {
            Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
            [System.IO.Compression.ZipFile]::ExtractToDirectory($packageFile, $stagingRoot)

            $nuspec = Get-ChildItem -LiteralPath $stagingRoot -Filter "*.nuspec" -File | Select-Object -First 1
            if (-not $nuspec) { throw "NuGet 包中未找到 .nuspec 元数据。" }
            [xml]$manifest = Get-Content -LiteralPath $nuspec.FullName -Raw
            $idNode = $manifest.SelectSingleNode("/*[local-name()='package']/*[local-name()='metadata']/*[local-name()='id']")
            $versionNode = $manifest.SelectSingleNode("/*[local-name()='package']/*[local-name()='metadata']/*[local-name()='version']")
            if (-not $idNode -or $idNode.InnerText -ine $pythonNuGetPackageId) {
                throw "NuGet 包 ID 校验失败。"
            }
            if (-not $versionNode -or $versionNode.InnerText -ne $pythonNuGetPackageVersion) {
                throw ("NuGet 包版本校验失败：期望 {0}。" -f $pythonNuGetPackageVersion)
            }

            $packageTools = Join-Path $stagingRoot "tools"
            $packagePython = Join-Path $packageTools "python.exe"
            if (-not (Test-Path -LiteralPath $packagePython -PathType Leaf)) {
                throw "NuGet 包中未找到 tools\python.exe。"
            }

            if (Test-Path -LiteralPath $dest) {
                Remove-BuildDirectoryRobust -Path $dest -Quiet
            }
            New-Item -ItemType Directory -Force -Path (Split-Path $dest -Parent) | Out-Null
            Move-Item -LiteralPath $packageTools -Destination $dest

            $pythonExe = Join-Path $dest "python.exe"
            if (-not (Test-PythonBuildHost -Executable $pythonExe)) {
                $diagnostic = Get-PythonBuildHostDiagnostic -Executable $pythonExe
                throw ("NuGet Python 未通过 buildPython 校验：{0}" -f $diagnostic)
            }

            # Actually create a tiny venv once. Importing venv alone is insufficient to
            # catch a distribution missing the Windows venv launcher executables.
            $venvProbe = Join-Path $stagingRoot "venv-probe"
            & $pythonExe -m venv --without-pip $venvProbe 2>$null | Out-Null
            if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $venvProbe "Scripts\python.exe") -PathType Leaf)) {
                throw "NuGet Python 可以导入 venv，但实际创建 Windows venv 失败。"
            }

            Write-Step ("已准备官方 CPython NuGet buildPython：{0}（Python {1}，venv/ensurepip 可用）" -f $pythonExe, (Get-PythonVersionLabel $pythonExe))
            return $pythonExe
        } catch {
            $reason = $_.Exception.Message
            if (Test-Path -LiteralPath $dest) {
                Remove-BuildDirectoryRobust -Path $dest -Quiet
            }
            if ($attempt -eq 1) {
                Write-Warning ("缓存的 Python NuGet 包无法使用，将删除并重新下载：{0}" -f $reason)
                Remove-Item -LiteralPath $packageFile -Force -ErrorAction SilentlyContinue
                continue
            }
            throw ("官方 CPython NuGet buildPython 准备失败：{0}" -f $reason)
        } finally {
            if (Test-Path -LiteralPath $stagingRoot) {
                Remove-BuildDirectoryRobust -Path $stagingRoot -Quiet
            }
        }
    }
    throw "官方 CPython NuGet buildPython 准备失败。"
}

function Find-Python313 {
    # Android buildPython must be a FULL Python 3.13 installation with venv.
    # Do not reuse the embeddable desktop runtime: it has no `venv` module by design.
    if ($env:PYDROID_PYTHON_EXECUTABLE) {
        $configured = [string]$env:PYDROID_PYTHON_EXECUTABLE
        if (Test-PythonBuildHost -Executable $configured) {
            return $configured
        }
        if (Test-Path -LiteralPath $configured -PathType Leaf) {
            $reason = if (Test-PythonSeries -Executable $configured) { "缺少 venv/ensurepip（便携精简运行时不能作为 Chaquopy buildPython）" } else { "检测到 Python $(Get-PythonVersionLabel $configured)，Android 需要 Python $pythonSeries" }
            Write-Warning ("忽略 PYDROID_PYTHON_EXECUTABLE={0}：{1}。" -f $configured, $reason)
        } else {
            Write-Warning ("忽略 PYDROID_PYTHON_EXECUTABLE={0}：文件不存在。" -f $configured)
        }
    }

    $candidates = @(
        (Join-Path $privateToolsRoot ("Python\{0}\python.exe" -f $pythonSeries)),
        (Join-Path $ToolRoot ("Python\{0}\python.exe" -f $pythonSeries)),
        (Join-Path $ToolRoot "Python\python.exe"),
        (Join-Path $ToolRoot "Language\Python\python.exe"),
        (Join-Path $WorkRoot ("tools\{0}\python.exe" -f $pythonToolDirName))
    )

    # A normal per-user Python installation may be intentionally absent from PATH and
    # may not install py.exe. Probe the standard CPython locations before downloading
    # another private copy. Python 3.13 may use either Python313 or Python313-64.
    if ($env:LOCALAPPDATA) {
        $candidates += @(
            (Join-Path $env:LOCALAPPDATA "Programs\Python\Python313\python.exe"),
            (Join-Path $env:LOCALAPPDATA "Programs\Python\Python313-64\python.exe")
        )
    }
    if ($env:ProgramFiles) {
        $candidates += (Join-Path $env:ProgramFiles "Python313\python.exe")
    }
    $programFilesX86 = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFilesX86)
    if ($programFilesX86) {
        $candidates += (Join-Path $programFilesX86 "Python313\python.exe")
    }

    # PEP 514 registry discovery catches custom/per-user Python installs which are not on
    # PATH and are not located under the default Python313 directories.
    $candidates += @(Get-RegisteredPython313Candidates)

    foreach ($candidate in $candidates) {
        if (Test-PythonBuildHost -Executable $candidate) {
            return $candidate
        }
    }

    try {
        $pyOutput = & py ("-{0}" -f $pythonSeries) -c "import sys; print(sys.executable)" 2>$null
        if ($LASTEXITCODE -eq 0 -and $pyOutput) {
            $candidate = ([string]($pyOutput | Select-Object -Last 1)).Trim()
            if (Test-PythonBuildHost -Executable $candidate) { return $candidate }
        }
    } catch {}

    $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
    if (-not $pythonCommand) { $pythonCommand = Get-Command python -ErrorAction SilentlyContinue }
    if ($pythonCommand -and (Test-PythonBuildHost -Executable $pythonCommand.Source)) {
        return $pythonCommand.Source
    }

    return $null
}

function Install-Python313 {
    if ($SkipToolInstall) {
        throw "未找到带 venv 的完整 Python $pythonSeries，且已指定 -SkipToolInstall。请安装完整 Python 3.13，或设置 PYDROID_PYTHON_EXECUTABLE。"
    }

    # Prefer zero-impact build tooling when Windows Installer is unavailable. The official
    # CPython NuGet package is designed for CI/build systems and does not depend on MSI.
    if (-not (Test-WindowsInstallerServiceAvailable)) {
        Write-Warning "Windows Installer 服务（msiserver）当前不可用；跳过 EXE/MSI 安装，改用官方 CPython NuGet buildPython。"
        return Install-Python313FromNuGet
    }

    $dest = Join-Path $privateToolsRoot ("Python\{0}" -f $pythonSeries)
    Write-Step "未找到带 venv 的完整 Python $pythonSeries，正在安装到临时工具目录 $dest ..."
    $installer = Join-Path $downloads ("python-{0}-amd64.exe" -f $pythonInstallerVersion)
    $installerUrl = ("https://www.python.org/ftp/python/{0}/python-{0}-amd64.exe" -f $pythonInstallerVersion)
    if (Test-Path -LiteralPath $installer) {
        $cachedHash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToUpperInvariant()
        if ($cachedHash -ne $pythonPinnedInstallerSha256) {
            Write-Warning "缓存的 Python 安装器校验失败，正在删除并重新下载：$installer"
            Remove-Item -LiteralPath $installer -Force
        }
    }
    if (-not (Test-Path -LiteralPath $installer)) {
        Write-Step "Python $pythonSeries 自动安装固定使用官方 Python $pythonInstallerVersion x64 安装器。"
        Invoke-Download -Uri $installerUrl -OutFile $installer
    }
    $installerHash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToUpperInvariant()
    if ($installerHash -ne $pythonPinnedInstallerSha256) {
        throw "Python $pythonInstallerVersion 安装器 SHA-256 校验失败。期望：$pythonPinnedInstallerSha256；实际：$installerHash"
    }

    if (Test-Path -LiteralPath $dest) {
        Remove-BuildDirectoryRobust -Path $dest -Quiet
    }
    New-Item -ItemType Directory -Force -Path (Split-Path $dest -Parent) | Out-Null

    $pythonInstallLogDir = Join-Path $WorkRoot "logs"
    New-Item -ItemType Directory -Force -Path $pythonInstallLogDir | Out-Null
    $pythonInstallLog = Join-Path $pythonInstallLogDir ("python-{0}-install-{1}.log" -f $pythonInstallerVersion, (Get-Date -Format "yyyyMMdd-HHmmss"))

    $installerArgs = @(
        "/quiet", "/log", ('"{0}"' -f $pythonInstallLog),
        "InstallAllUsers=0", "PrependPath=0", "AppendPath=0", "AssociateFiles=0", "Shortcuts=0",
        "Include_launcher=0", "InstallLauncherAllUsers=0", "Include_exe=1", "Include_lib=1",
        "Include_pip=1", "Include_tools=1", "Include_dev=1", "Include_tcltk=0", "Include_test=0",
        "Include_doc=0", "Include_debug=0", "Include_symbols=0", ('TargetDir="{0}"' -f $dest)
    )

    Write-Step ("安装完整 Python {0}：{1}" -f $pythonInstallerVersion, $dest)
    Write-Host ("Python 安装日志：{0}" -f $pythonInstallLog) -ForegroundColor DarkGray

    $proc = $null
    try {
        $proc = Start-Process -FilePath $installer -ArgumentList $installerArgs -Wait -PassThru
    } catch {
        Write-Warning ("Python EXE 安装器无法启动：{0}；改用官方 CPython NuGet buildPython。" -f $_.Exception.Message)
        return Install-Python313FromNuGet
    }

    $pythonExe = Join-Path $dest "python.exe"
    $isUsable = Test-PythonBuildHost -Executable $pythonExe
    if ($isUsable) {
        if ($proc.ExitCode -ne 0) {
            Write-Warning ("Python 安装器退出码为 {0}，但完整 Python 已通过版本/venv/ensurepip 校验，将继续构建。" -f $proc.ExitCode)
        }
        Write-Step ("完整 Python 安装完成：{0}（Python {1}，venv/ensurepip 可用）" -f $pythonExe, (Get-PythonVersionLabel $pythonExe))
        return $pythonExe
    }

    $rediscovered = Find-Python313
    if ($rediscovered -and -not [string]::Equals([string]$rediscovered, $pythonExe, [StringComparison]::OrdinalIgnoreCase)) {
        Write-Warning ("Python 安装器没有在预期 TargetDir 生成可用解释器，但检测到完整 Python：{0}。将复用该解释器。" -f $rediscovered)
        return [string]$rediscovered
    }

    $diagnostic = Get-PythonBuildHostDiagnostic -Executable $pythonExe
    $logTail = ""
    if (Test-Path -LiteralPath $pythonInstallLog -PathType Leaf) {
        try {
            $tailLines = @(Get-Content -LiteralPath $pythonInstallLog -Tail 24 -ErrorAction Stop)
            if ($tailLines.Count -gt 0) { $logTail = ($tailLines -join [Environment]::NewLine) }
        } catch {}
    }

    if ($proc.ExitCode -eq 1601) {
        Write-Warning "Python 安装器返回 1601（Windows Installer 服务不可访问）；自动改用官方 CPython NuGet buildPython。"
    } else {
        Write-Warning ("Python EXE 安装器未生成可用 buildPython（退出码 {0}；{1}）；自动改用官方 CPython NuGet buildPython。" -f $proc.ExitCode, $diagnostic)
    }
    if ($logTail) {
        Write-Host ("Python EXE 安装日志末尾：" + [Environment]::NewLine + $logTail) -ForegroundColor DarkGray
    }

    try {
        return Install-Python313FromNuGet
    } catch {
        $nugetReason = $_.Exception.Message
        throw ("完整 Python $pythonSeries 准备失败。EXE 安装器退出码：$($proc.ExitCode)；EXE 校验：$diagnostic；安装日志：$pythonInstallLog；NuGet fallback：$nugetReason")
    }
}

# ---------------------------------------------------------------
# 工作区同步 / 清理
# ---------------------------------------------------------------

function Get-ExtendedLengthPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    $full = [System.IO.Path]::GetFullPath($Path)
    if ($full.StartsWith('\\?\')) { return $full }
    if ($full.StartsWith('\\')) {
        return ('\\?\UNC\' + $full.Substring(2))
    }
    return ('\\?\' + $full)
}

function Remove-BuildDirectoryRobust {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [switch]$Quiet
    )

    if (-not (Test-Path -LiteralPath $Path)) { return }

    # Windows PowerShell 5.1 Remove-Item -Recurse can fail while walking Electron/
    # Android node_modules trees whose descendants exceed MAX_PATH. Try the normal
    # path first because it is fast and gives good diagnostics for ordinary failures.
    try {
        Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
    } catch {
        if (-not $Quiet) {
            Write-Warning ("PowerShell 清理目录失败，将切换到 Windows 长路径清理：{0}" -f $Path)
        }
    }
    if (-not (Test-Path -LiteralPath $Path)) { return }

    # cmd.exe rd understands the extended-length Win32 namespace and avoids the
    # recursive provider traversal which triggers DirectoryNotFoundException above.
    $extendedPath = Get-ExtendedLengthPath -Path $Path
    & cmd.exe /d /c rd /s /q "`"$extendedPath`"" 2>$null | Out-Null
    $global:LASTEXITCODE = 0
    if (-not (Test-Path -LiteralPath $Path)) { return }

    # Final fallback: mirror an empty directory into the stale tree with robocopy.
    # Robocopy is long-path aware by default and /XJ avoids following junctions out
    # of the build workspace. Once emptied, removing the short root path is reliable.
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
        if ($robocopyExitCode -ge 8) {
            throw "robocopy 长路径清理失败，退出码：$robocopyExitCode；目录：$Path"
        }

        & cmd.exe /d /c rd /s /q "`"$Path`"" 2>$null | Out-Null
        $global:LASTEXITCODE = 0
    } finally {
        Remove-Item -LiteralPath $emptyDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    if (Test-Path -LiteralPath $Path) {
        throw "无法清理构建目录：$Path。请确认该目录未被其他进程占用。"
    }
}

function Sync-Source {
    Write-BuildStage -Percent 15 -Message "清理临时工作区旧构建缓存"
    Write-Step "清理临时工作区旧构建缓存（静默）..."
    # 默认保留 Android 的 .gradle/app/build 等目录，让 Gradle daemon、build cache
    # 和增量编译在连续构建之间真正生效。只有 -CleanBuild 才清理这些目录。
    $transientDirs = @(
        "release", "dist", "dist-desktop", "temp", ".vite", ".pytest_cache"
    )
    if ($CleanBuild) {
        $transientDirs += @(
            "android\.gradle",
            "android\app\build",
            "android\build",
            "android\capacitor-cordova-android-plugins\build"
        )
    }
    foreach ($relative in $transientDirs) {
        $full = Join-Path $workspace $relative
        if (Test-Path -LiteralPath $full) {
            Remove-BuildDirectoryRobust -Path $full -Quiet
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
    # android-package.ps1 自己读取 PYDROID_DISABLE_GRADLE_DAEMON，核心构建器不再
    # 用正则修改脚本中的 gradlew 命令。这样重试/降级逻辑可以保持完整，也避免
    # GUI 显示的 daemon 状态与实际脚本分叉。
    $file = Join-Path $workspace "scripts\android-package.ps1"
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { return }

    $content = Get-Content -LiteralPath $file -Raw
    if ($content -notmatch 'PYDROID_DISABLE_GRADLE_DAEMON') {
        throw "Gradle daemon 开关自检失败：android-package.ps1 未读取 PYDROID_DISABLE_GRADLE_DAEMON。"
    }
    if ($content -notmatch 'A problem occurred starting process.+Gradle build daemon') {
        throw "Gradle daemon 恢复自检失败：android-package.ps1 缺少 daemon 启动失败自动恢复逻辑。"
    }

    if ($DisableGradleDaemon) {
        Write-Host "Gradle daemon：已禁用（-DisableGradleDaemon）。" -ForegroundColor DarkYellow
    } else {
        Write-Host "Gradle daemon：启用（默认；失败时自动清理并降级）。" -ForegroundColor DarkGreen
    }
}

function Clear-WorkspaceOutputs {
    param([switch]$IncludeAndroidBuild)

    Write-Step "清理工作区中的临时构建产物：$workspace"
    $paths = @("release", "dist", "dist-desktop", "temp")

    if ($IncludeAndroidBuild) {
        $paths += @(
            "android\.gradle",
            "android\app\build",
            "android\build",
            "android\capacitor-cordova-android-plugins\build"
        )
    }

    foreach ($p in $paths) {
        $full = Join-Path $workspace $p
        if (Test-Path -LiteralPath $full) {
            Remove-BuildDirectoryRobust -Path $full
        }
    }
}

function Ensure-PythonRuntimeForDesktop {
    $runtimeLink = Join-Path $workspace ".tools\python313-runtime"
    $runtimeTarget = Join-Path $privateToolsRoot "Python\runtime-3.13"
    New-Item -ItemType Directory -Force -Path (Join-Path $workspace ".tools") | Out-Null
    New-Item -ItemType Directory -Force -Path $runtimeTarget | Out-Null

    # Older builds could leave a workspace junction pointing into D:\Code. ToolRoot is now
    # read-only, so detach that legacy junction and recreate it against the WorkRoot target.
    if (Test-Path -LiteralPath $runtimeLink) {
        $item = Get-Item -LiteralPath $runtimeLink -Force
        if ($item.LinkType -eq "Junction") {
            $actualTarget = [string]$item.Target
            $expectedTarget = [System.IO.Path]::GetFullPath($runtimeTarget).TrimEnd([char[]]'\/')
            $actualTargetFull = $null
            try { $actualTargetFull = [System.IO.Path]::GetFullPath($actualTarget).TrimEnd([char[]]'\/') } catch {}
            if (-not $actualTargetFull -or -not $actualTargetFull.Equals($expectedTarget, [StringComparison]::OrdinalIgnoreCase)) {
                Write-Step "移除旧桌面 Python 运行时联接（不会删除原目标）：$runtimeLink -> $actualTarget"
                & cmd.exe /c rmdir "`"$runtimeLink`"" | Out-Null
            }
        }
    }

    if (-not (Test-Path -LiteralPath $runtimeLink)) {
        New-Item -ItemType Junction -Path $runtimeLink -Target $runtimeTarget | Out-Null
    } else {
        $item = Get-Item -LiteralPath $runtimeLink -Force
        if ($item.LinkType -ne "Junction") {
            Write-Warning "$runtimeLink 已存在但不是目录联接，将使用工作区本地运行时。"
            $runtimeTarget = $runtimeLink
        }
    }

    if (Test-Path -LiteralPath (Join-Path $runtimeLink "python.exe")) {
        Write-Step "复用桌面 Python 便携运行时（临时目录）：$runtimeTarget"
        return
    }

    Write-BuildStage -Percent 48 -Message "首次准备桌面 Python 3.13 运行时（可能需要联网下载）"
    Write-Step "准备桌面版所需的 Python 3.13 便携运行时（仅写入临时目录）..."
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


function Configure-GradleNetwork {
    param(
        [Parameter(Mandatory = $true)]
        [string]$WrapperPropertiesPath,

        [Parameter(Mandatory = $true)]
        [string]$ProjectPropertiesPath
    )

    # Gradle Wrapper is itself a Java process. HTTP_PROXY/HTTPS_PROXY are useful
    # for pnpm and PowerShell, but the JVM does not reliably consume them as the
    # Gradle proxy configuration. Pass the resolved proxy explicitly as JVM
    # system properties so both the Wrapper distribution download and the later
    # Gradle dependency resolution use the same proxy selected in the GUI.
    $gradleArgs = @("-Xms64m", "-Xmx1536m")

    if (-not [string]::IsNullOrWhiteSpace([string]$script:ResolvedProxyUrl)) {
        try {
            $proxyUri = [Uri]$script:ResolvedProxyUrl
            if ($proxyUri.Scheme -notin @("http", "https")) {
                throw "Gradle 当前仅支持从本脚本自动转换 HTTP/HTTPS 代理，当前代理协议为：$($proxyUri.Scheme)"
            }

            $proxyHost = $proxyUri.Host
            $proxyPort = $proxyUri.Port
            if ($proxyPort -le 0) {
                $proxyPort = if ($proxyUri.Scheme -eq "https") { 443 } else { 80 }
            }

            $gradleArgs += "-Dhttp.proxyHost=$proxyHost"
            $gradleArgs += "-Dhttp.proxyPort=$proxyPort"
            $gradleArgs += "-Dhttps.proxyHost=$proxyHost"
            $gradleArgs += "-Dhttps.proxyPort=$proxyPort"

            # Basic-auth proxy is uncommon for local proxy tools, but preserve
            # credentials if the selected proxy URL explicitly contains them.
            if (-not [string]::IsNullOrWhiteSpace($proxyUri.UserInfo)) {
                $userInfoParts = $proxyUri.UserInfo -split ':', 2
                $proxyUser = [Uri]::UnescapeDataString($userInfoParts[0])
                $proxyPassword = if ($userInfoParts.Count -gt 1) {
                    [Uri]::UnescapeDataString($userInfoParts[1])
                } else {
                    ""
                }

                if ($proxyUser -match '\s' -or $proxyPassword -match '\s') {
                    Write-Warning "Gradle 代理用户名或密码包含空格，无法安全通过 GRADLE_OPTS 传递；将仅配置代理主机和端口。"
                } else {
                    $gradleArgs += "-Dhttp.proxyUser=$proxyUser"
                    $gradleArgs += "-Dhttp.proxyPassword=$proxyPassword"
                    $gradleArgs += "-Dhttps.proxyUser=$proxyUser"
                    $gradleArgs += "-Dhttps.proxyPassword=$proxyPassword"
                }
            }

            Write-Step ("Gradle 网络代理：{0}:{1}（沿用 GUI/构建网络配置）" -f $proxyHost, $proxyPort)
        } catch {
            throw "无法把当前代理配置转换为 Gradle JVM 代理参数：$($script:ResolvedProxyUrl)`n$($_.Exception.Message)"
        }
    } else {
        Write-Step "Gradle 网络代理：直连"
    }

    $effectiveJvmArgs = ($gradleArgs -join " ")
    $env:GRADLE_OPTS = $effectiveJvmArgs

    # Gradle 官方要求：若 --no-daemon 时客户端 JVM 参数与构建 JVM 参数不一致，
    # 仍会创建 single-use daemon。把工作区 org.gradle.jvmargs 与 GRADLE_OPTS
    # 保持完全一致，使“禁用 daemon”真正不再派生额外 JVM；在 daemon 模式下
    # 也确保代理参数被构建 JVM 继承。只修改临时工作区，不修改用户源码。
    if (Test-Path -LiteralPath $ProjectPropertiesPath -PathType Leaf) {
        $projectGradleText = Get-Content -LiteralPath $ProjectPropertiesPath -Raw
        if ($projectGradleText -match '(?m)^\s*org\.gradle\.jvmargs\s*=') {
            $projectGradleText = [regex]::Replace(
                $projectGradleText,
                '(?m)^\s*org\.gradle\.jvmargs\s*=.*$',
                "org.gradle.jvmargs=$effectiveJvmArgs"
            )
        } else {
            if (-not $projectGradleText.EndsWith("`n")) { $projectGradleText += "`r`n" }
            $projectGradleText += "org.gradle.jvmargs=$effectiveJvmArgs`r`n"
        }
        # 将 daemon JVM 明确固定到本次 GUI/CLI 已确认的 JAVA_HOME，避免
        # 用户级 Gradle 配置或旧 daemon 使用另一套 JDK 而被判定 incompatible。
        if (-not [string]::IsNullOrWhiteSpace([string]$env:JAVA_HOME)) {
            $gradleJavaHome = ([string]$env:JAVA_HOME).Replace('\', '/')
            if ($projectGradleText -match '(?m)^\s*org\.gradle\.java\.home\s*=') {
                $projectGradleText = [regex]::Replace(
                    $projectGradleText,
                    '(?m)^\s*org\.gradle\.java\.home\s*=.*$',
                    "org.gradle.java.home=$gradleJavaHome"
                )
            } else {
                if (-not $projectGradleText.EndsWith("`n")) { $projectGradleText += "`r`n" }
                $projectGradleText += "org.gradle.java.home=$gradleJavaHome`r`n"
            }
        }

        # 关闭 GUI 时会显式 --stop；这里再把空闲超时缩短到 10 分钟，
        # 即使 GUI 异常崩溃，也不会让 PyDroid daemon 长时间残留。
        if ($projectGradleText -match '(?m)^\s*org\.gradle\.daemon\.idletimeout\s*=') {
            $projectGradleText = [regex]::Replace(
                $projectGradleText,
                '(?m)^\s*org\.gradle\.daemon\.idletimeout\s*=.*$',
                'org.gradle.daemon.idletimeout=600000'
            )
        } else {
            if (-not $projectGradleText.EndsWith("`n")) { $projectGradleText += "`r`n" }
            $projectGradleText += "org.gradle.daemon.idletimeout=600000`r`n"
        }

        [System.IO.File]::WriteAllText(
            $ProjectPropertiesPath,
            $projectGradleText,
            (New-Object System.Text.UTF8Encoding($false))
        )
    } else {
        Write-Warning "未找到项目 gradle.properties，无法同步 Gradle JVM 参数：$ProjectPropertiesPath"
    }

    # Gradle Wrapper 的 distribution 下载默认只有 10 秒网络超时。
    # 在临时工作区副本中提高 networkTimeout，不修改用户的项目源码。
    if (Test-Path -LiteralPath $WrapperPropertiesPath -PathType Leaf) {
        $timeoutMs = [Math]::Max(60000, ($PnpmFetchTimeoutSeconds * 1000))
        $wrapperText = Get-Content -LiteralPath $WrapperPropertiesPath -Raw

        if ($wrapperText -match '(?m)^\s*networkTimeout\s*=') {
            $wrapperText = [regex]::Replace(
                $wrapperText,
                '(?m)^\s*networkTimeout\s*=.*$',
                "networkTimeout=$timeoutMs"
            )
        } else {
            if (-not $wrapperText.EndsWith("`n")) {
                $wrapperText += "`r`n"
            }
            $wrapperText += "networkTimeout=$timeoutMs`r`n"
        }

        [System.IO.File]::WriteAllText(
            $WrapperPropertiesPath,
            $wrapperText,
            (New-Object System.Text.UTF8Encoding($false))
        )
        Write-Step ("Gradle Wrapper 下载超时：{0} ms（{1} s）" -f $timeoutMs, [int]($timeoutMs / 1000))
    } else {
        Write-Warning "未找到 gradle-wrapper.properties，无法调整 Wrapper 下载超时：$WrapperPropertiesPath"
    }
}

function Build-Android {
    Write-BuildStage -Percent 68 -Message "检查 Android JDK、SDK 与 Python 3.13"
    Write-Step "构建 Android debug APK ..."

    $jdk = Find-JavaHome
    if (-not $jdk) {
        $jdk = Install-Jdk
    }
    $jdk = [string]$jdk
    Write-Step ("JDK {0}：{1}" -f $JdkMajor, $jdk)

    # sdkmanager 本身依赖 Java，所以必须先启用已经确认的 JDK。
    $env:JAVA_HOME = $jdk
    $env:Path = "$(Join-Path $jdk 'bin');$env:Path"

    # Find-AndroidSdk 负责寻找现有 SDK 根；Install-AndroidSdk 负责逐项检查并只补缺失组件。
    $sdk = Find-AndroidSdk
    if ([string]::IsNullOrWhiteSpace([string]$sdk)) {
        $sdk = Join-Path $privateToolsRoot "Android\Sdk"
    }

    # 防止任何函数/原生命令的附带 stdout 污染 SDK 路径。
    # Install-AndroidSdk 已保证只向成功输出流返回一个字符串，这里再次强制标量化并校验。
    $sdkResult = @(Install-AndroidSdk -SdkRoot ([string]$sdk))
    if ($sdkResult.Count -ne 1) {
        throw ("Android SDK 准备函数返回了异常数量的结果（{0}）。这通常意味着某个命令输出污染了 SDK 路径。" -f $sdkResult.Count)
    }
    $sdk = [string]$sdkResult[0]

    if ([string]::IsNullOrWhiteSpace($sdk) -or -not (Test-Path -LiteralPath $sdk -PathType Container)) {
        throw "Android SDK 根目录无效：$sdk"
    }

    $requiredPlatformJar = Join-Path $sdk ("platforms\android-{0}\android.jar" -f $resolvedAndroidApi)
    if (-not (Test-Path -LiteralPath $requiredPlatformJar -PathType Leaf)) {
        throw "Android SDK Platform $resolvedAndroidApi 不完整：$requiredPlatformJar"
    }

    $python = if ($script:ResolvedAndroidPython) { [string]$script:ResolvedAndroidPython } else { Find-Python313 }
    if (-not $python) {
        $python = Install-Python313
    }
    $python = [string]$python
    if (-not (Test-PythonBuildHost -Executable $python)) {
        throw ("Android 构建要求带 venv 的完整 Python {0}，但解析到的解释器不满足要求：{1}（检测版本：{2}）。" -f $pythonSeries, $python, (Get-PythonVersionLabel $python))
    }
    Write-Step ("Android buildPython：{0}（Python {1}）" -f $python, (Get-PythonVersionLabel $python))

    $env:JAVA_HOME = $jdk
    $env:ANDROID_HOME = $sdk
    $env:ANDROID_SDK_ROOT = $sdk
    $env:GRADLE_USER_HOME = $gradleHome
    $env:PYDROID_PYTHON_EXECUTABLE = $python

    # Gradle Wrapper 是独立 Java 进程，需要显式配置 JVM 代理。
    # 同时提高 distribution 下载超时，避免 services.gradle.org 默认 10 秒超时。
    $gradleWrapperProps = Join-Path $workspace "android\gradle\wrapper\gradle-wrapper.properties"
    $gradleProjectProps = Join-Path $workspace "android\gradle.properties"
    Configure-GradleNetwork -WrapperPropertiesPath $gradleWrapperProps -ProjectPropertiesPath $gradleProjectProps

    Write-Step "Android 构建环境"
    Write-Host "JAVA_HOME：$env:JAVA_HOME"
    Write-Host "ANDROID_HOME：$env:ANDROID_HOME"
    Write-Host "ANDROID_SDK_ROOT：$env:ANDROID_SDK_ROOT"
    Write-Host "Python：$env:PYDROID_PYTHON_EXECUTABLE"
    Write-Host "GRADLE_USER_HOME：$env:GRADLE_USER_HOME"

    # Android 打包脚本读取此开关决定正常 daemon 模式或显式无 daemon 模式。
    # 默认模式若遇到 daemon 进程启动失败，会在 android-package.ps1 内自动恢复。
    $env:PYDROID_DISABLE_GRADLE_DAEMON = if ($DisableGradleDaemon) { "1" } else { "0" }

    Write-BuildStage -Percent 78 -Message "准备 Android Gradle 构建"
    if ($DisableGradleDaemon) {
        Write-Step "Gradle daemon 已禁用；本次构建使用独立 JVM。"
    } else {
        Write-Step "Gradle daemon 已启用；使用 PyDroid 专属 daemon 状态，启动失败会自动清理并重试。"
    }

    Write-BuildStage -Percent 82 -Message "编译 Android APK"
    Invoke-Pnpm @("android:package")
    Write-BuildStage -Percent 88 -Message "Android APK 编译完成"

    $apk = Join-Path $workspace "android\app\build\outputs\apk\debug\app-debug.apk"
    if (-not (Test-Path -LiteralPath $apk -PathType Leaf)) {
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

    Write-BuildStage -Percent 90 -Message "准备最终构建产物"
    New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null

    $desktopDest = $null
    $apkDest = $null
    $trashRoot = $null

    # Renaming large old desktop folders inside the same output directory is nearly
    # instantaneous. Defer the physical deletion until after the new output is in place,
    # so the GUI does not spend minutes at a vague "copying" stage.
    if (-not $KeepHistory) {
        if ($HasApk) {
            Write-BuildStage -Percent 91 -Message "清理旧版 APK"
            Get-ChildItem -LiteralPath $OutputRoot -Filter "$outputBaseName-*.apk" -File -ErrorAction SilentlyContinue |
                Remove-Item -Force -ErrorAction SilentlyContinue
        }
        if ($HasDesktop) {
            $oldDesktopDirs = @(Get-ChildItem -LiteralPath $OutputRoot -Directory -Filter "$outputBaseName-*-Desktop" -ErrorAction SilentlyContinue)
            if ($oldDesktopDirs.Count -gt 0) {
                $trashRoot = Join-Path $OutputRoot (".pydroid-finalize-trash-{0}" -f ([guid]::NewGuid().ToString("N")))
                New-Item -ItemType Directory -Force -Path $trashRoot | Out-Null
                foreach ($oldDir in $oldDesktopDirs) {
                    try {
                        Move-Item -LiteralPath $oldDir.FullName -Destination (Join-Path $trashRoot $oldDir.Name) -Force -ErrorAction Stop
                    } catch {
                        # Fallback for unusual filesystems/locks. This remains visible as its own stage.
                        Write-BuildStage -Percent 92 -Message "清理旧版桌面产物"
                        Remove-Item -LiteralPath $oldDir.FullName -Recurse -Force -ErrorAction SilentlyContinue
                    }
                }
            }
        }
    }

    if ($HasApk) {
        Write-BuildStage -Percent 93 -Message "复制 Android APK"
        $apkDest = Join-Path $OutputRoot "$outputBaseName-$version.apk"
        Copy-Item -LiteralPath $ApkSource -Destination $apkDest -Force
    }

    if ($HasDesktop) {
        Write-BuildStage -Percent 94 -Message "整理 Windows Desktop 产物"
        $desktopDest = Join-Path $OutputRoot "$outputBaseName-$version-Desktop"
        $unpacked = Join-Path $workspace "release\win-unpacked"
        if (-not (Test-Path -LiteralPath $unpacked -PathType Container)) {
            throw "未找到 Windows Desktop 打包目录：$unpacked"
        }

        if (Test-Path -LiteralPath $desktopDest) {
            if (-not $trashRoot) {
                $trashRoot = Join-Path $OutputRoot (".pydroid-finalize-trash-{0}" -f ([guid]::NewGuid().ToString("N")))
                New-Item -ItemType Directory -Force -Path $trashRoot | Out-Null
            }
            try { Move-Item -LiteralPath $desktopDest -Destination (Join-Path $trashRoot (Split-Path $desktopDest -Leaf)) -Force -ErrorAction Stop }
            catch { Remove-Item -LiteralPath $desktopDest -Recurse -Force -ErrorAction SilentlyContinue }
        }

        $sourceRoot = [System.IO.Path]::GetPathRoot((Resolve-AbsolutePath $unpacked))
        $destRoot = [System.IO.Path]::GetPathRoot((Resolve-AbsolutePath $OutputRoot))
        if ($sourceRoot -and $destRoot -and $sourceRoot.Equals($destRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
            # Same volume: directory rename/move avoids copying the bundled Electron/Python
            # tree file-by-file and is normally almost instantaneous.
            Write-Step "同盘快速移动桌面版到 $desktopDest"
            Move-Item -LiteralPath $unpacked -Destination $desktopDest -Force
        }
        else {
            # Cross-volume output cannot be renamed. Use multithreaded unbuffered robocopy.
            Write-Step "跨盘复制未压缩桌面版到 $desktopDest"
            $robocopyArgs = @($unpacked, $desktopDest, "/E", "/MT:16", "/J", "/R:2", "/W:1", "/NFL", "/NDL", "/NJH", "/NJS", "/NP")
            & robocopy @robocopyArgs
            $robocopyExitCode = $LASTEXITCODE
            if ($robocopyExitCode -ge 8) { throw "桌面版复制失败，robocopy 退出码 $robocopyExitCode。" }
        }
    }

    Write-BuildStage -Percent 96 -Message "最终产物已就位"

    if ($trashRoot -and (Test-Path -LiteralPath $trashRoot -PathType Container)) {
        Write-BuildStage -Percent 97 -Message "清理旧版本产物"
        # cmd rmdir is substantially faster than PowerShell Remove-Item for a large
        # Electron tree and does not leave a background worker/process behind.
        & $env:ComSpec /d /s /c ('rmdir /s /q "{0}"' -f $trashRoot) | Out-Null
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
Write-Step "构建脚本修订：$script:BuildScriptRevision"
Write-Step "实际脚本路径：$PSCommandPath"
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
Write-Step "共享工具目录（只读）：$ToolRoot"
Write-Step "PyDroid 临时工具目录（可写）：$privateToolsRoot"
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
$selectedNodeExe = Join-Path $script:NodeDir "node.exe"
if (-not (Test-NodeCandidate -Executable $selectedNodeExe)) {
    $selectedNodeVersion = try { [string]((& $selectedNodeExe --version | Select-Object -Last 1)).Trim() } catch { "unknown" }
    throw ("内部错误：最终选定的 Node 不满足项目版本要求。实际={0}；路径={1}；要求={2}+ 同主版本。" -f $selectedNodeVersion, $selectedNodeExe, $NodeVersion)
}
# 共享 ToolRoot 只读；仅把已存在的 Node 放到 PATH，再探测 pnpm/corepack。
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

# 默认启用 Gradle daemon；仅在 -DisableGradleDaemon 时修补工作区脚本。
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

# 默认仅清理最终打包产物，保留 Android 增量构建缓存。
# 需要彻底重编译时使用 -CleanBuild。
Write-BuildStage -Percent 40 -Message $(if ($CleanBuild) { "执行完整清理构建" } else { "清理旧打包产物（保留 Android 增量缓存）" })
Clear-WorkspaceOutputs -IncludeAndroidBuild:$CleanBuild

$apkSource = $null
$hasApk = -not $SkipAndroid
$hasDesktop = -not $SkipDesktop
$script:ResolvedAndroidPython = $null

# Fail fast on Android build-Python problems before spending time on Electron packaging.
# Android buildPython and the packaged desktop Python are intentionally separate:
# Chaquopy needs a FULL Python 3.13 with venv; the desktop runtime is the embeddable build.
if ($hasApk) {
    Write-BuildStage -Percent 45 -Message "预检 Android 完整 Python 3.13（需要 venv）"
    $pythonPreflight = Find-Python313
    if (-not $pythonPreflight) {
        $pythonPreflight = Install-Python313
    }
    $pythonPreflight = [string]$pythonPreflight
    if (-not (Test-PythonBuildHost -Executable $pythonPreflight)) {
        throw ("Android Python 预检失败：需要带 venv 的完整 Python {0}，当前解释器为 {1}（检测版本：{2}）。" -f $pythonSeries, $pythonPreflight, (Get-PythonVersionLabel $pythonPreflight))
    }
    $script:ResolvedAndroidPython = $pythonPreflight
    Write-Step ("Android 完整 Python 预检通过：{0}（Python {1}，venv 可用）" -f $pythonPreflight, (Get-PythonVersionLabel $pythonPreflight))
}

if ($hasDesktop) {
    Build-Desktop
}

if ($hasApk) {
    $apkResult = @(Build-Android)
    if ($apkResult.Count -ne 1) {
        $preview = ($apkResult | ForEach-Object { [string]$_ } | Select-Object -First 5) -join " | "
        throw ("Android 构建函数返回了 {0} 个成功输出项，而不是唯一 APK 路径。输出预览：{1}" -f $apkResult.Count, $preview)
    }
    $apkSource = [string]$apkResult[0]
    if ([string]::IsNullOrWhiteSpace($apkSource) -or -not (Test-Path -LiteralPath $apkSource -PathType Leaf)) {
        throw "Android 构建返回的 APK 路径无效：$apkSource"
    }
}

Copy-Outputs -ApkSource $apkSource -HasApk:$hasApk -HasDesktop:$hasDesktop

# 构建后默认仅清理 release/dist 等可再生打包产物。
# Android Gradle/build 目录默认保留，为下一次增量构建加速。
if (-not $KeepWorkspace) {
    Write-BuildStage -Percent 97 -Message "清理临时打包产物（保留 Android 增量缓存）"
    Clear-WorkspaceOutputs
} else {
    Write-Host "保留工作区用于排查：$workspace" -ForegroundColor DarkYellow
}

Write-BuildStage -Percent 100 -Message "构建完成"
Write-Host ""
Write-Host "提示：如需查看脚本帮助，运行：" -ForegroundColor DarkGray
Write-Host "  powershell -ExecutionPolicy Bypass -File "$PSCommandPath" -?" -ForegroundColor DarkGray
