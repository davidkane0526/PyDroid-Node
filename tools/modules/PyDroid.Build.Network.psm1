# PyDroid build network configuration. Windows PowerShell 5.1 compatible.
# Deterministic policy: Direct or an explicitly supplied Manual proxy. No OS proxy discovery,
# endpoint probing, retry policy, or automatic mode switching.

function Normalize-ProxyUrl {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
    $trimmed = $Value.Trim()
    if ($trimmed -match '^[a-zA-Z][a-zA-Z0-9+.-]*://') { return $trimmed }
    return "http://$trimmed"
}

function Set-PyDroidBuildNetwork {
    param(
        [ValidateSet('Direct','Manual')][string]$NetworkMode,
        [string]$ProxyUrl,
        [string]$RegistryUrl,
        [int]$PnpmFetchTimeoutSeconds,
        [int]$PnpmNetworkConcurrency,
        [Parameter(Mandatory = $true)][scriptblock]$WriteStep
    )

    $proxyVariables = @(
        'HTTPS_PROXY','HTTP_PROXY','https_proxy','http_proxy','ALL_PROXY','all_proxy',
        'GLOBAL_AGENT_HTTP_PROXY','GLOBAL_AGENT_HTTPS_PROXY','ELECTRON_GET_USE_PROXY',
        'npm_config_proxy','npm_config_https_proxy','PNPM_CONFIG_PROXY','PNPM_CONFIG_HTTPS_PROXY'
    )

    $resolvedProxyUrl = $null
    if ($NetworkMode -eq 'Direct') {
        foreach ($name in $proxyVariables) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
        & $WriteStep '网络模式：直连'
    } else {
        if ([string]::IsNullOrWhiteSpace($ProxyUrl)) { throw '网络模式为 Manual，但未填写 ProxyUrl。' }
        $resolvedProxyUrl = Normalize-ProxyUrl $ProxyUrl
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
        & $WriteStep "网络模式：手动代理 $resolvedProxyUrl"
    }

    $timeoutMs = [string]($PnpmFetchTimeoutSeconds * 1000)
    $concurrency = [string]$PnpmNetworkConcurrency
    $env:PNPM_CONFIG_FETCH_RETRIES = '0'
    $env:PNPM_CONFIG_FETCH_TIMEOUT = $timeoutMs
    $env:PNPM_CONFIG_NETWORK_CONCURRENCY = $concurrency
    $env:npm_config_fetch_retries = '0'
    $env:npm_config_fetch_timeout = $timeoutMs
    $env:npm_config_network_concurrency = $concurrency
    & $WriteStep "pnpm 网络参数：timeout=$PnpmFetchTimeoutSeconds s；retries=0；concurrency=$PnpmNetworkConcurrency"
    if ($RegistryUrl) { & $WriteStep "npm registry：$RegistryUrl" }

    return [pscustomobject]@{ ProxyUrl = $resolvedProxyUrl; ProxySource = if ($resolvedProxyUrl) { 'manual' } else { 'direct' } }
}

Export-ModuleMember -Function 'Normalize-ProxyUrl', 'Set-PyDroidBuildNetwork'
