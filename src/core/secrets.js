import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HOME } from './config.js';

const SECRETS_PATH = path.join(HOME, 'secrets.json');

const generate = () => crypto.randomBytes(24).toString('base64url');

/**
 * Secrets live on the host, never in the repo. Generated on first run so that
 * two people who clone this project never share a database password.
 */
function load() {
  fs.mkdirSync(HOME, { recursive: true });
  if (fs.existsSync(SECRETS_PATH)) {
    return JSON.parse(fs.readFileSync(SECRETS_PATH, 'utf8'));
  }
  const fresh = { postgresSuperPass: generate(), apps: {} };
  fs.writeFileSync(SECRETS_PATH, JSON.stringify(fresh, null, 2), { mode: 0o600 });
  return fresh;
}

let cache = load();

const persist = () => fs.writeFileSync(
  SECRETS_PATH, JSON.stringify(cache, null, 2), { mode: 0o600 },
);

export const postgresSuperPass = () => cache.postgresSuperPass;

/** A per-app database password, created once and reused across redeploys. */
export function appDbPassword(slug) {
  if (!cache.apps[slug]) {
    cache.apps[slug] = generate();
    persist();
  }
  return cache.apps[slug];
}

export function forgetApp(slug) {
  delete cache.apps[slug];
  persist();
}
