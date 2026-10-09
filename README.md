# Home VPS (Umbrel community app store + standalone)

## Umbrel (see jb-homevps-store)
1. Repo: https://github.com/Silver765/Home-VPS (store files are at the repo root).
2. Umbrel: App Store -> ... menu -> Community App Stores -> add the repo URL.
3. Install **Home VPS**.
   - File manager: open the app tile (login admin/admin on first run - change it).
   - SSH: `ssh vps@<umbrel-ip> -p 2222` (password = app password from Umbrel).
   - Websites: drop files in `sites/` -> http://<umbrel-ip>:8088
   - Edit `data/Caddyfile` to reverse-proxy other services or add domains.
4. To reach it from the internet: Cloudflare Tunnel (no port forwarding) or forward 8088/2222.

## 5tratum OS / any Docker host
```
cd standalone
echo "SSH_PASSWORD=changeme" > .env
docker compose up -d
```
Ports: 8081 file manager, 2222 SSH, 8088 websites.

Note: the SSH box is Alpine-based (`sudo apk add git nodejs python3 ...`).
Don't expose SSH publicly with a weak password - use keys or a tunnel.
