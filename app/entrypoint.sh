#!/bin/sh
# Runs as root just long enough to prepare the bind mounts, then drops to
# uid/gid 1000 - the same user the SSH container's shell runs as - so files
# made in the dashboard are editable over SSH and vice versa.
set -e
mkdir -p /data/sites /data/vps-home /data/caddy
if [ ! -f /data/caddy/Caddyfile ]; then
  cat > /data/caddy/Caddyfile <<'CADDY'
:80 {
	root * /srv
	file_server
}
CADDY
fi
if [ -z "$(ls -A /data/sites)" ]; then
  echo '<!doctype html><title>Home VPS</title><h1>Home VPS is running</h1><p>Edit this page in the dashboard: Files > Website files.</p>' > /data/sites/index.html
fi
chown -R 1000:1000 /data/sites /data/vps-home /data/caddy
exec su-exec 1000:1000 node /app/server.js
