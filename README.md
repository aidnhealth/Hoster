# Hoster

**Your own machine as a hosting platform.** Point it at a project folder — it
detects the stack, builds it, runs it, gives it a Postgres database, and puts it
behind a URL. Front-end and back-end both.

Works on your local network with **no internet at all**. When you want to show
someone outside, one command gives you a public link.

No API keys. No accounts. No cloud bill.

```bash
hoster deploy ./my-app
#   http://my-app.hoster.localhost      <- works immediately, no setup

hoster share my-app
#   https://indirect-trying-randy.trycloudflare.com   <- send this to anyone
```

---

## Why

Self-hosting a side project usually means renting a VPS, wiring up nginx,
managing certificates and paying monthly for something that gets ten visitors.
Hoster puts that on hardware you already own. Deploys are one command, apps come
back after a reboot, and nothing leaves your machine unless you ask it to.

## What it does

- **Detects the stack automatically** — a Dockerfile if the repo has one,
  otherwise [Nixpacks](https://nixpacks.com) (Node, Python, Go, Ruby, Rust, PHP,
  Java), otherwise plain static files.
- **React, Vue, Svelte and Angular** build to static assets served directly, with
  client-side routing fallback so deep links work.
- **A Postgres database per app**, created on first deploy and injected as
  `DATABASE_URL`. Your app just reads it.
- **Automatic HTTPS** on your LAN via Caddy's internal CA.
- **A public link on demand** through a Cloudflare quick tunnel. No port
  forwarding, no router config, no domain, no Cloudflare account.
- **Survives reboots** — apps restart when you log back in.
- **Web dashboard and a CLI**, whichever you prefer.

## Requirements

| Needed | Notes |
|---|---|
| macOS | Linux support is a welcome PR |
| Docker | Must be running |
| Node.js 20+ | Runs the control plane |
| `nixpacks`, `cloudflared` | `brew install nixpacks cloudflared` |
| **API keys** | **None. Nothing to sign up for.** |

## Install

```bash
git clone https://github.com/<you>/hoster.git
cd hoster
npm install
npm start
```

Open **http://localhost:7010** and deploy something. Apps land on
`http://<name>.hoster.localhost`, which every browser resolves to your machine
on its own — no DNS configuration, no `sudo`, nothing to edit.

### Optional: LAN access and start-on-login

```bash
sudo ./setup.sh
```

Two things `.localhost` cannot do: resolve from *other devices* on your network,
and start Hoster automatically when you log in. `setup.sh` covers both — it
points `*.hoster.local` at your machine via dnsmasq and installs a launchd agent.
Afterwards, run with `HOSTER_DOMAIN=hoster.local`.

## Usage

```bash
hoster deploy ./my-app [--name slug]   # build and publish
hoster ls                              # list apps and their URLs
hoster logs <slug>                     # app logs
hoster share <slug>                    # public internet URL
hoster unshare <slug>                  # close it again
hoster stop|start <slug>               # stop or start an app
hoster rm <slug>                       # remove app, container and database
```

The dashboard does all of the same things with buttons.

## Reaching your apps from elsewhere

This is the part worth being precise about, because one of these is impossible.

| Where the visitor is | Internet needed | How they get in |
|---|---|---|
| This machine | **No** | `http://myapp.hoster.localhost` |
| Phone or laptop on the same Wi-Fi | **No** | `http://<your-lan-ip>:<port>` — shown on the app's card |
| Anywhere else | Yes | `hoster share myapp` |
| Anywhere else, no internet | — | **Not possible.** No network path exists. |

Offline hosting and worldwide access are different modes, not one feature. On
your LAN, Hoster is genuinely internet-free. Off it, packets need a network, and
the tunnel is what provides one.

**Hostnames do not travel.** `*.hoster.localhost` resolves to 127.0.0.1 on
whichever device asks — on your phone it means *the phone*. So every app is also
published on its own port across the network, and the dashboard shows that
address on each app's card:

```
this mac       http://myapp.hoster.localhost
your network   http://192.168.1.7:7100     <- open this on your phone
```

That works on any device on the same Wi-Fi with no internet, no DNS setup and
nothing installed. If you would rather have names than ports on the LAN, run
`setup.sh` and point the other devices' DNS at your machine.

## Using the database

Every container app gets `DATABASE_URL` in its environment. Nothing to configure:

```js
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
```

To connect yourself:

```bash
psql "$(node -e "
  const {getApp}=require('./src/db/apps.js');
  console.log(getApp('my-app').db_url)
")"
```

## How it works

```
        CLI  ────┐            ┌──── dashboard
                 ▼            ▼
          control plane (Node + SQLite)
              app state, deploy history
                       │
      ┌────────────────┼────────────────┐
      ▼                ▼                ▼
   builder          Docker            Caddy
 Dockerfile      one container     routes *.hoster.local
   → nixpacks      per app,        terminates TLS
   → static      1 GB / 1.5 CPU
                       │
                  Postgres
             one database + role per app
                       │
      ┌────────────────┴────────────────┐
      ▼                                 ▼
  dnsmasq                       Cloudflare Tunnel
  LAN, no internet               public link
```

A deploy: detect the stack → build an image (or compile static assets) →
provision the database → start the container → regenerate the Caddyfile → reload
Caddy. Routing config is rebuilt wholesale from the database each time, so it
cannot drift from reality.

## Security

Hoster is built for a trusted operator hosting their own projects. Deploying an
app runs its build scripts on your machine, and `hoster share` exposes an app
publicly with no authentication.

All database passwords are generated randomly on first run and stored in
`~/.hoster/secrets.json` with mode `0600`, never in the repo. Postgres binds to
`127.0.0.1` only.

Read [SECURITY.md](SECURITY.md) before hosting anything that matters.

## Limits worth knowing

- Tunnel URLs change on every restart. Stable custom domains need a named
  Cloudflare tunnel and a domain you own.
- The control plane has no authentication. Keep port 7010 on localhost.
- Sharing refuses to publish an app that is not answering locally, so a public
  link never hands someone a Cloudflare 502.
- `hoster rm` drops the app's database with no undo.
- Apps are capped at 1 GB memory and 1.5 CPUs each.
- `.localhost` names work only on this machine; other devices use the port URL.
- Opening a public tunnel takes up to a minute while its DNS propagates. Hoster
  waits for the link to actually work before handing it to you, rather than
  returning a URL that answers Cloudflare 1033 for the first half minute.
- macOS only for now.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Issues and PRs welcome.

## License

MIT — see [LICENSE](LICENSE).
