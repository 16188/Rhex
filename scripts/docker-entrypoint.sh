#!/bin/sh
set -eu

if [ -d /app/bundled-addons ]; then
  cp -R /app/bundled-addons/. /app/addons/
fi

node scripts/apply-next-asset-prefix.mjs

exec "$@"
