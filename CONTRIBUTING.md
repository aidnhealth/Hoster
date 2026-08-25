# Contributing

Contributions are welcome.

## Getting set up

```bash
git clone <your-fork>
cd Hoster
npm install
npm run dev          # control plane with reload on change
```

You need Docker running, plus `nixpacks` and `cloudflared`:

```bash
brew install nixpacks cloudflared
```

`sudo ./setup.sh` is only needed if you want `*.hoster.local` to resolve in a
browser. Without it you can still test with an explicit Host header:

```bash
curl -H "Host: myapp.hoster.local" http://localhost/
```

## Layout

| Path | What lives there |
|---|---|
| `src/core/` | Deploy engine, Docker, Postgres, secrets, config |
| `src/builders/` | Stack detection |
| `src/routing/` | Caddy config generation, Cloudflare tunnels |
| `src/api/` | HTTP control plane |
| `src/cli/` | `hoster` command |
| `src/db/` | SQLite schema and queries |
| `dashboard/public/` | Dashboard, dependency-free |

## Ground rules

- **Never commit a credential.** Secrets are generated at runtime into
  `~/.hoster/secrets.json`. If you add one, follow that pattern.
- Keep the dashboard dependency-free — plain HTML, CSS and JS, no build step.
- Comments should explain *why*, not restate the code.
- Test a change end to end before opening a PR: deploy a container app and a
  static app, confirm both serve, then open a tunnel.

## Good first issues

- A `hoster env` command for setting per-app environment variables
- Named Cloudflare tunnels, so public URLs stay stable
- Streaming build logs to the dashboard over SSE instead of polling
- Health checks with automatic rollback on a failed deploy
