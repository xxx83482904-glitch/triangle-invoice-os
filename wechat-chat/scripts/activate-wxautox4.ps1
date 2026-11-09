# Run interactively by the owner. Never put a license code in .env, Git or chat.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$plusCli = Join-Path $projectRoot '.runtime\wxautox4-venv\Scripts\wxautox4.exe'
if (-not (Test-Path -LiteralPath $plusCli)) { throw 'Run scripts\setup-wxautox4.ps1 first.' }
Write-Host 'Activate the purchased Plus license on this Windows PC with the official vendor CLI.'
Write-Host 'This contacts the license provider. The license code is not saved in this app.'
$licenseSecret = Read-Host 'Purchased activation code (hidden)' -AsSecureString
$licensePointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($licenseSecret)
try {
    $licenseValue = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($licensePointer)
    if ([string]::IsNullOrWhiteSpace($licenseValue)) { throw 'No activation code entered.' }
    & $plusCli auth activate $licenseValue
    if ($LASTEXITCODE -ne 0) { throw 'Official activation did not finish successfully. No readiness marker written.' }
    # This marker means the owner completed the command. It is not a substitute
    # for the SDK's own license checks and never enables sending.
    Set-Content -LiteralPath (Join-Path $projectRoot '.runtime\wxautox4-activation.ready') -Value 'Official activation command completed by owner; runtime verification pending.' -Encoding utf8
    Write-Host 'Activation command completed. Reading and sending still require integration validation.'
} finally {
    $licenseValue = $null
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($licensePointer)
    $licenseSecret.Dispose()
}
