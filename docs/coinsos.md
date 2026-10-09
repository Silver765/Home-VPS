# Hosting CoinsOS (and publishing just the dashboard)

CoinsOS runs as its own app (`jb-coinsos`: postgres + backend + dashboard).
Home VPS is the public front door for the dashboard only.

```
internet -> Cloudflare Tunnel -> Home VPS Caddy (:8088) -> CoinsOS dashboard (:3020) -> backend
LAN rigs ----------------------------------------------> CoinsOS backend (:8080, udp :9999)
OS images: ~/releases folder of the CoinsOS app, LAN only
```

## 1. Publish the dashboard on a domain
1. Create a Cloudflare Tunnel with a public hostname (e.g. `coins.example.com`)
   pointing at `http://<box-ip>:8088`.
2. In Home VPS > Web Server, add this to the Caddyfile (keep your existing `:80` block *after* it):

```
http://coins.example.com {
	# Keep OS images off the internet: block the Downloads API on the public hostname.
	@downloads path /api/v1/downloads*
	respond @downloads "Not available on this address." 404

	reverse_proxy host.docker.internal:3020
}
```
3. Set `DASHBOARD_URL` in the CoinsOS compose to `https://coins.example.com` (used in email links),
   and add real `SMTP_*` values so invites and password resets send.
4. Turn on 2FA for your account in the CoinsOS dashboard (Settings) - it can push commands to your rigs.

Downloads still work from the LAN address `http://<box-ip>:3020`.

## 2. Add the OS image
Build on a Linux machine (WSL works), see CoinsOS `os-image/README.md`, then copy
`coinsos-*.img.xz` and the matching `.sha256` into the CoinsOS app's `releases` folder
(`<app data>/data/releases`). They show up on the Downloads page.

## 3. Rigs
Rigs on your LAN enroll against `http://<box-ip>:8080` (or via discovery). Rigs outside
your LAN would need the backend reachable too - not set up here.
