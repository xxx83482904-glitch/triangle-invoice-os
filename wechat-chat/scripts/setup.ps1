param([switch]$WithOcr)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 20.9+ is required.' }
    if (-not (Test-Path -LiteralPath '.venv/Scripts/python.exe')) {
        python -m venv .venv
        if ($LASTEXITCODE -ne 0) { throw 'Python 3.10+ is required.' }
    }
    & ./.venv/Scripts/python.exe -m pip install -r backend/requirements-lock.txt
    if ($LASTEXITCODE -ne 0) { throw 'Python dependency installation failed.' }
    if ($WithOcr) {
        & ./.venv/Scripts/python.exe -m pip install -r backend/requirements-ocr.txt -r backend/requirements-windows.txt
        if ($LASTEXITCODE -ne 0) { throw 'Windows OCR dependency installation failed.' }
    }
    if (-not (Test-Path -LiteralPath '.env')) { Copy-Item -LiteralPath '.env.example' -Destination '.env' }
    Push-Location frontend
    try {
        npm.cmd ci --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
        npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
    } finally { Pop-Location }
    Write-Host 'Setup complete. Run .\scripts\start.ps1'
} finally { Pop-Location }
