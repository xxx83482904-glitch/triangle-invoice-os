param([switch]$KeepRunning)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'Komorebi Chat.lnk'
if (Test-Path -LiteralPath $shortcutPath) {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    if ($shortcut.TargetPath -ne (Join-Path $projectRoot '.venv/Scripts/pythonw.exe') -or -not $shortcut.Arguments.Contains((Join-Path $PSScriptRoot 'resident.py'))) {
        throw 'Shortcut ownership differs; nothing was removed.'
    }
    Remove-Item -LiteralPath $shortcutPath
}
if (-not $KeepRunning) { & "$PSScriptRoot/stop.ps1" }
Write-Host 'Komorebi sign-in startup removed. Chat data and private mobile connection are preserved.'
