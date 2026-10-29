#!/bin/sh
set -eu
umask 077
ROOT=/volume1/docker/triangle-invoice-os-china
JAPAN=/volume1/docker/triangle-invoice-os
cd "$ROOT"
test "$(pwd -P)" = "$ROOT"
export PATH=/usr/local/bin:/usr/bin:/bin:$PATH
DOCKER="$(command -v docker || true)"
if [ ! -x "$DOCKER" ]; then DOCKER=/var/packages/ContainerManager/target/usr/bin/docker; fi
test -x "$DOCKER"
exec > "$ROOT/china-migration.log" 2>&1
echo 'Starting isolated Japan-to-China migration'
date -u
test -f "$ROOT/split-china-data.mjs"
test -f "$JAPAN/data/app-data.json"
test -d "$JAPAN/uploads"
test "$(realpath "$JAPAN/data")" = "$JAPAN/data"
test "$(realpath "$JAPAN/uploads")" = "$JAPAN/uploads"
test "$("$DOCKER" inspect -f '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Source}}{{end}}{{end}}' triangle-invoice-os)" = "$JAPAN/data"
test "$("$DOCKER" inspect -f '{{range .Mounts}}{{if eq .Destination "/app/public/uploads/received-invoices"}}{{.Source}}{{end}}{{end}}' triangle-invoice-os)" = "$JAPAN/uploads"
test "$("$DOCKER" inspect -f '{{range .Mounts}}{{if eq .Destination "/app/data-china"}}{{.Name}}{{end}}{{end}}' triangle-invoice-china)" = 'triangle-invoice-china-data'
test "$("$DOCKER" inspect -f '{{.State.Running}}' triangle-invoice-os)" = true
test "$("$DOCKER" inspect -f '{{.State.Running}}' triangle-invoice-china)" = true
IMAGE="$("$DOCKER" inspect -f '{{.Image}}' triangle-invoice-china)"
test -n "$IMAGE"
mkdir -p "$ROOT/migration-backups"
chmod 700 "$ROOT/migration-backups"
JAPAN_STOPPED=0
CHINA_STOPPED=0
resume_apps() {
  if [ "$CHINA_STOPPED" = 1 ]; then "$DOCKER" start triangle-invoice-china; fi
  if [ "$JAPAN_STOPPED" = 1 ]; then "$DOCKER" start triangle-invoice-os; fi
}
trap resume_apps EXIT
"$DOCKER" stop -t 60 triangle-invoice-china
CHINA_STOPPED=1
"$DOCKER" stop -t 60 triangle-invoice-os
JAPAN_STOPPED=1
"$DOCKER" run --rm --network none --read-only --user 0:0 --entrypoint node \
  --mount "type=bind,src=$ROOT/split-china-data.mjs,dst=/migration.mjs,readonly" \
  --mount "type=bind,src=$JAPAN/data,dst=/source-data" \
  --mount "type=bind,src=$JAPAN/uploads,dst=/source-uploads,readonly" \
  --mount 'type=volume,src=triangle-invoice-china-data,dst=/china-data' \
  --mount "type=bind,src=$ROOT/migration-backups,dst=/backups" \
  "$IMAGE" /migration.mjs --source /source-data/app-data.json --target /china-data/app-data.json \
  --source-uploads /source-uploads --target-uploads /china-data/uploads \
  --backup /backups/china-split-2026-10-29-v1 --apply
echo 'Migration data and file verification completed'
resume_apps
CHINA_STOPPED=0
JAPAN_STOPPED=0
trap - EXIT
"$DOCKER" inspect -f '{{.Name}} {{.State.Status}}' triangle-invoice-os triangle-invoice-china
echo 'China migration finished'
