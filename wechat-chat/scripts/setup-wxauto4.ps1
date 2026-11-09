$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$appPython = Join-Path $projectRoot '.venv\Scripts\python.exe'
$trialRoot = Join-Path $projectRoot '.runtime\wxauto-venv'
$trialPython = Join-Path $trialRoot 'Scripts\python.exe'
if (-not (Test-Path -LiteralPath $appPython)) { throw 'Run scripts\setup.ps1 first.' }
& $appPython -c 'import sys; sys.exit(0 if (3, 9) <= sys.version_info[:2] <= (3, 12) else 1)'
if ($LASTEXITCODE -ne 0) { throw 'The free wxauto4 trial requires Python 3.9-3.12.' }
if (-not (Test-Path -LiteralPath $trialPython)) {
    & $appPython -m venv $trialRoot
    if ($LASTEXITCODE -ne 0) { throw 'Could not create isolated trial environment.' }
}
& $trialPython -m pip install --disable-pip-version-check 'wxauto4==41.1.7'
if ($LASTEXITCODE -ne 0) { throw 'wxauto4 installation failed.' }
& $trialPython -X utf8 (Join-Path $PSScriptRoot 'check-wxauto4.py') --prepare
if ($LASTEXITCODE -ne 0) { throw 'Privacy configuration failed; wxauto4 was not imported.' }
Write-Host 'Free trial ready. The resident app and WeChat settings have not been changed.'
Write-Host 'Run: .\.venv\Scripts\python.exe -X utf8 .\scripts\check-wxauto4.py'
