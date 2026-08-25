import os from 'node:os';
import express from 'express';
import path from 'node:path';
import { APPS_DIR } from '../core/config.js';
import { listApps } from '../db/apps.js';

const servers = new Map(); // slug -> http.Server

/**
 * The address other devices on the network use to reach this machine.
 * Hostnames are no help here: *.localhost resolves to loopback on whatever
 * device asks, so a phone would only ever reach itself.
 */
export function lanAddress() {
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (name.startsWith('lo')) continue;
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return null;
}

export const lanUrl = (app) => {
  const ip = lanAddress();
  return ip && app.port ? `http://${ip}:${app.port}` : null;
};

/**
 * Static apps have no container, so nothing binds their port. Serve them here,
 * on 0.0.0.0, so any device on the network can reach them by IP with no DNS.
 */
export function serveStatic(app) {
  stopStatic(app.slug);
  const dir = path.join(APPS_DIR, app.slug);
  const srv = express();
  srv.use(express.static(dir));
  srv.get('*', (_req, res) => res.sendFile(path.join(dir, 'index.html')));

  return new Promise((resolve) => {
    const listener = srv.listen(app.port, '0.0.0.0', () => {
      servers.set(app.slug, listener);
      resolve(listener);
    });
    listener.on('error', () => resolve(null)); // port busy: LAN URL just won't work
  });
}

export function stopStatic(slug) {
  const s = servers.get(slug);
  if (s) s.close();
  servers.delete(slug);
}

/** Bring every live static app back up after a restart. */
export async function restoreStatic() {
  const apps = listApps().filter((a) => a.kind === 'static' && a.status === 'live');
  for (const a of apps) await serveStatic(a);
  return apps.length;
}
