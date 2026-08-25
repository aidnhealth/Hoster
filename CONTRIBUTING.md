# Contributing

Contributions are welcome.

## Development setup

Follow [docs/SETUP.md](docs/SETUP.md) for prerequisites, then:

```bash
git clone <this-repository-url>
cd Hoster
npm install
npm run dev          # control plane with reload on change
```

You need Docker running, plus `nixpacks` and `cloudflared`:

```bash
brew install nixpacks cloudflared
```

`sudo ./setup.sh` is only needed for `*.hoster.local` DNS and start-on-login.
Without it you can still smoke-test routing with:

```bash
curl -H "Host: myapp.hoster.localhost" http://127.0.0.1/
```

## Layout

| Path | What lives there |
|---|---|
| `src/core/` | Deploy engine, Docker, Postgres, secrets, config |
| `src/builders/` | Stack detection and isolated static builds |
| `src/routing/` | Caddy, LAN static servers, Cloudflare tunnels |
| `src/api/` | HTTP control plane |
| `src/cli/` | `hoster` command |
| `src/db/` | SQLite schema and queries |
| `dashboard/public/` | Dashboard (no bundler) |
| `docs/` | Setup guide, landing page, assets |

## Ground rules

- **Never commit a credential.** Secrets are generated at runtime into
  `~/.hoster/secrets.json`. Follow that pattern for any new secret.
- Keep the dashboard dependency-free — plain HTML, CSS, and JS.
- Comments should explain *why*, not restate the code.
- Before opening a PR: deploy a container app and a static app, confirm both
  serve, then open and close a tunnel.

## License

By contributing you agree that your contributions are licensed under the MIT
License (see [LICENSE](LICENSE)).
