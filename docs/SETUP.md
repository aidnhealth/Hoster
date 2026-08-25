# Setup guide

End-to-end install, first deploy, LAN access, environment variables, and
troubleshooting for Hoster on macOS.

---

## 1. Prerequisites

| Tool | Why | Install |
|---|---|---|
| **macOS** | Supported platform today | — |
| **Docker Desktop** | Runs app containers, Caddy, Postgres | [Docker Desktop](https://www.docker.com/products/docker-desktop/) — must be **running** |
| **Node.js 20+** | Control plane + CLI | `brew install node` |
| **nixpacks** | Builds apps without a Dockerfile | `brew install nixpacks` |
| **cloudflared** | Public `hoster share` tunnels | `brew install cloudflared` |
| **Homebrew** | Recommended package manager | https://brew.sh |

Check versions:

```bash
node -v          # v20 or newer
docker info      # must succeed (daemon up)
nixpacks --version
cloudflared --version
```

No cloud accounts and no API keys are required.

---

## 2. Install Hoster

```bash
git clone <this-repository-url>
cd Hoster
npm install
npm link          # exposes the `hoster` CLI globally
```

`npm link` is optional if you only use the dashboard, but the CLI is the
fastest way to script deploys.

---

## 3. Start the control plane

```bash
npm start
# or, while developing:
npm run dev       # reloads on file changes
```

You should see:

```text
hoster control plane -> http://localhost:7010
```

Open **http://localhost:7010** in a browser.

Data and secrets are stored under `~/.hoster/` (never in the git repo):

| Path | Contents |
|---|---|
| `~/.hoster/data/hoster.db` | App registry (SQLite) |
| `~/.hoster/apps/` | Published static assets |
| `~/.hoster/secrets.json` | DB passwords (`0600`) |
| `~/.hoster/caddy/` | Generated Caddyfile |
| `~/.hoster/logs/` | Control-plane logs (if using launchd) |

---

## 4. Deploy your first app

### From the dashboard

1. Click **Browse…** and select a project folder (or paste an absolute path).
2. Optionally set a short name (slug).
3. Click **Deploy** and wait for the build.
4. Open the **this mac** URL on the app card.

### From the CLI

```bash
hoster deploy /absolute/path/to/your-app
hoster deploy /absolute/path/to/your-app --name my-api
hoster ls
hoster logs my-api
```

### What gets detected

| Project shape | Result |
|---|---|
| Has a `Dockerfile` | Built and run as a container |
| Node/Python/Go/… (Nixpacks) | Container + Postgres (`DATABASE_URL`) |
| React / Vite / Vue / … (no server framework) | Static build, served by Caddy |
| Plain `index.html` | Static files |

Container apps also get a sticky host port in the `7100–7999` range and a
dedicated Postgres database.

---

## 5. App environment variables

Many apps need config beyond `DATABASE_URL` (auth flags, broker URLs, etc.).

1. Open the app card → **Settings**.
2. Add `KEY=value` lines (one per line).
3. **Save**, then **Redeploy** so the container is recreated with the new env.

Do **not** put secrets in the git repo. Prefer Hoster Settings (stored in the
local SQLite DB under `~/.hoster/`).

Optional start-command override (Settings): replaces the image `CMD`, e.g.

```text
python scripts/run.py --env dev --role api
```

---

## 6. Reach apps from other devices

| Audience | URL |
|---|---|
| This Mac only | `http://<slug>.hoster.localhost` |
| Phones / laptops on the same Wi‑Fi | LAN URL on the card: `http://<your-lan-ip>:<port>` |
| Anyone on the internet | `hoster share <slug>` (requires outbound internet) |

`*.hoster.localhost` always means **this device**. On a phone it will not reach
your Mac — use the LAN port URL instead.

### Optional: named LAN hostnames + start on login

```bash
sudo ./setup.sh
```

This installs dnsmasq for `*.hoster.local`, a macOS resolver, and a launchd
agent so the control plane starts when you log in. Then run:

```bash
HOSTER_DOMAIN=hoster.local npm start
```

Point other devices’ DNS at your Mac’s LAN IP if you want them to resolve
`*.hoster.local` as well. Otherwise keep using the per-app port URLs.

---

## 7. Public sharing

```bash
hoster share my-app
hoster unshare my-app
```

Or use **Share publicly** / **Unshare** in the dashboard.

Notes:

- Uses a Cloudflare **quick tunnel** — no Cloudflare account needed.
- The URL changes every time you share / restart.
- Hoster waits until the tunnel answers before showing the URL.
- The shared app has **no authentication** unless the app itself provides it.
- Sharing is refused if the app is not healthy locally.

---

## 8. Day-to-day commands

```bash
hoster ls
hoster logs <slug>
hoster stop <slug>
hoster start <slug>
hoster rm <slug>          # deletes container + database — no undo
```

Dashboard buttons mirror these actions. Use **Redeploy** after changing source
or Settings.

---

## 9. Configuration reference

| Variable | Default | Meaning |
|---|---|---|
| `HOSTER_PORT` | `7010` | Control-plane / dashboard port |
| `HOSTER_DOMAIN` | `hoster.localhost` | Root domain for app hostnames |

Example:

```bash
HOSTER_PORT=7010 HOSTER_DOMAIN=hoster.local npm start
```

---

## 10. Using the app database

Container apps receive:

```text
DATABASE_URL=postgresql://…@hoster-postgres:5432/app_<slug>
```

From your Mac (example):

```bash
psql "$(node -e "
  const { getApp } = require('./src/db/apps.js');
  console.log(getApp('my-app').db_url.replace('hoster-postgres', '127.0.0.1:7432'));
")"
```

Postgres is bound to `127.0.0.1:7432` on the host and is not exposed to the LAN.

---

## 11. Troubleshooting

| Symptom | What to check |
|---|---|
| `control plane unreachable` | Is `npm start` running? Is something else on port 7010? |
| Docker / build errors | Docker Desktop running? `docker info` |
| App **crashed** / restart loop | Open **Logs** — usually missing env vars or a bad start command |
| Static site 404 on deep links | Expected to work via SPA fallback; redeploy after a clean build |
| Phone cannot open `.localhost` URL | Use the **your network** port URL on the card |
| `hoster share` hangs / fails | Need outbound internet; app must be healthy locally first |
| Port already in use | Stop the conflicting process or change `HOSTER_PORT` |
| Want a clean slate | `hoster rm <slug>` per app; remove `~/.hoster` only if you intend to wipe all state |

---

## 12. Uninstall / stop

```bash
# Stop the control plane (Ctrl+C if running in a terminal)

# Remove launchd agent if you ran setup.sh
launchctl unload ~/Library/LaunchAgents/com.hoster.control.plist 2>/dev/null || true
rm -f ~/Library/LaunchAgents/com.hoster.control.plist

# Optional: remove all local Hoster state (apps, DB, secrets)
# rm -rf ~/.hoster

npm unlink -g hoster   # if you used npm link
```

Docker containers named like your app slugs, plus `hoster-caddy` and
`hoster-postgres`, can be removed with Docker Desktop or `docker rm -f` if you
no longer need them.

---

## Related docs

- [README.md](../README.md) — overview
- [SECURITY.md](../SECURITY.md) — threat model
- [CONTRIBUTING.md](../CONTRIBUTING.md) — development layout
- [docs/index.html](index.html) — visual landing page (open in a browser)
