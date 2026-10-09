# Home VPS

A personal VPS for Umbrel / 5tratumOS (or any Docker host): host your own
sites and tools on hardware you own instead of renting a VPS.

* **Dashboard** (port 3010, CoinsOS-style UI): connection details, live CPU/RAM/disk,
  a web terminal, a file manager and a Caddyfile editor. Login = the app password.
* **SSH shell** (port 2222): Alpine Linux, user `vps`, sudo. `sudo apk add git nodejs python3 ...`
* **Web server** (port 8088): Caddy serving the `sites` folder; edit the Caddyfile in the
  dashboard to add domains or reverse-proxy your other apps. Saves reload automatically.

## Install on Umbrel / 5tratumOS
Add `https://github.com/Silver765/Home-VPS` as a community app store, then install **Home VPS**.
Open the app tile (port 3010) and sign in with the app password.

## Plain Docker
```
cd standalone
echo "APP_PASSWORD=choose-a-long-password" > .env
docker compose up -d --build
```

## Hosting other things
* CoinsOS (dashboard public, OS images LAN-only), one-command deploy: see [coinsos-kit/README.md](coinsos-kit/README.md).

## Notes
* The dashboard password is also the SSH password. Use a long one.
* To reach it from the internet use a Cloudflare Tunnel (or forward 8088); don't expose
  2222 or 3010 publicly without a strong password / keys.
* The dashboard image is built by `.github/workflows/publish-image.yml` and published to
  `ghcr.io/silver765/home-vps-app`; the compose file pins it by digest.
