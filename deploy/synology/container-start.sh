#!/bin/sh
set -eu

# Run from the checkout root, after the parent command has finished fetch/reset.
head=$(git rev-parse HEAD)
short_head=$(printf '%.7s' "$head")
built=
if [ -f .next/triangle-build-sha ]; then
  built=$(cat .next/triangle-build-sha)
fi

if [ "${TRIANGLE_FORCE_REBUILD:-}" = "1" ]; then
  reason="forced"
elif [ -z "$built" ]; then
  reason="no marker"
elif [ "$built" != "$head" ]; then
  reason="marker for $built (HEAD is $head)"
elif [ ! -f .next/standalone/server.js ] || [ ! -d .next/standalone/.next/static ]; then
  reason="missing standalone server or static assets"
else
  reason=
fi

if [ -z "$reason" ]; then
  printf 'Build for %s is already in place; starting it.\n' "$short_head"
else
  printf 'Rebuilding %s: %s.\n' "$short_head" "$reason"
  npm ci
  npm run build
fi

exec npm start
