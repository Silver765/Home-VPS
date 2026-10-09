# Host CoinsOS on your Home VPS (manual, not a built-in app)

CoinsOS runs *inside* the Home VPS shell: Postgres + the CoinsOS backend as supervised
services, and the dashboard as static files served by the Home VPS web server (Caddy).
One command builds everything on your PC and deploys it. Re-run it to update.

```
internet -> Cloudflare Tunnel -> Home VPS Caddy -> dashboard files + /api,/ws -> backend (:8080)
LAN rigs ---------------------------------------> backend (:8080, udp :9999)
```

## Requirements
* Home VPS app **1.2.0 or newer** (adds the ports and boot hooks this uses).
* On your PC: Docker, and Windows' built-in `ssh` and `tar`. No Go or Node needed.

## First time
1. From this folder, in PowerShell (use `-Arch arm64` if the box is a Raspberry Pi):
   ```
   .\deploy.ps1 -BoxHost 192.168.1.50
   ```
   Enter your Home VPS password when asked (the dashboard password, default `admin`).
2. **Restart the Home VPS app once** (this installs Postgres and starts CoinsOS).
3. Home VPS dashboard > **Web Server**, paste into the Caddyfile (keep the existing `:80` block):
   ```
   # CoinsOS dashboard on your LAN: http://<box-ip>:8089
   :81 {
   	handle /api/* {
   		reverse_proxy vps:8080
   	}
   	handle /ws/* {
   		reverse_proxy vps:8080
   	}
   	handle {
   		root * /srv/coins
   		try_files {path} /index.html
   		file_server
   	}
   }

   # CoinsOS dashboard on the internet. OS image downloads are blocked on this address.
   http://coins.example.com {
   	@downloads path /api/v1/downloads*
   	handle @downloads {
   		respond "Not available on this address." 404
   	}
   	handle /api/* {
   		reverse_proxy vps:8080
   	}
   	handle /ws/* {
   		reverse_proxy vps:8080
   	}
   	handle {
   		root * /srv/coins
   		try_files {path} /index.html
   		file_server
   	}
   }
   ```
4. For the public address, create a Cloudflare Tunnel with hostname `coins.example.com` ->
   `http://<box-ip>:8088`, and run the deploy again with `-DashboardUrl https://coins.example.com`
   the first time (it is used in invite / password-reset links), or edit `DASHBOARD_URL` in
   `~/coinsos/coinsos.env` (Home VPS > Files > VPS home) and restart.

## Updating
Run `.\deploy.ps1 -BoxHost <ip>` again. Your database and secrets are kept; the backend restarts itself.

## OS images (LAN only)
Build the image on a Linux machine (CoinsOS `os-image/README.md`), then upload the `.img.xz` and its
`.sha256` to `~/coinsos/releases` with Home VPS > Files > VPS home. They appear on the dashboard's
Downloads page when you use the LAN address (port 8089), and never on the public one.

## Rigs
* **Rigs on your LAN**: discovery works as normal (backend ports 8080 and UDP 9999 are published).
* **Rigs elsewhere**: skip discovery. Put `BACKEND_URL=wss://coins.example.com` and an enrollment
  token in the rig's `COINSOSCFG` `rig.conf` before flashing; it enrolls and sends heartbeats
  through the same domain with no extra ports.

## Settings
`~/coinsos/coinsos.env` holds the database password, JWT secret, `DASHBOARD_URL` and optional SMTP
settings (needed for real invite / reset emails). Edit it in Home VPS > Files, then restart the app.

## How it works
`deploy.ps1` builds in Docker, uploads one tarball over SSH, and `remote/install.sh` puts it in place:
`~/coinsos` (program, migrations, env, database, releases), `/sites/coins` (dashboard files), plus
`~/init.d` (installs Postgres on every boot - apk packages don't survive a container re-create)
and `~/services.d` (supervised Postgres + backend).

## Troubleshooting
* Backend logs: Home VPS app logs (the supervisor prints them). Or in the Terminal: `ps aux | grep coinsos`.
* Port 8080 / 9999 already used by another app on the box: change the left-hand number of those
  ports in the Home VPS compose file, and point `BACKEND_URL` / rigs at the new port.
