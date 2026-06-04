param(
  [Parameter(Mandatory = $true)]
  [string]$User,

  [string]$HostName = "192.168.1.218",
  [int]$Port = 22,
  [string]$ContainerName = "triangle-invoice-os",
  [string]$PublicUrl = "https://trianglejp14f.synology.me/login"
)

$ErrorActionPreference = "Stop"

$remoteScript = @'
set -eu

CONTAINER_NAME="__CONTAINER_NAME__"

if command -v docker >/dev/null 2>&1; then
  DOCKER="docker"
elif [ -x /usr/local/bin/docker ]; then
  DOCKER="/usr/local/bin/docker"
else
  echo "docker command was not found on this Synology user." >&2
  exit 1
fi

echo "[1/3] Restarting ${CONTAINER_NAME}"
$DOCKER restart "$CONTAINER_NAME"

echo "[2/3] Container status"
$DOCKER ps --filter "name=${CONTAINER_NAME}" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo "[3/3] Recent logs"
$DOCKER logs --tail 120 "$CONTAINER_NAME"
'@

$remoteScript = $remoteScript.Replace("__CONTAINER_NAME__", $ContainerName)
$target = "${User}@${HostName}"

Write-Host "Deploying TRIANGLE Invoice OS on ${target}:${Port}"
$remoteScript | ssh -p $Port $target "sh -s"

if ($PublicUrl) {
  Write-Host ""
  Write-Host "Checking ${PublicUrl}"
  curl.exe -k -I --max-time 20 $PublicUrl
}
