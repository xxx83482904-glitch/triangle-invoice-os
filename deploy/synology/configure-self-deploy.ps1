<#
.SYNOPSIS
  Re-enables the self-deploy API on the Synology host after PR-0 (codex/security-hardening).

.DESCRIPTION
  Run this on a trusted PC that can reach the NAS over SSH. It
    1. generates a 48-character deploy token (or uses -Token) and shows it ONCE so you can store it in
       GitHub Secrets as TRIANGLE_DEPLOY_TOKEN (done for you when the GitHub CLI `gh` is signed in),
    2. appends ALLOW_SELF_DEPLOY=true and DEPLOY_TOKEN=<token> to the container's .env on the NAS
       (a timestamped backup of .env is kept next to it),
    3. recreates the app container so the new environment is loaded,
    4. waits until https://invoice.kuremasato.com/api/admin/deploy answers 403 "Invalid deploy token",
       which means self deploy is enabled again.
  The token never leaves this machine except to GitHub Secrets and the NAS .env. Nothing is printed to logs
  besides the one-time display. Keep the NAS SSH login yours: this script never stores it.

.PARAMETER NasHost     NAS address (default 192.168.1.218).
.PARAMETER NasUser     SSH user on the NAS (must be allowed to run sudo docker).
.PARAMETER RemotePath  Folder on the NAS that holds docker-compose.yml and .env
                       (default /volume1/docker/triangle-invoice-os/app/deploy/synology).
.PARAMETER Token       Use an existing token instead of generating one (32+ characters).
.PARAMETER SkipGitHub  Do not touch GitHub Secrets (you will paste the token yourself).
.PARAMETER PublicUrl   Public URL used for the final check (default https://invoice.kuremasato.com).

.EXAMPLE
  .\deploy\synology\configure-self-deploy.ps1 -NasUser kure
#>
param(
  [string]$NasHost = "192.168.1.218",
  [Parameter(Mandatory = $true)][string]$NasUser,
  [string]$RemotePath = "/volume1/docker/triangle-invoice-os/app/deploy/synology",
  [string]$Token = "",
  [switch]$SkipGitHub,
  [string]$PublicUrl = "https://invoice.kuremasato.com"
)
$ErrorActionPreference = "Stop"
$repo = "xxx83482904-glitch/triangle-invoice-os"

if (-not $Token) {
  $alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
  $bytes = New-Object byte[] 48
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $Token = -join ($bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] })
}
if ($Token.Length -lt 32) { throw "DEPLOY_TOKEN must have at least 32 characters." }

Write-Host ""
Write-Host "=== Deploy token (shown once; store it in GitHub Secrets as TRIANGLE_DEPLOY_TOKEN) ===" -ForegroundColor Yellow
Write-Host $Token
Write-Host ""

if (-not $SkipGitHub) {
  $gh = Get-Command gh -ErrorAction SilentlyContinue
  if ($gh) {
    Write-Host "Updating GitHub secret TRIANGLE_DEPLOY_TOKEN via gh ..."
    $Token | & gh secret set TRIANGLE_DEPLOY_TOKEN -R $repo --body -
    if ($LASTEXITCODE -ne 0) { throw "gh secret set failed. Set the secret manually, then re-run with -SkipGitHub -Token <same token>." }
  } else {
    Write-Host "GitHub CLI (gh) not found. Open https://github.com/$repo/settings/secrets/actions, update TRIANGLE_DEPLOY_TOKEN with the value above, then press Enter." -ForegroundColor Yellow
    [void](Read-Host "Press Enter when the GitHub secret is updated")
  }
}

# Remote script: back up .env, replace the two keys, recreate the app container.
$remote = @"
set -eu
cd '$RemotePath'
test -f .env || { echo ".env not found in $RemotePath"; exit 2; }
cp .env ".env.bak-\$(date +%Y%m%d-%H%M%S)"
grep -v -E '^(ALLOW_SELF_DEPLOY|DEPLOY_TOKEN)=' .env > .env.tmp || true
printf '%s\n' 'ALLOW_SELF_DEPLOY=true' 'DEPLOY_TOKEN=$Token' >> .env.tmp
mv .env.tmp .env
chmod 600 .env
echo "env updated: \$(grep -c -E '^(ALLOW_SELF_DEPLOY|DEPLOY_TOKEN)=' .env) keys"
if sudo docker compose version >/dev/null 2>&1; then sudo docker compose up -d --force-recreate app; else sudo docker-compose up -d --force-recreate app; fi
echo "container recreated"
"@

Write-Host "Connecting to $NasUser@$NasHost (you will be asked for the NAS SSH password) ..."
$remote | ssh -o StrictHostKeyChecking=accept-new "$NasUser@$NasHost" "bash -s"
if ($LASTEXITCODE -ne 0) { throw "Remote configuration failed. The previous .env is kept as .env.bak-<timestamp> on the NAS." }

Write-Host "Waiting for the app to come back and for self deploy to report 403 ..."
$deadline = (Get-Date).AddMinutes(15)
do {
  Start-Sleep -Seconds 20
  try { $code = (Invoke-WebRequest -Uri "$PublicUrl/api/admin/deploy" -Method Get -UseBasicParsing -TimeoutSec 20 -ErrorAction Stop).StatusCode } catch { $code = [int]$_.Exception.Response.StatusCode }
  Write-Host ("{0}  /api/admin/deploy -> {1}" -f (Get-Date -Format "HH:mm:ss"), $code)
} while ($code -ne 403 -and (Get-Date) -lt $deadline)

if ($code -eq 403) { Write-Host "Self deploy is enabled again (403 = token required). Next push to main will deploy." -ForegroundColor Green }
else { Write-Host "Still not 403. Check the container log in Container Manager and that the .env was read (ALLOW_SELF_DEPLOY=true, DEPLOY_TOKEN 32+ chars)." -ForegroundColor Red; exit 1 }
