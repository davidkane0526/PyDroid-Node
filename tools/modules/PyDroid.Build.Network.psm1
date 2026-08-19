# PyDroid Phase 7 build-tool module. Windows PowerShell 5.1 compatible.

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

function Set-PyDroidBuildNetwork {
    param(
        [ValidateSet('Auto','Direct','Manual')][string]$NetworkMode,
        [string]$ProxyUrl,
        [string]$RegistryUrl,
        [int]$DownloadRetryCount,
        [int]$PnpmFetchTimeoutSeconds,
        [int]$PnpmNetworkConcurrency,
        [Parameter(Mandatory = $true)][scriptblock]$WriteStep
    )
    $resolvedProxyUrl = $null
    $resolvedProxySource = 'direct'

    if ($NetworkMode -eq 'Direct') {
        foreach ($name in @('HTTPS_PROXY','HTTP_PROXY','https_proxy','http_proxy','ALL_PROXY','all_proxy','GLOBAL_AGENT_HTTP_PROXY','GLOBAL_AGENT_HTTPS_PROXY','ELECTRON_GET_USE_PROXY','npm_config_proxy','npm_config_https_proxy','PNPM_CONFIG_PROXY','PNPM_CONFIG_HTTPS_PROXY')) {
            Remove-Item "Env:$name" -ErrorAction SilentlyContinue
        }
        & $WriteStep '网络模式：直连（已清除本次构建进程的 HTTP/HTTPS 代理环境变量）'
    } elseif ($NetworkMode -eq 'Manual') {
        if ([string]::IsNullOrWhiteSpace($ProxyUrl)) { throw '网络模式为 Manual，但未填写 ProxyUrl。' }
        $resolvedProxyUrl = Normalize-ProxyUrl $ProxyUrl
        $resolvedProxySource = 'manual'
    } else {
        foreach ($name in @('HTTPS_PROXY','https_proxy','HTTP_PROXY','http_proxy','ALL_PROXY','all_proxy','npm_config_https_proxy','npm_config_proxy','PNPM_CONFIG_HTTPS_PROXY','PNPM_CONFIG_PROXY')) {
            $candidate = [Environment]::GetEnvironmentVariable($name, 'Process')
            if (-not [string]::IsNullOrWhiteSpace($candidate)) {
                $resolvedProxyUrl = Normalize-ProxyUrl $candidate
                $resolvedProxySource = "environment:$name"
                break
            }
        }
        if (-not $resolvedProxyUrl) {
            $systemProxy = Get-WindowsInternetProxy
            if ($systemProxy) {
                $resolvedProxyUrl = $systemProxy
                $resolvedProxySource = 'Windows Internet Settings'
            }
        }
    }

    if ($resolvedProxyUrl) {
        if (-not (Test-LocalProxyEndpoint $resolvedProxyUrl)) {
            throw "检测到本地代理 $resolvedProxyUrl，但代理端口不可访问。请启动代理软件，或在 GUI 中选择‘直连’/填写正确的手动代理。"
        }
        $env:HTTPS_PROXY = $resolvedProxyUrl
        $env:HTTP_PROXY = $resolvedProxyUrl
        $env:https_proxy = $resolvedProxyUrl
        $env:http_proxy = $resolvedProxyUrl
        $env:ALL_PROXY = $resolvedProxyUrl
        $env:all_proxy = $resolvedProxyUrl
        $env:ELECTRON_GET_USE_PROXY = '1'
        $env:GLOBAL_AGENT_HTTP_PROXY = $resolvedProxyUrl
        $env:GLOBAL_AGENT_HTTPS_PROXY = $resolvedProxyUrl
        $env:npm_config_proxy = $resolvedProxyUrl
        $env:npm_config_https_proxy = $resolvedProxyUrl
        $env:PNPM_CONFIG_PROXY = $resolvedProxyUrl
        $env:PNPM_CONFIG_HTTPS_PROXY = $resolvedProxyUrl
        & $WriteStep "网络代理：$resolvedProxyUrl（来源：$resolvedProxySource）"
    } elseif ($NetworkMode -eq 'Auto') {
        & $WriteStep '网络代理：未检测到环境变量或 Windows 固定代理，本次 pnpm 使用直连。'
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
    $env:PNPM_CONFIG_FETCH_RETRIES = $fetchRetries
    $env:PNPM_CONFIG_FETCH_TIMEOUT = $fetchTimeoutMs
    $env:PNPM_CONFIG_NETWORK_CONCURRENCY = $networkConcurrency
    $env:npm_config_fetch_retries = $fetchRetries
    $env:npm_config_fetch_timeout = $fetchTimeoutMs
    $env:npm_config_network_concurrency = $networkConcurrency
    & $WriteStep "pnpm 网络参数：timeout=$PnpmFetchTimeoutSeconds s；retries=$([Math]::Max(2, $DownloadRetryCount))；concurrency=$PnpmNetworkConcurrency；prefer-offline=on"
    if ($RegistryUrl) { & $WriteStep "npm registry：$RegistryUrl" }

    return [pscustomobject]@{ ProxyUrl = $resolvedProxyUrl; ProxySource = $resolvedProxySource }
}

Export-ModuleMember -Function 'Normalize-ProxyUrl', 'Get-WindowsInternetProxy', 'Test-LocalProxyEndpoint', 'Set-PyDroidBuildNetwork'
