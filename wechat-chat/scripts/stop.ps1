$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
$pythonExe = Join-Path $projectRoot '.venv/Scripts/python.exe'
if (Test-Path -LiteralPath $pythonExe) {
    & $pythonExe (Join-Path $PSScriptRoot 'resident.py') stop
    if ($LASTEXITCODE -ne 0) { throw 'Supervisor did not stop; no other processes were changed.' }
}
$recordPath = Join-Path $projectRoot '.runtime/processes.json'
if (-not (Test-Path -LiteralPath $recordPath)) { Write-Host 'No recorded instance.'; return }
$records = @(Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json)
foreach ($record in $records) {
    $processInfo = Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]$record.id) -ErrorAction SilentlyContinue
    if ($processInfo -and $processInfo.ExecutablePath -eq $record.executable -and $processInfo.CommandLine.Contains($record.marker)) {
        # Stop only the process started by this project's script; never kill by port/name.
        # Windows venv and Next.js launch child workers; stop this verified tree.
        & taskkill.exe /PID ([string]$record.id) /T /F | Out-Null
    }
}
Remove-Item -LiteralPath $recordPath
Write-Host 'Stopped recorded instances.'
