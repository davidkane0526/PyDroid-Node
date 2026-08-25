<#
.SYNOPSIS
    构建 PyDroid Flow：Android debug APK + Windows 未压缩桌面版（win-unpacked），只读复用 DK 共享工具链，并将写入集中到独立临时目录/缓存。

.DESCRIPTION
    - 项目源码目录保持只读，脚本只读取项目，不写入任何项目文件。
    - 脚本把源码同步到 $WorkRoot\builds\<项目名> 临时工作区，在外部完成构建。
    - 显式工具路径是严格覆盖；未显式指定时只读发现本机已安装工具并验证版本/完整性。
    - 本机发现与自动安装严格分离：可以读取环境变量、常见安装位置、注册表/PATH 等现有信息，但绝不自动下载或修改系统工具链。
    - 最终产物平铺到 $OutputRoot：
          <productName>-<版本>.apk
          <productName>-Desktop\          （默认稳定路径，win-unpacked 未压缩桌面版）
    - 每次构建开始前清理可再生打包产物；Android Gradle/增量构建缓存默认保留，
      使用 -CleanBuild 时在构建开始前一并删除。

.PARAMETER ProjectRoot
    项目源码根目录。缺省时使用当前目录（要求当前目录含 package.json）。

.PARAMETER ToolRoot
    跨项目共享工具根目录（只读）。默认 DK_TOOL_ROOT，否则固定 D:\Code。构建器不会向此目录写入、安装或更新任何文件。

.PARAMETER CacheRoot
    构建缓存目录。默认读取 DK_CACHE_ROOT；否则使用 WorkRoot\cache。用于 pnpm store、npm、Electron、electron-builder、Gradle 与下载缓存；不会默认落到 ToolRoot。

.PARAMETER WorkRoot
    临时工作区目录。默认读取 PYDROID_BUILD_HOME，否则固定 D:\PyDroidTemp。

.PARAMETER OutputRoot
    最终产物输出目录。默认等于 WorkRoot。

.PARAMETER SkipAndroid
    跳过 Android APK 构建。

.PARAMETER SkipDesktop
    跳过桌面版构建。

.PARAMETER KeepHistory
    当前 Windows Desktop 始终覆盖稳定的 PyDroid-Flow-Desktop。
    加此参数仅额外保留版本归档，不改变当前可运行 Desktop 的固定路径。


.PARAMETER CleanBuild
    执行完整清理构建。启用后会删除 android\.gradle、android\app\build、
    android\build 和 capacitor-cordova-android-plugins\build。
    默认不删除这些目录，以复用 Gradle 增量构建缓存。

.PARAMETER DisableGradleDaemon
    禁用 Gradle daemon。默认启用并复用 daemon；仅当安全软件或系统策略明确阻止
    Gradle daemon 启动时才建议使用此开关。


.PARAMETER NodeExecutable
    可选 Node.js 可执行文件。显式填写时严格使用该路径；留空时从专用环境变量、ToolRoot、系统安装位置/PATH 中只读发现满足版本要求的 Node。

.PARAMETER PnpmExecutable
    可选 pnpm.cmd/pnpm.exe。显式填写时严格使用该路径；留空时从专用环境变量、用户级 pnpm/npm 目录和 PATH 中只读发现。不会调用 Corepack，也不会自动安装 pnpm。

.PARAMETER JavaHome
    JDK 根目录、bin 目录或 java.exe/javac.exe。显式填写时严格使用；留空时从环境变量、ToolRoot、常见安装目录、Java 注册表和 PATH 中只读发现指定主版本 JDK。

.PARAMETER AndroidSdkHome
    Android SDK 根目录。显式填写时严格使用；留空时从专用环境变量、ANDROID_HOME/ANDROID_SDK_ROOT、%LOCALAPPDATA%\Android\Sdk、ToolRoot 与 WorkRoot 中只读发现包含所需 compile SDK 的现有 SDK。

.PARAMETER PythonExecutable
    Android/Chaquopy 构建用完整 Python 3.13。显式填写时严格使用；留空时从专用环境变量、WorkRoot/ToolRoot、本机 Python 安装、py launcher 和 PATH 中只读发现 64 位且含 venv/ensurepip 的完整 Python。

.PARAMETER DesktopPythonRuntime
    桌面打包用便携 Python 运行时目录。留空时使用 PYDROID_DESKTOP_PYTHON_RUNTIME，否则固定 WorkRoot\tools\<project>\Python\runtime-3.13。

.PARAMETER AndroidApiLevel
    Android compile SDK；0 表示从 android/variables.gradle 自动读取。

.PARAMETER ElectronMirror
    可选 Electron 下载镜像地址。

.PARAMETER ElectronBuilderMirror
    可选 electron-builder binaries 镜像地址。

.PARAMETER NetworkMode
    网络模式：Direct 直连；Manual 使用显式 ProxyUrl。构建器不读取 Windows 系统代理。

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
    [switch]$SkipAndroid,
    [switch]$SkipDesktop,
    [switch]$KeepHistory,
    [switch]$CleanBuild,
    [switch]$DisableGradleDaemon,
    [string]$NodeVersion,
    [int]$AndroidApiLevel = 0,
    [int]$JdkMajor = 21,
    [string]$NodeExecutable,
    [string]$PnpmExecutable,
    [string]$JavaHome,
    [string]$AndroidSdkHome,
    [string]$PythonExecutable,
    [string]$DesktopPythonRuntime,
    [string]$ElectronMirror,
    [string]$ElectronBuilderMirror,
    [ValidateSet("Direct", "Manual")]
    [string]$NetworkMode = "Direct",
    [string]$ProxyUrl,
    [string]$RegistryUrl,
    [ValidateRange(60, 3600)]
    [int]$PnpmFetchTimeoutSeconds = 600,
    [ValidateRange(1, 64)]
    [int]$PnpmNetworkConcurrency = 16
)

$script:BuildScriptRevision = "1.6.36-dev-r131-theme-node-layout-contract"

$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Phase 7 build-tool modules. Keep CLI orchestration in this file; reusable platform/tool helpers live in focused modules.
$buildModuleRoot = Join-Path $PSScriptRoot "modules"
foreach ($buildModule in @(
    "PyDroid.Build.Network.psm1",
    "PyDroid.Build.Paths.psm1",
    "PyDroid.Build.Java.psm1",
    "PyDroid.Build.Android.psm1",
    "PyDroid.Build.Node.psm1",
    "PyDroid.Build.Python.psm1",
    "PyDroid.Build.Packaging.psm1"
)) {
    $modulePath = Join-Path $buildModuleRoot $buildModule
    if (-not (Test-Path -LiteralPath $modulePath -PathType Leaf)) { throw "缺少构建工具模块：$modulePath" }
    Import-Module -Name $modulePath -Force -Global -DisableNameChecking -ErrorAction Stop
}

# The GUI launches the builder in a fresh Windows PowerShell process. Keep module imports
# global and use module-qualified calls so helper lookup cannot depend on child-process scope.
if (-not (Get-Command 'PyDroid.Build.Paths\Resolve-AbsolutePath' -ErrorAction SilentlyContinue)) {
    throw "构建工具模块加载失败：PyDroid.Build.Paths 未导出 Resolve-AbsolutePath。请确认 tools\modules 与 build-pydroid.ps1 来自同一版本。"
}

function Get-DefaultWorkRoot {
    if ($env:PYDROID_BUILD_HOME) { return $env:PYDROID_BUILD_HOME }
    return "D:\PyDroidTemp"
}

function Get-DefaultToolRoot {
    if ($env:DK_TOOL_ROOT) { return $env:DK_TOOL_ROOT }
    return "D:\Code"
}

function Get-DefaultCacheRoot {
    if ($env:DK_CACHE_ROOT) { return $env:DK_CACHE_ROOT }
    return (Join-Path $WorkRoot "cache")
}





function Configure-Network {
    $network = PyDroid.Build.Network\Set-PyDroidBuildNetwork `
        -NetworkMode $NetworkMode `
        -ProxyUrl $ProxyUrl `
        -RegistryUrl $RegistryUrl `
        -PnpmFetchTimeoutSeconds $PnpmFetchTimeoutSeconds `
        -PnpmNetworkConcurrency $PnpmNetworkConcurrency `
        -WriteStep { param($Message) Write-Step $Message }
    $script:ResolvedProxyUrl = $network.ProxyUrl
    $script:ResolvedProxySource = $network.ProxySource
}

if (-not $WorkRoot) { $WorkRoot = Get-DefaultWorkRoot }
if (-not $ToolRoot) { $ToolRoot = Get-DefaultToolRoot }
if (-not $CacheRoot) { $CacheRoot = Get-DefaultCacheRoot }
if (-not $NodeVersion) { $NodeVersion = if ($env:PYDROID_NODE_VERSION) { $env:PYDROID_NODE_VERSION } else { "24.19.0" } }
$pythonMajor = 3
$pythonMinor = 13
$pythonSeries = "3.13"

if (-not $ProjectRoot) { $ProjectRoot = (Get-Location).Path }

$ProjectRoot = PyDroid.Build.Paths\Resolve-AbsolutePath $ProjectRoot
$ToolRoot    = PyDroid.Build.Paths\Resolve-AbsolutePath $ToolRoot
$CacheRoot   = PyDroid.Build.Paths\Resolve-AbsolutePath $CacheRoot
$WorkRoot    = PyDroid.Build.Paths\Resolve-AbsolutePath $WorkRoot
if (-not $OutputRoot) { $OutputRoot = $WorkRoot }
$OutputRoot  = PyDroid.Build.Paths\Resolve-AbsolutePath $OutputRoot

# ToolRoot is read-only. Invalid configuration fails instead of being rewritten.
if ((PyDroid.Build.Paths\Test-PathWithinRoot -Path $CacheRoot -Root $ToolRoot) -and
    -not (PyDroid.Build.Paths\Test-PathWithinRoot -Path $ToolRoot -Root $WorkRoot)) {
    throw "CacheRoot 不能位于只读 ToolRoot 内：$CacheRoot"
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
$electronSpec = PyDroid.Build.Paths\Get-PackageDependencySpec -PackageObject $package -Name 'electron'
$electronBuilderSpec = PyDroid.Build.Paths\Get-PackageDependencySpec -PackageObject $package -Name 'electron-builder'
$electronLockedVersion = PyDroid.Build.Paths\Get-PnpmLockedVersion -Root $ProjectRoot -Name 'electron'
$electronBuilderLockedVersion = PyDroid.Build.Paths\Get-PnpmLockedVersion -Root $ProjectRoot -Name 'electron-builder'
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
$resolvedAndroidApi = PyDroid.Build.Android\Get-ProjectAndroidApiLevel -Root $ProjectRoot -Override $AndroidApiLevel

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
$storeDir  = Join-Path $CacheRoot "pnpm-store"
$gradleHome = Join-Path (Join-Path $CacheRoot "gradle") $projectKey
$electronCache = Join-Path $CacheRoot "electron"
$electronBuilderCache = Join-Path $CacheRoot "electron-builder"
$npmCache = Join-Path $CacheRoot "npm"

foreach ($d in @($CacheRoot, $WorkRoot, $OutputRoot, $privateToolsRoot, $workspace, $storeDir, $gradleHome, $electronCache, $electronBuilderCache, $npmCache)) {
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

function Write-BuildArtifact {
    param(
        [Parameter(Mandatory=$true)][ValidateSet("windows", "android")][string]$Platform,
        [Parameter(Mandatory=$true)][string]$Path
    )
    if ([string]::IsNullOrWhiteSpace($Path)) { return }
    Write-Host ("@@PYDROID_ARTIFACT@@|{0}|{1}" -f $Platform, ($Path -replace '[\r\n|]+', ' '))
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


# ---------------------------------------------------------------
# Node / pnpm
# ---------------------------------------------------------------

$script:NodeDir = $null
$script:PnpmCommand = $null

function Test-NodeCandidate {
    param([Parameter(Mandatory = $true)][string]$Executable)
    return (PyDroid.Build.Node\Test-PyDroidNodeCandidate -Executable $Executable -RequiredVersion $NodeVersion)
}

function Resolve-NodeExecutable {
    return (PyDroid.Build.Node\Resolve-PyDroidNodeExecutable -ConfiguredExecutable $NodeExecutable -ToolRoot $ToolRoot -RequiredVersion $NodeVersion)
}

function Resolve-PnpmExecutable {
    $required = if ($packageManagerSpec -match '^pnpm@([^+]+)') { [string]$matches[1] } else { '11.21.0' }
    return (PyDroid.Build.Node\Resolve-PyDroidPnpmExecutable -ConfiguredExecutable $PnpmExecutable -RequiredVersion $required)
}

function Invoke-Pnpm {
    param([string[]]$Arguments)
    Push-Location $workspace
    try {
        & $script:PnpmCommand @Arguments | ForEach-Object { Write-Host ([string]$_) }
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
        $output = & $script:PnpmCommand "--version" 2>$null
        if ($LASTEXITCODE -eq 0 -and $output) { return [string](($output | Select-Object -Last 1).Trim()) }
    } finally { Pop-Location }
    return $null
}

# ---------------------------------------------------------------
# Java / Android SDK / Python
# ---------------------------------------------------------------




function Test-JavaHome {
    param([string]$JavaHomePath)
    $major = PyDroid.Build.Java\Get-JavaMajorVersion $JavaHomePath
    return ($null -ne $major -and $major -eq $JdkMajor)
}

function Find-JavaHome {
    return (PyDroid.Build.Java\Resolve-PyDroidJavaHome -ConfiguredHome $JavaHome -ToolRoot $ToolRoot -RequiredMajor $JdkMajor)
}

function Find-AndroidSdk {
    return (PyDroid.Build.Android\Resolve-PyDroidAndroidSdk -ConfiguredSdk $AndroidSdkHome -ToolRoot $ToolRoot -WorkRoot $WorkRoot -RequiredApi $resolvedAndroidApi)
}

function Test-PythonSeries {
    param([Parameter(Mandatory = $true)][string]$Executable)
    return (PyDroid.Build.Python\Test-PyDroidPythonSeries -Executable $Executable -Major $pythonMajor -Minor $pythonMinor)
}

function Test-PythonBuildHost {
    param([Parameter(Mandatory = $true)][string]$Executable)
    return (PyDroid.Build.Python\Test-PyDroidPythonBuildHost -Executable $Executable -Major $pythonMajor -Minor $pythonMinor)
}

function Find-Python313 {
    $python = PyDroid.Build.Python\Resolve-PyDroidPythonExecutable -ConfiguredExecutable $PythonExecutable -WorkRoot $WorkRoot -ToolRoot $ToolRoot -Major $pythonMajor -Minor $pythonMinor
    if ([string]::IsNullOrWhiteSpace([string]$python)) {
        return $null
    }
    if (-not (Test-PythonBuildHost -Executable $python)) {
        throw "Android buildPython 配置无效：$python。需要完整 64 位 Python $pythonSeries，并包含 venv/ensurepip。"
    }
    return $python
}

function Remove-BuildDirectory {
    param([Parameter(Mandatory = $true)][string]$Path)
    PyDroid.Build.Packaging\Remove-PyDroidBuildDirectory -Path $Path
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
            Remove-BuildDirectory -Path $full
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
        "/R:0", "/W:0",
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

function Ensure-PythonRuntimeForDesktop {
    $runtimeTarget = if ($DesktopPythonRuntime) {
        $DesktopPythonRuntime
    } elseif ($env:PYDROID_DESKTOP_PYTHON_RUNTIME) {
        $env:PYDROID_DESKTOP_PYTHON_RUNTIME
    } else {
        Join-Path $privateToolsRoot 'Python\runtime-3.13'
    }
    $runtimeTarget = [Environment]::ExpandEnvironmentVariables(([string]$runtimeTarget).Trim().Trim('"'))
    $python = Join-Path $runtimeTarget 'python.exe'
    if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
        throw "桌面 Python 运行时不存在：$runtimeTarget。请显式设置 -DesktopPythonRuntime 或 PYDROID_DESKTOP_PYTHON_RUNTIME。"
    }

    $runtimeDestination = Join-Path $workspace '.tools\python313-runtime'
    if (Test-Path -LiteralPath $runtimeDestination) { Remove-BuildDirectory -Path $runtimeDestination }
    New-Item -ItemType Directory -Force -Path (Split-Path $runtimeDestination -Parent) | Out-Null
    Copy-Item -LiteralPath $runtimeTarget -Destination $runtimeDestination -Recurse
    Write-Step "桌面 Python 运行时：$runtimeTarget"
}

# ---------------------------------------------------------------
# 构建步骤
# ---------------------------------------------------------------

function Build-Desktop {
    Write-BuildStage -Percent 48 -Message "准备 Windows Desktop 构建环境"
    Write-Step "构建未压缩桌面版（win-unpacked）..."
    Ensure-PythonRuntimeForDesktop
    $env:ELECTRON_CACHE = $electronCache
    $env:ELECTRON_BUILDER_CACHE = $electronBuilderCache
    if ($ElectronMirror) { $env:ELECTRON_MIRROR = $ElectronMirror }
    if ($ElectronBuilderMirror) { $env:ELECTRON_BUILDER_BINARIES_MIRROR = $ElectronBuilderMirror }
    New-Item -ItemType Directory -Force -Path $env:ELECTRON_CACHE | Out-Null
    New-Item -ItemType Directory -Force -Path $env:ELECTRON_BUILDER_CACHE | Out-Null

    Write-BuildStage -Percent 55 -Message "构建 Windows Desktop"
    $desktopPackageScript = Join-Path $workspace "scripts\desktop-package.mjs"
    if (-not (Test-Path -LiteralPath $desktopPackageScript -PathType Leaf)) {
        throw "桌面打包入口不存在：$desktopPackageScript"
    }
    Write-Step "使用已验证 Node 直接启动桌面打包：$script:NodeExecutable"
    & $script:NodeExecutable $desktopPackageScript
    if ($LASTEXITCODE -ne 0) {
        throw "桌面打包失败（退出码 $LASTEXITCODE）：$script:NodeExecutable $desktopPackageScript"
    }

    $unpacked = Join-Path $workspace "release\win-unpacked"
    if (-not (Test-Path -LiteralPath $unpacked) -or -not (Get-ChildItem -LiteralPath $unpacked -Filter "*.exe" -File -ErrorAction SilentlyContinue)) {
        throw "桌面版构建完成但未找到 release\win-unpacked\*.exe。"
    }
}

function Configure-GradleNetwork {
    $gradleArgs = @('-Xms64m', '-Xmx1536m')
    if (-not [string]::IsNullOrWhiteSpace([string]$script:ResolvedProxyUrl)) {
        $proxyUri = [Uri]$script:ResolvedProxyUrl
        if ($proxyUri.Scheme -notin @('http', 'https')) { throw "Gradle 仅接受 HTTP/HTTPS 代理：$script:ResolvedProxyUrl" }
        $gradleArgs += "-Dhttp.proxyHost=$($proxyUri.Host)"
        $gradleArgs += "-Dhttp.proxyPort=$($proxyUri.Port)"
        $gradleArgs += "-Dhttps.proxyHost=$($proxyUri.Host)"
        $gradleArgs += "-Dhttps.proxyPort=$($proxyUri.Port)"
    }
    $env:GRADLE_OPTS = ($gradleArgs -join ' ')
}

function Build-Android {
    Write-BuildStage -Percent 68 -Message "检查 Android JDK、SDK 与 Python 3.13"
    Write-Step "构建 Android debug APK ..."

    $jdk = Find-JavaHome
    if (-not $jdk) {
        throw "未找到 JDK $JdkMajor。已检查显式配置、环境变量、ToolRoot、常见安装目录、注册表和 PATH；构建器不会自动下载安装。"
    }
    $jdk = [string]$jdk
    Write-Step ("JDK {0}：{1}" -f $JdkMajor, $jdk)

    # sdkmanager 本身依赖 Java，所以必须先启用已经确认的 JDK。
    $env:JAVA_HOME = $jdk
    $env:Path = "$(Join-Path $jdk 'bin');$env:Path"

    $sdk = Find-AndroidSdk
    if ([string]::IsNullOrWhiteSpace([string]$sdk)) {
        throw "未找到包含 android-$resolvedAndroidApi 的 Android SDK。已检查显式配置、环境变量、%LOCALAPPDATA%\Android\Sdk、ToolRoot 和 WorkRoot；构建器不会自动安装或覆盖 SDK。"
    }
    $sdk = [string]$sdk

    if ([string]::IsNullOrWhiteSpace($sdk) -or -not (Test-Path -LiteralPath $sdk -PathType Container)) {
        throw "Android SDK 根目录无效：$sdk"
    }

    $requiredPlatformJar = Join-Path $sdk ("platforms\android-{0}\android.jar" -f $resolvedAndroidApi)
    if (-not (Test-Path -LiteralPath $requiredPlatformJar -PathType Leaf)) {
        throw "Android SDK Platform $resolvedAndroidApi 不完整：$requiredPlatformJar"
    }

    $python = if ($script:ResolvedAndroidPython) { [string]$script:ResolvedAndroidPython } else { Find-Python313 }
    if (-not $python) {
        throw "未找到带 venv/ensurepip 的完整 Python $pythonSeries。已检查显式配置、WorkRoot/ToolRoot、本机 Python、py launcher 和 PATH；构建器不会自动下载安装。"
    }
    $python = [string]$python
    if (-not (Test-PythonBuildHost -Executable $python)) {
        throw ("Android 构建要求带 venv 的完整 Python {0}，但解析到的解释器不满足要求：{1}（检测版本：{2}）。" -f $pythonSeries, $python, (PyDroid.Build.Python\Get-PythonVersionLabel $python))
    }
    Write-Step ("Android buildPython：{0}（Python {1}）" -f $python, (PyDroid.Build.Python\Get-PythonVersionLabel $python))

    $env:JAVA_HOME = $jdk
    $env:ANDROID_HOME = $sdk
    $env:ANDROID_SDK_ROOT = $sdk
    $env:GRADLE_USER_HOME = $gradleHome
    $env:PYDROID_PYTHON_EXECUTABLE = $python

    # Gradle Wrapper 是独立 Java 进程，需要显式配置 JVM 代理。
    # 同时提高 distribution 下载超时，避免 services.gradle.org 默认 10 秒超时。
    Configure-GradleNetwork

    Write-Step "Android 构建环境"
    Write-Host "JAVA_HOME：$env:JAVA_HOME"
    Write-Host "ANDROID_HOME：$env:ANDROID_HOME"
    Write-Host "ANDROID_SDK_ROOT：$env:ANDROID_SDK_ROOT"
    Write-Host "Python：$env:PYDROID_PYTHON_EXECUTABLE"
    Write-Host "GRADLE_USER_HOME：$env:GRADLE_USER_HOME"

    # Android 打包脚本只执行用户选定的 daemon 模式，不做自动恢复或降级。
    $env:PYDROID_DISABLE_GRADLE_DAEMON = if ($DisableGradleDaemon) { "1" } else { "0" }

    Write-BuildStage -Percent 78 -Message "准备 Android Gradle 构建"
    if ($DisableGradleDaemon) {
        Write-Step "Gradle daemon 已禁用；本次构建使用独立 JVM。"
    } else {
        Write-Step "Gradle daemon 已启用；失败时直接报告 Gradle 原始错误。"
    }

    Write-BuildStage -Percent 80 -Message "同步 Web 资源与 Capacitor Android 工程"
    # GUI 构建在这里完成一次 Android Web/Capacitor 同步，随后直接进入 Gradle。
    Invoke-Pnpm @("android:sync")

    Write-BuildStage -Percent 82 -Message "编译 Android APK"
    $androidPackageScript = Join-Path $workspace "scripts\android-package.ps1"
    if (-not (Test-Path -LiteralPath $androidPackageScript -PathType Leaf)) {
        throw "未找到 Android 打包脚本：$androidPackageScript"
    }
    $previousSkipSync = [string]$env:PYDROID_SKIP_ANDROID_SYNC
    $env:PYDROID_SKIP_ANDROID_SYNC = "1"
    try {
        & $androidPackageScript | ForEach-Object { Write-Host ([string]$_) }
    } finally {
        if ([string]::IsNullOrEmpty($previousSkipSync)) { Remove-Item Env:PYDROID_SKIP_ANDROID_SYNC -ErrorAction SilentlyContinue }
        else { $env:PYDROID_SKIP_ANDROID_SYNC = $previousSkipSync }
    }
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

    if (-not $KeepHistory) {
        if ($HasApk) {
            foreach ($oldApk in @(Get-ChildItem -LiteralPath $OutputRoot -Filter "$outputBaseName-*.apk" -File -ErrorAction SilentlyContinue)) {
                Remove-Item -LiteralPath $oldApk.FullName -Force -ErrorAction Stop
            }
        }
        if ($HasDesktop) {
            foreach ($oldDir in @(Get-ChildItem -LiteralPath $OutputRoot -Directory -Filter "$outputBaseName-*-Desktop" -ErrorAction SilentlyContinue)) {
                Remove-BuildDirectory -Path $oldDir.FullName
            }
        }
    }

    if ($HasApk) {
        Write-BuildStage -Percent 93 -Message "复制 Android APK"
        $apkDest = Join-Path $OutputRoot "$outputBaseName-$version.apk"
        Copy-Item -LiteralPath $ApkSource -Destination $apkDest -Force -ErrorAction Stop
        Write-BuildArtifact -Platform "android" -Path $apkDest
        Write-Host "Android 输出：$apkDest" -ForegroundColor Yellow
    }

    if ($HasDesktop) {
        Write-BuildStage -Percent 94 -Message "整理 Windows Desktop 产物"
        # The runnable Desktop path is intentionally stable. KeepHistory only creates an archive;
        # it must never change the executable path Windows sees for the current application.
        $desktopDest = Join-Path $OutputRoot "$outputBaseName-Desktop"
        $desktopArchive = if ($KeepHistory) { Join-Path $OutputRoot "$outputBaseName-$version-Desktop" } else { $null }
        $unpacked = Join-Path $workspace 'release\win-unpacked'
        if (-not (Test-Path -LiteralPath $unpacked -PathType Container)) { throw "未找到 Windows Desktop 打包目录：$unpacked" }
        # Mirror the new package directly onto the stable output. Do not recursively
        # delete the old Electron tree first: Windows PowerShell 5.1 is unreliable on
        # deeply nested Capacitor/Gradle paths. robocopy /MIR is the one deterministic
        # replacement operation; a non-success exit code fails the build immediately.
        $robocopyArgs = @($unpacked, $desktopDest, '/MIR', '/MT:16', '/J', '/R:0', '/W:0', '/NFL', '/NDL', '/NJH', '/NJS', '/NP')
        & robocopy @robocopyArgs
        if ($LASTEXITCODE -ge 8) { throw "桌面版镜像更新失败，robocopy 退出码 $LASTEXITCODE。" }
        $global:LASTEXITCODE = 0

        if ($desktopArchive) {
            $archiveArgs = @($desktopDest, $desktopArchive, '/MIR', '/MT:16', '/J', '/R:0', '/W:0', '/NFL', '/NDL', '/NJH', '/NJS', '/NP')
            & robocopy @archiveArgs
            if ($LASTEXITCODE -ge 8) { throw "桌面版历史归档失败，robocopy 退出码 $LASTEXITCODE。" }
            $global:LASTEXITCODE = 0
            Write-Host "Windows 历史归档：$desktopArchive" -ForegroundColor DarkGray
        }

        Write-BuildArtifact -Platform "windows" -Path $desktopDest
        Write-Host "Windows 当前输出（固定路径）：$desktopDest" -ForegroundColor Yellow
        Write-Host "Windows 运行日志（启动应用后生成）：$(Join-Path $desktopDest 'logs\desktop.log')" -ForegroundColor DarkGray
    }

    Write-BuildStage -Percent 96 -Message "最终产物已就位"
    Write-Host ""
    Write-Host "==================== 构建产物已就绪 ====================" -ForegroundColor Green
    Write-Host "版本：$version"
    if ($HasApk) { Write-Host "APK：$apkDest" -ForegroundColor Yellow }
    if ($HasDesktop) { Write-Host "桌面版：$desktopDest" -ForegroundColor Yellow }
    Write-Host "工作区：$workspace"
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
Write-Step "网络模式：$NetworkMode"

# Node / pnpm
Write-BuildStage -Percent 8 -Message "检查 Node、pnpm 与网络配置"
$script:NodeExecutable = Resolve-NodeExecutable
if ([string]::IsNullOrWhiteSpace([string]$script:NodeExecutable)) {
    throw "未找到满足 $NodeVersion 的 Node.js。已检查专用环境变量、ToolRoot、Program Files 和 PATH；构建器不会自动安装 Node。"
}
if (-not (Test-NodeCandidate -Executable $script:NodeExecutable)) {
    throw "Node 配置无效或版本不满足 $NodeVersion：$script:NodeExecutable"
}
$script:NodeDir = Split-Path $script:NodeExecutable -Parent
$script:PnpmCommand = Resolve-PnpmExecutable
if ([string]::IsNullOrWhiteSpace([string]$script:PnpmCommand)) {
    throw "未找到项目要求版本的 pnpm。已检查专用环境变量、LocalAppData、AppData/npm 和 PATH；构建器不会调用 Corepack 或自动安装 pnpm。"
}
if (-not (Test-Path -LiteralPath $script:PnpmCommand -PathType Leaf)) {
    throw "pnpm 配置无效：$script:PnpmCommand"
}
$env:Path = "$script:NodeDir;$env:Path"

$env:npm_config_cache = $npmCache
$env:PNPM_STORE_DIR = $storeDir
$env:ELECTRON_CACHE = $electronCache
$env:ELECTRON_BUILDER_CACHE = $electronBuilderCache
$env:GRADLE_USER_HOME = $gradleHome

# 配置显式网络参数。必须在 pnpm 和后续 Electron 下载之前完成。
Configure-Network

$nodeExe = $script:NodeExecutable
$actualNodeVersion = $null
try { $actualNodeVersion = [string]((& $nodeExe --version | Select-Object -Last 1).Trim()) } catch {}
$actualPnpmVersion = Get-PnpmVersion
Write-Step "实际构建工具"
if ($actualNodeVersion) { Write-Host "Node：$actualNodeVersion（$nodeExe）" } else { Write-Host "Node：$nodeExe" }
if ($actualPnpmVersion) { Write-Host "pnpm：$actualPnpmVersion（$script:PnpmCommand）" } else { Write-Host "pnpm：$script:PnpmCommand" }
if ($packageManagerSpec -match '^pnpm@([^+]+)' -and $actualPnpmVersion) {
    $expectedPnpmVersion = $matches[1]
    if ($expectedPnpmVersion -ne $actualPnpmVersion) {
        throw "pnpm 版本不匹配：项目要求 $expectedPnpmVersion，当前为 $actualPnpmVersion（$script:PnpmCommand）。"
    }
}

# 同步源码到工作区
Sync-Source

# 安装 JS 依赖：执行一次，失败即报告真实错误。
Write-BuildStage -Percent 30 -Message "检查/更新 JS 依赖"
Write-Step "安装/更新 JS 依赖（pnpm install --frozen-lockfile --prefer-offline）..."
$installArgs = @("install", "--frozen-lockfile", "--prefer-offline", "--store-dir", $storeDir)
if ($RegistryUrl) { $installArgs += @("--registry", $RegistryUrl) }
Invoke-Pnpm $installArgs

Write-BuildStage -Percent 40 -Message "JS 依赖已就绪"

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
        throw "Android Python 预检失败：未找到完整 Python $pythonSeries。构建器不会自动下载安装。"
    }
    $pythonPreflight = [string]$pythonPreflight
    if (-not (Test-PythonBuildHost -Executable $pythonPreflight)) {
        throw ("Android Python 预检失败：需要带 venv 的完整 Python {0}，当前解释器为 {1}（检测版本：{2}）。" -f $pythonSeries, $pythonPreflight, (PyDroid.Build.Python\Get-PythonVersionLabel $pythonPreflight))
    }
    $script:ResolvedAndroidPython = $pythonPreflight
    Write-Step ("Android 完整 Python 预检通过：{0}（Python {1}，venv 可用）" -f $pythonPreflight, (PyDroid.Build.Python\Get-PythonVersionLabel $pythonPreflight))
}

if ($hasDesktop) {
    Build-Desktop
    $desktopRaw = Join-Path $workspace "release\win-unpacked"
    Write-BuildArtifact -Platform "windows" -Path $desktopRaw
    Write-Host "Windows Desktop 已编译完成，可直接运行目录：$desktopRaw" -ForegroundColor Green
}

if ($hasApk) {
    $apkResult = @(Build-Android)
    if ($apkResult.Count -ne 1) {
        $preview = ($apkResult | ForEach-Object { [string]$_ } | Select-Object -First 5) -join " | "
        throw ("Android 构建函数返回了 {0} 个成功输出项，而不是唯一 APK 路径。输出预览：{1}" -f $apkResult.Count, $preview)
    }
    $apkSource = [string]$apkResult[0]
    Write-BuildArtifact -Platform "android" -Path $apkSource
    Write-Host "Android APK 已编译完成，可直接安装：$apkSource" -ForegroundColor Green
    if ([string]::IsNullOrWhiteSpace($apkSource) -or -not (Test-Path -LiteralPath $apkSource -PathType Leaf)) {
        throw "Android 构建返回的 APK 路径无效：$apkSource"
    }
}

Copy-Outputs -ApkSource $apkSource -HasApk:$hasApk -HasDesktop:$hasDesktop

# 构建产物就位即完成。不再启动后台清理或其它成功后的隐藏任务。
Write-BuildStage -Percent 100 -Message "构建完成"
Write-Host ""
Write-Host "提示：如需查看脚本帮助，运行：" -ForegroundColor DarkGray
Write-Host "  powershell -ExecutionPolicy Bypass -File "$PSCommandPath" -?" -ForegroundColor DarkGray
