import fs from 'node:fs';
import path from 'node:path';
import { run, runOrThrow } from '../core/exec.js';
import {
  CADDY_DIR, CADDY_CONTAINER, CADDY_IMAGE, NETWORK, ROOT_DOMAIN, APPS_DIR,
} from '../core/config.js';
import { containerExists, isRunning, removeContainer } from '../core/docker.js';
import { listApps } from '../db/apps.js';

const CADDYFILE = path.join(CADDY_DIR, 'Caddyfile');

/**
 * Rebuild the whole Caddyfile from current app state. Regenerating wholesale is
 * simpler than patching and can't drift from the database.
 */
export function writeCaddyfile() {
  fs.mkdirSync(CADDY_DIR, { recursive: true });

  const blocks = listApps()
    .filter((a) => a.status === 'live')
    .map((app) => {
      // Listen on both schemes: HTTPS for normal use, plain HTTP so phones and
      // other devices that will not trust the internal CA can still connect.
      const host = `http://${app.slug}.${ROOT_DOMAIN}, https://${app.slug}.${ROOT_DOMAIN}`;
      if (app.kind === 'static') {
        return [
          `${host} {`,
          `\troot * /srv/${app.slug}`,
          `\tencode gzip`,
          `\tfile_server`,
          `\ttry_files {path} /index.html`, // SPA client-side routing
          `}`,
        ].join('\n');
      }
      return [
        `${host} {`,
        `\tencode gzip`,
        `\treverse_proxy ${app.slug}:${app.port}`,
        `}`,
      ].join('\n');
    });

  // Dashboard on the bare root domain, plus a plain-HTTP fallback on :80 so
  // devices that won't trust the internal CA can still reach apps.
  const header = [
    `{`,
    `\tauto_https disable_redirects`,
    `}`,
    ``,
    `http://${ROOT_DOMAIN}, https://${ROOT_DOMAIN} {`,
    `\treverse_proxy host.docker.internal:${process.env.HOSTER_PORT ?? 7010}`,
    `}`,
  ].join('\n');

  fs.writeFileSync(CADDYFILE, [header, ...blocks].join('\n\n') + '\n');
  return CADDYFILE;
}

export async function ensureCaddy() {
  writeCaddyfile();
  if (await isRunning(CADDY_CONTAINER)) return reload();

  if (await containerExists(CADDY_CONTAINER)) await removeContainer(CADDY_CONTAINER);

  await runOrThrow('docker', [
    'run', '-d',
    '--name', CADDY_CONTAINER,
    '--network', NETWORK,
    '--restart', 'unless-stopped',
    '--add-host', 'host.docker.internal:host-gateway',
    '-p', '80:80', '-p', '443:443',
    '-v', `${CADDYFILE}:/etc/caddy/Caddyfile:ro`,
    '-v', `${APPS_DIR}:/srv:ro`,
    '-v', 'hoster-caddy-data:/data',
    CADDY_IMAGE,
  ]);
}

/** Apply a regenerated Caddyfile without dropping in-flight connections. */
export async function reload() {
  writeCaddyfile();
  const res = await run('docker', [
    'exec', CADDY_CONTAINER,
    'caddy', 'reload', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile',
  ]);
  if (res.code !== 0) throw new Error(`caddy reload failed: ${res.stderr}`);
}
