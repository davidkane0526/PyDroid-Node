[CmdletBinding()]
param(
    [string]$ProjectRoot
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$script:guiDiagnosticRoot = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "PyDroidBuild\logs"
$script:guiDiagnosticFile = Join-Path $script:guiDiagnosticRoot "gui-last-error.log"
try { New-Item -ItemType Directory -Force -Path $script:guiDiagnosticRoot | Out-Null } catch {}

trap {
    $message = $_.Exception.Message
    $line = if ($_.InvocationInfo -and $_.InvocationInfo.ScriptLineNumber) { $_.InvocationInfo.ScriptLineNumber } else { 0 }
    $details = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] GUI fatal error: $message`r`nScript line: $line`r`n$($_ | Out-String)"
    try { Set-Content -LiteralPath $script:guiDiagnosticFile -Value $details -Encoding UTF8 } catch {}
    try {
        [System.Windows.Forms.MessageBox]::Show(
            "$message`r`n`r`n脚本位置：第 $line 行`r`n诊断日志：$script:guiDiagnosticFile",
            "PyDroid Build GUI 启动失败",
            "OK",
            "Error"
        ) | Out-Null
    } catch {}
    exit 10
}

$coreScript = Join-Path $PSScriptRoot "build-pydroid.ps1"
if (-not (Test-Path -LiteralPath $coreScript)) {
    [System.Windows.Forms.MessageBox]::Show("找不到核心构建脚本：$coreScript", "PyDroid Build", "OK", "Error") | Out-Null
    exit 1
}

function Default-WorkRoot {
    if ($env:PYDROID_BUILD_HOME) { return $env:PYDROID_BUILD_HOME }
    if (Test-Path -LiteralPath "D:\PyDroidTemp") { return "D:\PyDroidTemp" }
    $local = [Environment]::GetFolderPath("LocalApplicationData")
    return (Join-Path $local "PyDroidBuild")
}

function Default-ToolRoot([string]$workRoot) {
    if ($env:DK_TOOL_ROOT) { return $env:DK_TOOL_ROOT }
    if ($env:PYDROID_TOOL_ROOT -and $env:PYDROID_TOOL_ROOT -ine "D:\Code\Language") { return $env:PYDROID_TOOL_ROOT }
    if (Test-Path -LiteralPath "D:\Code\NodeJs\node.exe") { return "D:\Code" }
    if ($env:PYDROID_TOOL_ROOT) { return $env:PYDROID_TOOL_ROOT }
    if (Test-Path -LiteralPath "D:\Code") { return "D:\Code" }
    if (Test-Path -LiteralPath "D:\Code\Language") { return "D:\Code\Language" }
    return (Join-Path $workRoot "tools")
}

function Default-CacheRoot([string]$toolRoot) {
    if ($env:DK_CACHE_ROOT) { return $env:DK_CACHE_ROOT }
    if ($toolRoot) { return (Join-Path $toolRoot "BuildCache") }
    return ""
}

function Resolve-InitialProjectRoot {
    if ($ProjectRoot -and (Test-Path -LiteralPath (Join-Path $ProjectRoot "package.json"))) {
        return [IO.Path]::GetFullPath($ProjectRoot)
    }
    $candidate = Split-Path $PSScriptRoot -Parent
    if (Test-Path -LiteralPath (Join-Path $candidate "package.json")) { return $candidate }
    $current = (Get-Location).Path
    if (Test-Path -LiteralPath (Join-Path $current "package.json")) { return $current }
    return ""
}

function Add-LabeledPathRow {
    param(
        [System.Windows.Forms.TableLayoutPanel]$Panel,
        [int]$Row,
        [string]$Label,
        [string]$Value,
        [scriptblock]$BrowseAction
    )
    $lbl = New-Object System.Windows.Forms.Label
    $lbl.Text = $Label
    $lbl.Dock = "Fill"
    $lbl.TextAlign = "MiddleLeft"
    $lbl.AutoSize = $true

    $tb = New-Object System.Windows.Forms.TextBox
    $tb.Text = $Value
    $tb.Dock = "Fill"

    $btn = New-Object System.Windows.Forms.Button
    $btn.Text = "浏览..."
    $btn.AutoSize = $true
    $btn.Dock = "Fill"
    $btn.Add_Click($BrowseAction)

    [void]$Panel.Controls.Add($lbl, 0, $Row)
    [void]$Panel.Controls.Add($tb, 1, $Row)
    [void]$Panel.Controls.Add($btn, 2, $Row)
    return $tb
}

function Select-Folder([string]$InitialPath) {
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = "选择文件夹"
    if ($InitialPath -and (Test-Path -LiteralPath $InitialPath)) {
        $dialog.SelectedPath = $InitialPath
    }
    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
        return $dialog.SelectedPath
    }
    return $null
}

function Get-PowerShellExecutable {
    try {
        $current = (Get-Process -Id $PID).Path
        if ($current -and ((Split-Path $current -Leaf) -match '^(powershell|pwsh)(\.exe)?$')) { return $current }
    } catch {}
    $pwsh = Get-Command pwsh.exe -ErrorAction SilentlyContinue
    if ($pwsh) { return $pwsh.Source }
    $ps = Get-Command powershell.exe -ErrorAction SilentlyContinue
    if ($ps) { return $ps.Source }
    throw "找不到 powershell.exe 或 pwsh.exe。"
}

function Quote-Argument([string]$value) {
    if ($null -eq $value -or $value.Length -eq 0) { return '""' }
    if ($value -notmatch '[\s"]') { return $value }
    return '"' + ($value -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
}

$workDefault = Default-WorkRoot
$projectDefault = Resolve-InitialProjectRoot
$toolDefault = Default-ToolRoot $workDefault
$cacheDefault = Default-CacheRoot $toolDefault
$outputDefault = $workDefault
$settingsDir = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "PyDroidBuild"
$settingsFile = Join-Path $settingsDir "gui-settings.json"

$stored = $null
if (Test-Path -LiteralPath $settingsFile) {
    try { $stored = Get-Content -LiteralPath $settingsFile -Raw | ConvertFrom-Json } catch {}
}
if ($stored) {
    if (-not $ProjectRoot -and $stored.ProjectRoot) { $projectDefault = [string]$stored.ProjectRoot }
    if ($stored.WorkRoot -and -not $env:PYDROID_BUILD_HOME) { $workDefault = [string]$stored.WorkRoot }

    # DK_* 环境变量是跨项目共享工具链的显式配置，应优先于旧 GUI 设置。
    if (-not $env:DK_TOOL_ROOT) {
        if ($stored.ToolRoot) {
            $storedToolRoot = [string]$stored.ToolRoot
            if ($storedToolRoot -ieq 'D:\Code\Language' -and (Test-Path -LiteralPath 'D:\Code\NodeJs\node.exe')) {
                $toolDefault = 'D:\Code'
            } else {
                $toolDefault = $storedToolRoot
            }
        } else {
            $toolDefault = Default-ToolRoot $workDefault
        }
    }

    if ($env:DK_CACHE_ROOT) {
        $cacheDefault = $env:DK_CACHE_ROOT
    } elseif ($stored.CacheRoot) {
        $storedCacheRoot = [string]$stored.CacheRoot
        if ($storedCacheRoot -ieq 'D:\Code\Language\BuildCache' -and $toolDefault -ieq 'D:\Code') {
            $cacheDefault = 'D:\Code\BuildCache'
        } else {
            $cacheDefault = $storedCacheRoot
        }
    } else {
        $cacheDefault = Default-CacheRoot $toolDefault
    }

    if ($stored.OutputRoot) { $outputDefault = [string]$stored.OutputRoot } else { $outputDefault = $workDefault }
}

$form = New-Object System.Windows.Forms.Form
$form.Text = "PyDroid Build GUI · Shared Toolchain"
$form.StartPosition = "CenterScreen"
$form.MinimumSize = New-Object System.Drawing.Size(940, 760)
$form.Size = New-Object System.Drawing.Size(1120, 860)
$form.Font = New-Object System.Drawing.Font("Segoe UI", 9)

$main = New-Object System.Windows.Forms.TableLayoutPanel
$main.Dock = "Fill"
$main.Padding = New-Object System.Windows.Forms.Padding(12)
$main.ColumnCount = 1
$main.RowCount = 6
[void]$main.RowStyles.Add((New-Object System.Windows.Forms.RowStyle("AutoSize")))
[void]$main.RowStyles.Add((New-Object System.Windows.Forms.RowStyle("AutoSize")))
[void]$main.RowStyles.Add((New-Object System.Windows.Forms.RowStyle("AutoSize")))
[void]$main.RowStyles.Add((New-Object System.Windows.Forms.RowStyle("AutoSize")))
[void]$main.RowStyles.Add((New-Object System.Windows.Forms.RowStyle("Percent", 100)))
[void]$main.RowStyles.Add((New-Object System.Windows.Forms.RowStyle("AutoSize")))
[void]$form.Controls.Add($main)

$pathsGroup = New-Object System.Windows.Forms.GroupBox
$pathsGroup.Text = "路径"
$pathsGroup.Dock = "Top"
$pathsGroup.AutoSize = $true
$pathsPanel = New-Object System.Windows.Forms.TableLayoutPanel
$pathsPanel.Dock = "Top"
$pathsPanel.AutoSize = $true
$pathsPanel.Padding = New-Object System.Windows.Forms.Padding(8)
$pathsPanel.ColumnCount = 3
$pathsPanel.RowCount = 5
[void]$pathsPanel.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle("Absolute", 92)))
[void]$pathsPanel.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle("Percent", 100)))
[void]$pathsPanel.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle("Absolute", 76)))
[void]$pathsGroup.Controls.Add($pathsPanel)
[void]$main.Controls.Add($pathsGroup, 0, 0)

$projectBox = $null
$workBox = $null
$toolBox = $null
$cacheBox = $null
$outputBox = $null
$projectBox = Add-LabeledPathRow $pathsPanel 0 "项目目录" $projectDefault {
    $v = Select-Folder $projectBox.Text
    if ($v) { $projectBox.Text = $v }
}
$workBox = Add-LabeledPathRow $pathsPanel 1 "工作目录" $workDefault {
    $v = Select-Folder $workBox.Text
    if ($v) { $workBox.Text = $v }
}
$toolBox = Add-LabeledPathRow $pathsPanel 2 "共享工具根目录" $toolDefault {
    $v = Select-Folder $toolBox.Text
    if ($v) {
        $toolBox.Text = $v
        if (-not $cacheBox.Text -or $cacheBox.Text -like '*\BuildCache') { $cacheBox.Text = Join-Path $v 'BuildCache' }
    }
}
$cacheBox = Add-LabeledPathRow $pathsPanel 3 "共享缓存目录" $cacheDefault {
    $v = Select-Folder $cacheBox.Text
    if ($v) { $cacheBox.Text = $v }
}
$outputBox = Add-LabeledPathRow $pathsPanel 4 "输出目录" $outputDefault {
    $v = Select-Folder $outputBox.Text
    if ($v) { $outputBox.Text = $v }
}

$optionsGroup = New-Object System.Windows.Forms.GroupBox
$optionsGroup.Text = "构建选项"
$optionsGroup.Dock = "Top"
$optionsGroup.AutoSize = $true
$optionsFlow = New-Object System.Windows.Forms.FlowLayoutPanel
$optionsFlow.Dock = "Top"
$optionsFlow.AutoSize = $true
$optionsFlow.Padding = New-Object System.Windows.Forms.Padding(8)
$optionsFlow.WrapContents = $true
[void]$optionsGroup.Controls.Add($optionsFlow)
[void]$main.Controls.Add($optionsGroup, 0, 1)

$androidCheck = New-Object System.Windows.Forms.CheckBox
$androidCheck.Text = "Android APK"
$androidCheck.Checked = if ($stored -and $null -ne $stored.Android) { [bool]$stored.Android } else { $true }
$androidCheck.AutoSize = $true
$desktopCheck = New-Object System.Windows.Forms.CheckBox
$desktopCheck.Text = "Windows Desktop"
$desktopCheck.Checked = if ($stored -and $null -ne $stored.Desktop) { [bool]$stored.Desktop } else { $true }
$desktopCheck.AutoSize = $true
$installCheck = New-Object System.Windows.Forms.CheckBox
$installCheck.Text = "自动补齐缺失工具"
$installCheck.Checked = if ($stored -and $null -ne $stored.AutoInstall) { [bool]$stored.AutoInstall } else { $true }
$installCheck.AutoSize = $true
$historyCheck = New-Object System.Windows.Forms.CheckBox
$historyCheck.Text = "保留旧构建"
$historyCheck.Checked = if ($stored) { [bool]$stored.KeepHistory } else { $false }
$historyCheck.AutoSize = $true
$workspaceCheck = New-Object System.Windows.Forms.CheckBox
$workspaceCheck.Text = "失败排查时保留工作区"
$workspaceCheck.Checked = if ($stored) { [bool]$stored.KeepWorkspace } else { $false }
$workspaceCheck.AutoSize = $true

@($androidCheck, $desktopCheck, $installCheck, $historyCheck, $workspaceCheck) | ForEach-Object { [void]$optionsFlow.Controls.Add($_) }

$retryLabel = New-Object System.Windows.Forms.Label
$retryLabel.Text = "下载重试："
$retryLabel.AutoSize = $true
$retryLabel.Margin = New-Object System.Windows.Forms.Padding(18, 6, 0, 0)
[void]$optionsFlow.Controls.Add($retryLabel)
$retryBox = New-Object System.Windows.Forms.NumericUpDown
$retryBox.Minimum = 1
$retryBox.Maximum = 10
$retryBox.Value = if ($stored -and $stored.Retries) { [decimal]$stored.Retries } else { 3 }
$retryBox.Width = 48
[void]$optionsFlow.Controls.Add($retryBox)

$advanced = New-Object System.Windows.Forms.GroupBox
$advanced.Text = "兼容性参数（通常保持默认/自动即可）"
$advanced.Dock = "Top"
$advanced.AutoSize = $true
$advancedPanel = New-Object System.Windows.Forms.TableLayoutPanel
$advancedPanel.Dock = "Top"
$advancedPanel.AutoSize = $true
$advancedPanel.Padding = New-Object System.Windows.Forms.Padding(8)
$advancedPanel.ColumnCount = 4
[void]$advancedPanel.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle("Absolute", 105)))
[void]$advancedPanel.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle("Percent", 50)))
[void]$advancedPanel.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle("Absolute", 135)))
[void]$advancedPanel.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle("Percent", 50)))
[void]$advanced.Controls.Add($advancedPanel)
[void]$main.Controls.Add($advanced, 0, 2)

function Add-AdvancedField([int]$row, [int]$labelCol, [string]$labelText, [string]$value) {
    $lbl = New-Object System.Windows.Forms.Label
    $lbl.Text = $labelText
    $lbl.TextAlign = "MiddleLeft"
    $lbl.Dock = "Fill"
    $tb = New-Object System.Windows.Forms.TextBox
    $tb.Text = $value
    $tb.Dock = "Fill"
    [void]$advancedPanel.Controls.Add($lbl, $labelCol, $row)
    [void]$advancedPanel.Controls.Add($tb, $labelCol + 1, $row)
    return $tb
}

function Add-AdvancedCombo([int]$row, [int]$labelCol, [string]$labelText, [string[]]$items, [int]$selectedIndex) {
    $lbl = New-Object System.Windows.Forms.Label
    $lbl.Text = $labelText
    $lbl.TextAlign = "MiddleLeft"
    $lbl.Dock = "Fill"
    $cb = New-Object System.Windows.Forms.ComboBox
    $cb.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
    $cb.Dock = "Fill"
    foreach ($item in $items) { [void]$cb.Items.Add($item) }
    if ($selectedIndex -lt 0 -or $selectedIndex -ge $cb.Items.Count) { $selectedIndex = 0 }
    $cb.SelectedIndex = $selectedIndex
    [void]$advancedPanel.Controls.Add($lbl, $labelCol, $row)
    [void]$advancedPanel.Controls.Add($cb, $labelCol + 1, $row)
    return $cb
}

$nodeVersionBox = Add-AdvancedField 0 0 "Node 自动安装版本" $(if ($stored -and $stored.NodeVersion) { [string]$stored.NodeVersion } else { "24.19.0" })
$pythonVersionBox = Add-AdvancedField 0 2 "Android Python 自动安装版本" $(if ($stored -and $stored.PythonVersion) { [string]$stored.PythonVersion } else { "3.12.10" })
$androidApiBox = Add-AdvancedField 1 0 "Android API" $(if ($stored -and $null -ne $stored.AndroidApi) { [string]$stored.AndroidApi } else { "0" })
$jdkMajorBox = Add-AdvancedField 1 2 "JDK 主版本" $(if ($stored -and $stored.JdkMajor) { [string]$stored.JdkMajor } else { "21" })
$electronMirrorBox = Add-AdvancedField 2 0 "Electron 镜像" $(if ($stored -and $stored.ElectronMirror) { [string]$stored.ElectronMirror } else { "" })
$builderMirrorBox = Add-AdvancedField 2 2 "Builder 镜像" $(if ($stored -and $stored.BuilderMirror) { [string]$stored.BuilderMirror } else { "" })

$storedMode = if ($stored -and $stored.NetworkMode) { [string]$stored.NetworkMode } else { "Auto" }
$modeIndex = switch ($storedMode) { "Direct" { 1 } "Manual" { 2 } default { 0 } }
$networkModeBox = Add-AdvancedCombo 3 0 "网络模式" @("自动（环境/Windows代理）", "直连", "手动代理") $modeIndex
$proxyBox = Add-AdvancedField 3 2 "代理地址" $(if ($stored -and $stored.ProxyUrl) { [string]$stored.ProxyUrl } else { "" })
$registryBox = Add-AdvancedField 4 0 "npm Registry" $(if ($stored -and $stored.RegistryUrl) { [string]$stored.RegistryUrl } else { "" })
$fetchTimeoutBox = Add-AdvancedField 4 2 "请求超时(秒)" $(if ($stored -and $stored.FetchTimeoutSeconds) { [string]$stored.FetchTimeoutSeconds } else { "600" })
$concurrencyBox = Add-AdvancedField 5 0 "pnpm 网络并发" $(if ($stored -and $stored.NetworkConcurrency) { [string]$stored.NetworkConcurrency } else { "16" })
$networkHintBox = Add-AdvancedField 5 2 "代理示例" "http://127.0.0.1:7890"
$networkHintBox.ReadOnly = $true

$progressPanel = New-Object System.Windows.Forms.TableLayoutPanel
$progressPanel.Dock = "Top"
$progressPanel.AutoSize = $true
$progressPanel.ColumnCount = 1
$progressPanel.RowCount = 3
$progressPanel.Padding = New-Object System.Windows.Forms.Padding(4, 8, 4, 8)
[void]$main.Controls.Add($progressPanel, 0, 3)

$stageLabel = New-Object System.Windows.Forms.Label
$stageLabel.Text = "当前步骤：等待开始"
$stageLabel.AutoSize = $true
$stageLabel.Dock = "Fill"
$stageLabel.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
[void]$progressPanel.Controls.Add($stageLabel, 0, 0)

$progressBar = New-Object System.Windows.Forms.ProgressBar
$progressBar.Minimum = 0
$progressBar.Maximum = 100
$progressBar.Value = 0
$progressBar.Style = [System.Windows.Forms.ProgressBarStyle]::Continuous
$progressBar.Dock = "Fill"
$progressBar.Height = 18
$progressBar.Margin = New-Object System.Windows.Forms.Padding(0, 5, 0, 2)
[void]$progressPanel.Controls.Add($progressBar, 0, 1)

$progressHint = New-Object System.Windows.Forms.Label
$progressHint.Text = "阶段进度用于说明当前正在做什么；依赖已缓存时不会下载，只有缺失工具/依赖时才会联网。"
$progressHint.AutoSize = $true
$progressHint.Dock = "Fill"
$progressHint.ForeColor = [System.Drawing.SystemColors]::GrayText
[void]$progressPanel.Controls.Add($progressHint, 0, 2)

$logBox = New-Object System.Windows.Forms.RichTextBox
$logBox.Dock = "Fill"
$logBox.ReadOnly = $true
$logBox.WordWrap = $false
$logBox.BackColor = [System.Drawing.Color]::FromArgb(28, 28, 28)
$logBox.ForeColor = [System.Drawing.Color]::Gainsboro
$logBox.Font = New-Object System.Drawing.Font("Consolas", 9)
[void]$main.Controls.Add($logBox, 0, 4)

$bottom = New-Object System.Windows.Forms.TableLayoutPanel
$bottom.Dock = "Fill"
$bottom.AutoSize = $true
$bottom.ColumnCount = 5
[void]$bottom.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle("Percent", 100)))
[void]$bottom.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle("AutoSize")))
[void]$bottom.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle("AutoSize")))
[void]$bottom.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle("AutoSize")))
[void]$bottom.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle("AutoSize")))
[void]$main.Controls.Add($bottom, 0, 5)

$statusLabel = New-Object System.Windows.Forms.Label
$statusLabel.Text = "就绪"
$statusLabel.AutoSize = $true
$statusLabel.Dock = "Fill"
$statusLabel.TextAlign = "MiddleLeft"
[void]$bottom.Controls.Add($statusLabel, 0, 0)

$openButton = New-Object System.Windows.Forms.Button
$openButton.Text = "打开输出目录"
$openButton.AutoSize = $true
[void]$bottom.Controls.Add($openButton, 1, 0)
$clearButton = New-Object System.Windows.Forms.Button
$clearButton.Text = "清空日志"
$clearButton.AutoSize = $true
[void]$bottom.Controls.Add($clearButton, 2, 0)
$cancelButton = New-Object System.Windows.Forms.Button
$cancelButton.Text = "取消"
$cancelButton.AutoSize = $true
$cancelButton.Enabled = $false
[void]$bottom.Controls.Add($cancelButton, 3, 0)
$startButton = New-Object System.Windows.Forms.Button
$startButton.Text = "开始构建"
$startButton.AutoSize = $true
$startButton.Width = 100
[void]$bottom.Controls.Add($startButton, 4, 0)
$form.AcceptButton = $startButton

$script:buildProcess = $null
$script:stdoutReader = $null
$script:stderrReader = $null
$script:stdoutTask = $null
$script:stderrTask = $null
$script:currentBuildLog = $null
$script:lastBuildExitCode = $null
$script:lastStagePercent = 0

function Set-BuildStage([int]$Percent, [string]$Message) {
    $safePercent = [Math]::Max(0, [Math]::Min(100, $Percent))
    $script:lastStagePercent = $safePercent
    $progressBar.Value = $safePercent
    $stageLabel.Text = "当前步骤：$Message"
    $statusLabel.Text = ("{0}% · {1}" -f $safePercent, $Message)
    $statusLabel.ForeColor = [System.Drawing.SystemColors]::ControlText
}

function Append-BuildLogLine([string]$Line) {
    if ($null -eq $Line) { return }
    if ($Line -match '^@@PYDROID_STAGE@@\|(\d{1,3})\|(.*)$') {
        $percent = [int]$matches[1]
        $message = $matches[2].Trim()
        Set-BuildStage $percent $message
        $readable = "[阶段 {0}%] {1}" -f $percent, $message
        $logBox.AppendText([Environment]::NewLine + $readable + [Environment]::NewLine)
        if ($script:currentBuildLog) {
            try { Add-Content -LiteralPath $script:currentBuildLog -Value $readable -Encoding UTF8 } catch {}
        }
        return
    }
    $logBox.AppendText($Line + [Environment]::NewLine)
    if ($script:currentBuildLog) {
        try { Add-Content -LiteralPath $script:currentBuildLog -Value $Line -Encoding UTF8 } catch {}
    }
}

function Drain-BuildStreams {
    $hadOutput = $false

    while ($script:stdoutTask -and $script:stdoutTask.IsCompleted) {
        try { $line = $script:stdoutTask.Result } catch {
            $line = "[GUI] 读取标准输出失败：$($_.Exception.GetBaseException().Message)"
            Append-BuildLogLine $line
            $script:stdoutTask = $null
            break
        }
        if ($null -eq $line) {
            $script:stdoutTask = $null
            break
        }
        Append-BuildLogLine $line
        $hadOutput = $true
        $script:stdoutTask = $script:stdoutReader.ReadLineAsync()
    }

    while ($script:stderrTask -and $script:stderrTask.IsCompleted) {
        try { $line = $script:stderrTask.Result } catch {
            $line = "[GUI] 读取错误输出失败：$($_.Exception.GetBaseException().Message)"
            Append-BuildLogLine $line
            $script:stderrTask = $null
            break
        }
        if ($null -eq $line) {
            $script:stderrTask = $null
            break
        }
        Append-BuildLogLine $line
        $hadOutput = $true
        $script:stderrTask = $script:stderrReader.ReadLineAsync()
    }

    if ($hadOutput) {
        $logBox.SelectionStart = $logBox.TextLength
        $logBox.ScrollToCaret()
    }
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 100
$timer.Add_Tick({
    Drain-BuildStreams

    if ($script:buildProcess) {
        try { $script:buildProcess.Refresh() } catch {}
        if ($script:buildProcess.HasExited) {
            $finishedProcess = $script:buildProcess
            try { $finishedProcess.WaitForExit() } catch {}
            Drain-BuildStreams

            $exitCode = $finishedProcess.ExitCode
            $script:lastBuildExitCode = $exitCode
            $script:buildProcess = $null
            $startButton.Enabled = $true
            $cancelButton.Enabled = $false

            $resultLine = "===== 构建进程结束：退出码 $exitCode；$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ====="
            Append-BuildLogLine $resultLine

            if ($exitCode -eq 0) {
                Set-BuildStage 100 "构建完成"
                $statusLabel.Text = "构建完成"
                $statusLabel.ForeColor = [System.Drawing.Color]::DarkGreen
                [System.Windows.Forms.MessageBox]::Show(
                    "构建完成。`r`n`r`n输出目录：$($outputBox.Text.Trim())`r`n日志：$script:currentBuildLog",
                    "PyDroid Build",
                    "OK",
                    "Information"
                ) | Out-Null
            } else {
                $stageLabel.Text = "当前步骤：构建失败（请查看最后几行日志）"
                $statusLabel.Text = "构建失败（退出码 $exitCode）"
                $statusLabel.ForeColor = [System.Drawing.Color]::DarkRed
                [System.Windows.Forms.MessageBox]::Show(
                    "构建失败，退出码：$exitCode`r`n`r`n完整日志已保存到：`r`n$script:currentBuildLog",
                    "PyDroid Build",
                    "OK",
                    "Error"
                ) | Out-Null
            }
        }
    }
})
$timer.Start()

$clearButton.Add_Click({ $logBox.Clear() })
$openButton.Add_Click({
    $path = $outputBox.Text.Trim()
    if ([string]::IsNullOrWhiteSpace($path)) { return }
    New-Item -ItemType Directory -Force -Path $path | Out-Null
    Start-Process explorer.exe -ArgumentList ('"{0}"' -f $path)
})

$cancelButton.Add_Click({
    if (-not $script:buildProcess) { return }
    try {
        & taskkill.exe /PID $script:buildProcess.Id /T /F | Out-Null
        $statusLabel.Text = "已取消"
        $stageLabel.Text = "当前步骤：已取消"
    } catch {
        [System.Windows.Forms.MessageBox]::Show("取消失败：$($_.Exception.Message)", "PyDroid Build", "OK", "Warning") | Out-Null
    }
})

$startButton.Add_Click({
    try {
        if ($script:buildProcess) { return }
        $project = $projectBox.Text.Trim()
        if (-not (Test-Path -LiteralPath (Join-Path $project "package.json"))) {
            throw "项目目录无效，未找到 package.json。"
        }
        if (-not $androidCheck.Checked -and -not $desktopCheck.Checked) {
            throw "Android 和 Windows Desktop 至少选择一个。"
        }

        $work = $workBox.Text.Trim()
        $tools = $toolBox.Text.Trim()
        $cache = $cacheBox.Text.Trim()
        $output = $outputBox.Text.Trim()
        if (-not $work) { throw "工作目录不能为空。" }
        if (-not $tools) { throw "共享工具根目录不能为空。" }
        if (-not $cache) { throw "共享缓存目录不能为空。" }
        if (-not $output) { throw "输出目录不能为空。" }

        $androidApi = 0
        if (-not [int]::TryParse($androidApiBox.Text.Trim(), [ref]$androidApi) -or $androidApi -lt 0) {
            throw "Android API 应为 0（自动）或正整数。"
        }
        $jdkMajor = 0
        if (-not [int]::TryParse($jdkMajorBox.Text.Trim(), [ref]$jdkMajor) -or $jdkMajor -lt 8) {
            throw "JDK 主版本无效。"
        }

        $fetchTimeout = 0
        if (-not [int]::TryParse($fetchTimeoutBox.Text.Trim(), [ref]$fetchTimeout) -or $fetchTimeout -lt 60 -or $fetchTimeout -gt 3600) {
            throw "请求超时应为 60-3600 秒。"
        }
        $networkConcurrency = 0
        if (-not [int]::TryParse($concurrencyBox.Text.Trim(), [ref]$networkConcurrency) -or $networkConcurrency -lt 1 -or $networkConcurrency -gt 64) {
            throw "pnpm 网络并发应为 1-64。"
        }
        $networkMode = switch ($networkModeBox.SelectedIndex) { 1 { "Direct" } 2 { "Manual" } default { "Auto" } }
        if ($networkMode -eq "Manual" -and [string]::IsNullOrWhiteSpace($proxyBox.Text)) {
            throw "选择手动代理时必须填写代理地址，例如 http://127.0.0.1:7890。"
        }

        New-Item -ItemType Directory -Force -Path $settingsDir | Out-Null
        [pscustomobject]@{
            ProjectRoot = $project
            WorkRoot = $work
            ToolRoot = $tools
            CacheRoot = $cache
            OutputRoot = $output
            Android = $androidCheck.Checked
            Desktop = $desktopCheck.Checked
            AutoInstall = $installCheck.Checked
            KeepHistory = $historyCheck.Checked
            KeepWorkspace = $workspaceCheck.Checked
            Retries = [int]$retryBox.Value
            NodeVersion = $nodeVersionBox.Text.Trim()
            PythonVersion = $pythonVersionBox.Text.Trim()
            AndroidApi = $androidApi
            JdkMajor = $jdkMajor
            ElectronMirror = $electronMirrorBox.Text.Trim()
            BuilderMirror = $builderMirrorBox.Text.Trim()
            NetworkMode = $networkMode
            ProxyUrl = $proxyBox.Text.Trim()
            RegistryUrl = $registryBox.Text.Trim()
            FetchTimeoutSeconds = $fetchTimeout
            NetworkConcurrency = $networkConcurrency
        } | ConvertTo-Json | Set-Content -LiteralPath $settingsFile -Encoding UTF8

        # Do not use PowerShell's automatic $args variable here. In event/script blocks it
        # is populated by PowerShell and is an Object[] (fixed-size collection). Using
        # .Add() on it causes the GUI to fail before the build process is started.
        # A normal string array plus += is intentionally used for Windows PowerShell 5.1
        # and PowerShell 7 compatibility.
        [string[]]$launchArgs = @(
            "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $coreScript,
            "-ProjectRoot", $project, "-WorkRoot", $work, "-ToolRoot", $tools, "-CacheRoot", $cache,
            "-OutputRoot", $output, "-DownloadRetryCount", ([string][int]$retryBox.Value),
            "-NodeVersion", $nodeVersionBox.Text.Trim(), "-PythonVersion", $pythonVersionBox.Text.Trim(),
            "-AndroidApiLevel", ([string]$androidApi), "-JdkMajor", ([string]$jdkMajor),
            "-NetworkMode", $networkMode, "-PnpmFetchTimeoutSeconds", ([string]$fetchTimeout),
            "-PnpmNetworkConcurrency", ([string]$networkConcurrency)
        )
        if (-not $androidCheck.Checked) { $launchArgs += "-SkipAndroid" }
        if (-not $desktopCheck.Checked) { $launchArgs += "-SkipDesktop" }
        if (-not $installCheck.Checked) { $launchArgs += "-SkipToolInstall" }
        if ($historyCheck.Checked) { $launchArgs += "-KeepHistory" }
        if ($workspaceCheck.Checked) { $launchArgs += "-KeepWorkspace" }
        if ($electronMirrorBox.Text.Trim()) { $launchArgs += @("-ElectronMirror", $electronMirrorBox.Text.Trim()) }
        if ($builderMirrorBox.Text.Trim()) { $launchArgs += @("-ElectronBuilderMirror", $builderMirrorBox.Text.Trim()) }
        if ($proxyBox.Text.Trim()) { $launchArgs += @("-ProxyUrl", $proxyBox.Text.Trim()) }
        if ($registryBox.Text.Trim()) { $launchArgs += @("-RegistryUrl", $registryBox.Text.Trim()) }

        $buildLogDir = Join-Path $output "logs"
        New-Item -ItemType Directory -Force -Path $buildLogDir | Out-Null
        $script:currentBuildLog = Join-Path $buildLogDir ("build-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
        @"
===== PyDroid Build GUI =====
Started: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
Project: $project
Work: $work
Tools: $tools
Cache: $cache
Output: $output
Android: $($androidCheck.Checked)
Desktop: $($desktopCheck.Checked)
Network mode: $networkMode
Proxy: $($proxyBox.Text.Trim())
Registry: $($registryBox.Text.Trim())
Fetch timeout: $fetchTimeout s
Network concurrency: $networkConcurrency
=============================
"@ | Set-Content -LiteralPath $script:currentBuildLog -Encoding UTF8

        $exe = Get-PowerShellExecutable
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $exe
        $psi.UseShellExecute = $false
        $psi.CreateNoWindow = $true
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.WorkingDirectory = $project
        $psi.StandardOutputEncoding = [Text.Encoding]::UTF8
        $psi.StandardErrorEncoding = [Text.Encoding]::UTF8

        # ProcessStartInfo.ArgumentList is not available in Windows PowerShell 5.1's
        # .NET Framework. Always build a quoted argument string so the same code path is
        # exercised on both Windows PowerShell 5.1 and PowerShell 7.
        $psi.Arguments = (($launchArgs | ForEach-Object { Quote-Argument ([string]$_) }) -join " ")

        $proc = New-Object System.Diagnostics.Process
        $proc.StartInfo = $psi
        if (-not $proc.Start()) { throw "无法启动构建进程。" }
        $script:buildProcess = $proc
        $script:stdoutReader = $proc.StandardOutput
        $script:stderrReader = $proc.StandardError
        $script:stdoutTask = $script:stdoutReader.ReadLineAsync()
        $script:stderrTask = $script:stderrReader.ReadLineAsync()

        $logBox.AppendText("`r`n===== 开始构建 $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') =====`r`n")
        $logBox.AppendText("日志：$script:currentBuildLog`r`n")
        $progressBar.Value = 0
        $script:lastStagePercent = 0
        $stageLabel.Text = "当前步骤：正在启动构建进程"
        $statusLabel.Text = "正在启动构建..."
        $statusLabel.ForeColor = [System.Drawing.SystemColors]::ControlText
        $startButton.Enabled = $false
        $cancelButton.Enabled = $true
    } catch {
        $details = $_.Exception.Message
        if ($_.InvocationInfo -and $_.InvocationInfo.ScriptLineNumber) {
            $details += "`r`n`r`n脚本位置：第 $($_.InvocationInfo.ScriptLineNumber) 行"
        }
        [System.Windows.Forms.MessageBox]::Show($details, "无法开始构建", "OK", "Error") | Out-Null
    }
})

$form.Add_FormClosing({
    param($sender, $eventArgs)
    if ($script:buildProcess -and -not $script:buildProcess.HasExited) {
        $answer = [System.Windows.Forms.MessageBox]::Show("构建仍在进行，关闭窗口会终止构建。是否继续？", "PyDroid Build", "YesNo", "Warning")
        if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) {
            $eventArgs.Cancel = $true
            return
        }
        try { & taskkill.exe /PID $script:buildProcess.Id /T /F | Out-Null } catch {}
    }
})

[void]$form.ShowDialog()
$timer.Stop()
exit 0
