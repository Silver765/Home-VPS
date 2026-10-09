#!/bin/sh
# Runs on the Home VPS (as user vps) from deploy.ps1. Safe to re-run: updates
# the program, keeps your database and secrets.
set -e
HERE=$(pwd)
APP="$HOME/coinsos"
FIRST=0
[ -f "$APP/coinsos.env" ] || FIRST=1

mkdir -p "$APP/releases" "$HOME/init.d" "$HOME/services.d"
# (older layout used folders; the container wants one file per service)
rm -rf "$HOME/services.d/coinsos-db" "$HOME/services.d/coinsos"

# program + migrations (replace in place; s6 restarts the service when we kill it)
cp "$HERE/bin/coinsos-server" "$APP/coinsos-server.new"
chmod +x "$APP/coinsos-server.new"
mv "$APP/coinsos-server.new" "$APP/coinsos-server"
rm -rf "$APP/migrations"
cp -r "$HERE/migrations" "$APP/migrations"

# dashboard files are served by Caddy from the shared sites folder
rm -rf /sites/coins
mkdir -p /sites/coins
cp -r "$HERE/site/." /sites/coins/

# first run only: create config with random secrets (never overwritten later)
if [ "$FIRST" = 1 ]; then
  rnd() { head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "$1"; }
  cat > "$APP/coinsos.env" <<ENV
DB_PASSWORD=$(rnd 24)
JWT_SECRET=$(rnd 48)
DASHBOARD_URL=$(cat "$HERE/dashboard-url.txt")
# Set these for real invite / password-reset emails:
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM="CoinsOS <no-reply@localhost>"
WHATTOMINE_API_TOKEN=
CORS_ORIGINS=
ENV
  chmod 600 "$APP/coinsos.env"
fi

# boot hooks (picked up by the container on start)
cp "$HERE/hooks/10-coinsos.sh" "$HOME/init.d/10-coinsos.sh"
cp "$HERE/hooks/coinsos-db.run" "$HOME/services.d/coinsos-db"
cp "$HERE/hooks/coinsos.run" "$HOME/services.d/coinsos"
chmod +x "$HOME/init.d/10-coinsos.sh" "$HOME/services.d/coinsos-db" "$HOME/services.d/coinsos"

# update case: stop the old backend so the supervisor starts the new one
pkill -x coinsos-server 2>/dev/null || true

if [ "$FIRST" = 1 ]; then
  echo
  echo "First install done. Restart the Home VPS app once so it installs the"
  echo "database and starts CoinsOS. Then add the Caddy snippet (coinsos-kit/README.md)."
else
  echo "Updated. CoinsOS is restarting."
fi
