# Security

## Reporting a vulnerability

If this repository is on GitHub, use **Security → Advisories → Report a
vulnerability**. Otherwise email the maintainer privately. Please allow a
reasonable window for a fix before public disclosure.

## Threat model, stated plainly

Hoster runs code you point it at, on your machine. It is built for a trusted
operator hosting their own projects. It is **not** hardened for running code
submitted by people you do not trust.

Know these properties before you rely on it:

- **Deploying an app executes its build.** Build scripts, `postinstall` hooks and
  Dockerfiles all run with your user's privileges. Only deploy code you trust.
- **`hoster share` puts an app on the public internet with no authentication.**
  Anyone with the URL reaches it. Do not share an app holding real data unless
  the app does its own authentication.
- **The control plane has no auth.** It listens on `127.0.0.1` and anyone who can
  reach that port can deploy and delete apps. Do not expose port 7010.
- **Containers are isolated by Docker, not by a sandbox.** They are capped at
  1 GB memory and 1.5 CPUs, share one docker network, and can reach each other.

## How secrets are handled

- No API keys are required by any part of Hoster.
- The Postgres superuser password and every per-app database password are
  generated randomly on first run.
- They are stored in `~/.hoster/secrets.json` with mode `0600`, outside the
  repository, and are gitignored. No credential is committed.
- Postgres is published on `127.0.0.1:7432` only, never to the LAN.
