$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$appPython = Join-Path $projectRoot '.venv\Scripts\python.exe'
$plusRoot = Join-Path $projectRoot '.runtime\wxautox4-venv'
$plusPython = Join-Path $plusRoot 'Scripts\python.exe'
if (-not (Test-Path -LiteralPath $appPython)) { throw 'Run scripts\setup.ps1 first.' }
& $appPython -c 'import sys; sys.exit(0 if (3, 9) <= sys.version_info[:2] <= (3, 13) else 1)'
if ($LASTEXITCODE -ne 0) { throw 'wxautox4 requires Python 3.9-3.13.' }
if (-not (Test-Path -LiteralPath $plusPython)) {
    & $appPython -m venv $plusRoot
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the isolated Plus environment.' }
}
& $plusPython -m pip install --disable-pip-version-check --only-binary=:all: 'wxautox4==41.2.3'
if ($LASTEXITCODE -ne 0) { throw 'Plus dependency installation failed.' }
& $plusPython -m pip check
if ($LASTEXITCODE -ne 0) { throw 'Plus dependency consistency check failed.' }
# Read distribution metadata only. No WeChat import, login, license activation,
# SDK runtime, downloads of media or message sending during setup.
& $plusPython -c 'from importlib.metadata import version; assert version("wxautox4") == "41.2.3"; print("wxautox4 41.2.3 installed; activation not performed.")'
if ($LASTEXITCODE -ne 0) { throw 'Plus version verification failed.' }
Write-Host 'Next: the owner runs scripts\activate-wxautox4.ps1 on this PC.'
Write-Host 'The running application mode, existing history and sending settings were not changed.'
