param([switch]$NoBrowser, [switch]$Dev)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
$runtimeDir = Join-Path $projectRoot '.runtime'
$pythonExe = Join-Path $projectRoot '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $pythonExe)) { throw 'Run .\scripts\setup.ps1 first.' }
if (-not $Dev -and -not (Test-Path -LiteralPath (Join-Path $projectRoot 'frontend/out/index.html'))) { throw 'Run setup.ps1 or npm run build in frontend first.' }
if (-not $Dev) {
    & $pythonExe (Join-Path $PSScriptRoot 'resident.py') start
    if ($LASTEXITCODE -ne 0) { throw 'Resident startup failed.' }
    Write-Host 'Connection key: .runtime/access-token.txt (or WECHAT_ACCESS_TOKEN in .env).'
    if (-not $NoBrowser) { Start-Process 'http://127.0.0.1:8765' }
    return
}
if (Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 8765 is already in use. Stop the existing instance first.' }
if ($Dev -and (Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue)) { throw 'Port 3100 is already in use.' }
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
$backendProcess = Start-Process -FilePath $pythonExe -ArgumentList 'run.py' -WorkingDirectory (Join-Path $projectRoot 'backend') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDir 'backend.out.log') -RedirectStandardError (Join-Path $runtimeDir 'backend.err.log')
$processRecords = @(@{ id=$backendProcess.Id; marker='run.py'; executable=$pythonExe })
$processRecords | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeDir 'processes.json') -Encoding UTF8
$healthy = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try { $response = Invoke-RestMethod -Uri 'http://127.0.0.1:8765/api/health' -TimeoutSec 1; if ($response.service -eq 'komorebi') { $healthy=$true; break } } catch { }
    if ($backendProcess.HasExited) { break }
    Start-Sleep -Milliseconds 300
}
if (-not $healthy) { throw 'Backend startup failed. See .runtime/backend.err.log; stop.ps1 cleans up this instance.' }
$url = 'http://127.0.0.1:8765'
if ($Dev) {
    $nodeExe = (Get-Command node).Source
    $nextBin = Join-Path $projectRoot 'frontend/node_modules/next/dist/bin/next'
    $frontendProcess = Start-Process -FilePath $nodeExe -ArgumentList ('"' + $nextBin + '" dev --hostname 127.0.0.1 --port 3100') -WorkingDirectory (Join-Path $projectRoot 'frontend') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDir 'frontend.out.log') -RedirectStandardError (Join-Path $runtimeDir 'frontend.err.log')
    $processRecords += @{ id=$frontendProcess.Id; marker=$nextBin; executable=$nodeExe }
    $processRecords | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeDir 'processes.json') -Encoding UTF8
    $url = 'http://127.0.0.1:3100'
}
Write-Host ('Running: ' + $url)
Write-Host 'Connection key: .runtime/access-token.txt (or WECHAT_ACCESS_TOKEN in .env). Keep this private.'
Write-Host 'Stop: .\scripts\stop.ps1'
if (-not $NoBrowser) { Start-Process $url }
