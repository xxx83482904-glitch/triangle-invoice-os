$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
$pythonExe = Join-Path $projectRoot '.venv/Scripts/python.exe'
$pythonWindowless = Join-Path $projectRoot '.venv/Scripts/pythonw.exe'
$supervisor = Join-Path $PSScriptRoot 'resident.py'
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'Komorebi Chat.lnk'
$shell = New-Object -ComObject WScript.Shell
if (Test-Path -LiteralPath $shortcutPath) {
    $existing = $shell.CreateShortcut($shortcutPath)
    if ($existing.TargetPath -ne $pythonWindowless -or -not $existing.Arguments.Contains($supervisor)) {
        throw 'A different startup shortcut already has this name. It was not changed.'
    }
}
# Migrate a previously started development/manual instance before supervision.
if (Test-Path -LiteralPath (Join-Path $projectRoot '.runtime/processes.json')) { & "$PSScriptRoot/stop.ps1" }
& $pythonExe $supervisor start
if ($LASTEXITCODE -ne 0) { throw 'Resident startup failed; startup shortcut was not installed.' }
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $pythonWindowless
$shortcut.Arguments = '"' + $supervisor + '" run'
$shortcut.WorkingDirectory = $projectRoot
$shortcut.WindowStyle = 7
$shortcut.Description = 'Komorebi private chat - start after Windows sign-in'
$shortcut.Save()
Write-Host 'Installed per-user Windows sign-in startup. No administrator account or WeChat login was changed.'
Write-Host 'Stop now: .\scripts\stop.ps1 | Remove startup: .\scripts\uninstall-resident.ps1'
