import fs from 'node:fs';
import { Resolver } from 'node:dns/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT_DOMAIN, LOGS_DIR } from '../core/config.js';
import { updateApp, listApps } from '../db/apps.js';

const tunnels = new Map(); // slug -> { proc, url, log }

const logPath = (slug) => path.join(LOGS_DIR, `tunnel-${slug}.log`);

/** Last few meaningful lines of cloudflared output, for error messages. */
function tailLog(slug, lines = 6) {
  try {
    return fs.readFileSync(logPath(slug), 'utf8')
      .split('\n')
      .filter((l) => /ERR|WRN|error|failed/i.test(l))
      .slice(-lines)
      .join('\n');
  } catch { return ''; }
}

/**
 * Expose one app publicly with a Cloudflare quick tunnel.
 *
 * Always tunnels to Caddy rather than the app's own port: static apps have no
 * container, and this keeps every app on one identical path.
 */
export function openTunnel(slug) {
  if (tunnels.has(slug)) return Promise.resolve(tunnels.get(slug).url);

  fs.mkdirSync(LOGS_DIR, { recursive: true });
  const out = fs.createWriteStream(logPath(slug), { flags: 'w' });

  return new Promise((resolve, reject) => {
    const proc = spawn('cloudflared', [
      'tunnel', '--no-autoupdate',
      '--url', 'http://localhost:80',
      '--http-host-header', `${slug}.${ROOT_DOMAIN}`,
    ]);

    let gotUrl = false;
    let alive = true;
    let finished = false;

    const done = (fn, arg) => { if (!finished) { finished = true; fn(arg); } };

    const onChunk = (buf) => {
      const text = buf.toString();
      out.write(text);
      const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match && !gotUrl) {
        gotUrl = true;
        const url = match[0];
        tunnels.set(slug, { proc, url });
        // cloudflared prints the URL before Cloudflare's edge has finished
        // routing it. Handing it over now is what produces error 1033, so wait
        // until the hostname genuinely answers.
        waitForEdge(url, () => alive)
          .then(() => {
            updateApp(slug, { public: 1, tunnel_url: url });
            done(resolve, url);
          })
          .catch((err) => {
            proc.kill();
            const detail = tailLog(slug);
            done(reject, new Error(detail ? `${err.message}\n${detail}` : err.message));
          });
      }
    };

    proc.stdout.on('data', onChunk);
    proc.stderr.on('data', onChunk); // cloudflared logs the URL to stderr

    proc.on('error', (err) => done(reject, new Error(
      err.code === 'ENOENT'
        ? 'cloudflared is not installed — run: brew install cloudflared'
        : err.message,
    )));

    proc.on('close', () => {
      alive = false;
      tunnels.delete(slug);
      updateApp(slug, { public: 0, tunnel_url: null });
      const detail = tailLog(slug);
      done(reject, new Error(
        `cloudflared exited before the tunnel came online${detail ? `\n${detail}` : ''}`,
      ));
    });

    setTimeout(() => {
      if (!gotUrl) {
        proc.kill();
        done(reject, new Error('cloudflared never printed a URL — check your connection'));
      }
    }, 30000);
  });
}

/**
 * Wait until a fresh quick tunnel is genuinely usable.
 *
 * Order matters here. A brand-new *.trycloudflare.com name does not exist in
 * DNS for the first several seconds, and asking the SYSTEM resolver too early
 * gets an NXDOMAIN that macOS then caches — poisoning every later lookup,
 * including the one fetch() itself would make. So the hostname is first
 * confirmed through a public resolver directly, and only once it exists do we
 * make an ordinary request through the system resolver.
 */
async function waitForEdge(url, isAlive, budgetMs = 120000) {
  const deadline = Date.now() + budgetMs;
  const host = new URL(url).hostname;

  const resolver = new Resolver({ timeout: 4000, tries: 1 });
  resolver.setServers(['1.1.1.1', '8.8.8.8']);

  // Phase 1: wait for the record to exist, without touching the system cache.
  let dnsError = 'not resolved';
  let resolved = false;
  while (Date.now() < deadline) {
    if (!isAlive()) throw new Error('cloudflared stopped while the tunnel was starting');
    try {
      const addrs = await resolver.resolve4(host);
      if (addrs?.length) { resolved = true; break; }
    } catch (err) {
      dnsError = err.code ?? err.message;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  if (!resolved) {
    throw new Error(`tunnel hostname never appeared in DNS (${dnsError})`);
  }

  // Phase 2: the name exists, so a normal request cannot poison the cache.
  let lastError = 'no response yet';
  while (Date.now() < deadline) {
    if (!isAlive()) throw new Error('cloudflared stopped while the tunnel was starting');
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
      });
      if (res.status < 400) return;
      const body = await res.text().catch(() => '');
      if (!/1033|Argo Tunnel error/i.test(body)) return; // a real app response
      lastError = `Cloudflare 1033 — edge has no connector yet (HTTP ${res.status})`;
    } catch (err) {
      lastError = `${err.cause?.code ?? err.name}: ${err.cause?.message ?? err.message}`;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`tunnel did not come online — last error: ${lastError}`);
}

export function closeTunnel(slug) {
  const entry = tunnels.get(slug);
  if (entry) entry.proc.kill();
  tunnels.delete(slug);
  updateApp(slug, { public: 0, tunnel_url: null });
}

export const localUrl = (slug) => {
  // Caddy serves both schemes. Link to plain HTTP on .localhost, because its
  // certificate comes from an internal CA the browser has no reason to trust
  // and a warning interstitial is a worse first impression than no local TLS.
  const scheme = ROOT_DOMAIN.endsWith('.localhost') ? 'http' : 'https';
  return `${scheme}://${slug}.${ROOT_DOMAIN}`;
};

/**
 * Called on startup. A tunnel is a child process of the control plane, so any
 * row still marked public points at a URL that died with the last run.
 */
export function clearStaleTunnels() {
  const stale = listApps().filter((a) => a.public || a.tunnel_url);
  for (const a of stale) updateApp(a.slug, { public: 0, tunnel_url: null });
  return stale.length;
}
