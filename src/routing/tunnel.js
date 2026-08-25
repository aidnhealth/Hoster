import { spawn } from 'node:child_process';
import { ROOT_DOMAIN } from '../core/config.js';
import { updateApp } from '../db/apps.js';

const tunnels = new Map(); // slug -> { proc, url }

/**
 * Expose one app publicly with a quick Cloudflare tunnel. This hands back a
 * trycloudflare.com URL that works for anyone, anywhere, with no DNS setup.
 * The URL changes each time the tunnel restarts.
 */
export function openTunnel(slug) {
  if (tunnels.has(slug)) return Promise.resolve(tunnels.get(slug).url);

  return new Promise((resolve, reject) => {
    // Always tunnel to Caddy rather than the app's own port: app containers live
    // on the docker network and publish nothing to the host, and this keeps
    // static and container apps on one identical path.
    const proc = spawn('cloudflared', [
      'tunnel', '--no-autoupdate',
      '--url', 'http://localhost:80',
      '--http-host-header', `${slug}.${ROOT_DOMAIN}`,
    ]);

    let settled = false;
    const onChunk = (buf) => {
      const text = buf.toString();
      const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match && !settled) {
        settled = true;
        const url = match[0];
        tunnels.set(slug, { proc, url });
        updateApp(slug, { public: 1, tunnel_url: url });
        resolve(url);
      }
    };
    proc.stdout.on('data', onChunk);
    proc.stderr.on('data', onChunk); // cloudflared logs the URL to stderr

    proc.on('error', reject);
    proc.on('close', () => {
      tunnels.delete(slug);
      updateApp(slug, { public: 0, tunnel_url: null });
      if (!settled) reject(new Error('cloudflared exited before printing a URL'));
    });

    setTimeout(() => {
      if (!settled) { settled = true; proc.kill(); reject(new Error('tunnel timed out')); }
    }, 30000);
  });
}

export function closeTunnel(slug) {
  const entry = tunnels.get(slug);
  if (entry) entry.proc.kill();
  tunnels.delete(slug);
  updateApp(slug, { public: 0, tunnel_url: null });
}

// Caddy serves both schemes. Link to plain HTTP on .localhost, because its
// certificate comes from an internal CA the browser has no reason to trust yet
// and a warning interstitial is a worse first impression than no TLS locally.
export const localUrl = (slug) => {
  const scheme = ROOT_DOMAIN.endsWith('.localhost') ? 'http' : 'https';
  return `${scheme}://${slug}.${ROOT_DOMAIN}`;
};
