$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    & ./.venv/Scripts/python.exe -m pytest backend/tests -q
    if ($LASTEXITCODE -ne 0) { throw 'Backend tests failed.' }
    Push-Location frontend
    try {
        npm.cmd run typecheck
        if ($LASTEXITCODE -ne 0) { throw 'Typecheck failed.' }
        npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
        npm.cmd run test:e2e
        if ($LASTEXITCODE -ne 0) { throw 'Browser tests failed.' }
    } finally { Pop-Location }
} finally { Pop-Location }
