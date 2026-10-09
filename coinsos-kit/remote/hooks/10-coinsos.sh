#!/usr/bin/with-contenv bash
# Runs as root every time the Home VPS container starts: packages installed
# with apk don't survive a container re-create, so (re)install the database here.
apk add --no-cache postgresql postgresql-contrib postgresql-client >/dev/null 2>&1 \
  && echo "[coinsos] postgresql ready" \
  || echo "[coinsos] WARNING: could not install postgresql (no internet?)"
