# PyDroid workspace cleanup helper. Windows PowerShell 5.1 compatible.
# Deterministic policy: one recursive .NET delete; failures surface immediately.

function Remove-PyDroidBuildDirectory {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not [System.IO.Directory]::Exists($Path)) { return }

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $rootPath = [System.IO.Path]::GetPathRoot($fullPath)
    if ($fullPath.TrimEnd('\') -eq $rootPath.TrimEnd('\')) {
        throw "拒绝删除磁盘根目录：$fullPath"
    }

    $deletePath = if ($fullPath.StartsWith('\\')) {
        '\\?\UNC\' + $fullPath.Substring(2)
    } else {
        '\\?\' + $fullPath
    }
    [System.IO.Directory]::Delete($deletePath, $true)
}

Export-ModuleMember -Function 'Remove-PyDroidBuildDirectory'
