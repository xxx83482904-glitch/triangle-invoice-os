param(
  [Parameter(Mandatory = $true)]
  [string]$Token,

  [string]$BaseUrl = "https://trianglejp14f.synology.me",
  [switch]$LogsOnly
)

$ErrorActionPreference = "Stop"

if ($LogsOnly) {
  curl.exe -k -H "x-deploy-token: $Token" "$BaseUrl/api/admin/deploy"
} else {
  curl.exe -k -X POST -H "x-deploy-token: $Token" "$BaseUrl/api/admin/deploy"
}
