import { nanoid } from 'nanoid';
import { db } from './schema.js';
import { APP_PORT_MIN, APP_PORT_MAX } from '../core/config.js';

const now = () => Date.now();

export function listApps() {
  return db.prepare('SELECT * FROM apps ORDER BY created_at DESC').all();
}

export function getApp(slug) {
  return db.prepare('SELECT * FROM apps WHERE slug = ?').get(slug);
}

/** Lowest unused port in the range, so a deleted app frees its port for reuse. */
function allocatePort() {
  const taken = new Set(
    db.prepare('SELECT port FROM apps WHERE port IS NOT NULL').all().map((r) => r.port),
  );
  for (let p = APP_PORT_MIN; p <= APP_PORT_MAX; p++) {
    if (!taken.has(p)) return p;
  }
  throw new Error('no free ports left in the hoster range');
}

export function createApp({ slug, sourcePath }) {
  const app = {
    id: nanoid(12),
    slug,
    source_path: sourcePath,
    port: allocatePort(),
    created_at: now(),
    updated_at: now(),
  };
  db.prepare(`
    INSERT INTO apps (id, slug, source_path, port, status, created_at, updated_at)
    VALUES (@id, @slug, @source_path, @port, 'created', @created_at, @updated_at)
  `).run(app);
  return getApp(slug);
}

export function updateApp(slug, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return getApp(slug);
  const set = keys.map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE apps SET ${set}, updated_at = @updated_at WHERE slug = @slug`)
    .run({ ...fields, slug, updated_at: now() });
  return getApp(slug);
}

export function deleteApp(slug) {
  db.prepare('DELETE FROM apps WHERE slug = ?').run(slug);
}

export function startDeploy(appId) {
  const id = nanoid(12);
  db.prepare(`INSERT INTO deploys (id, app_id, status, started_at) VALUES (?, ?, 'building', ?)`)
    .run(id, appId, now());
  return id;
}

export function appendLog(deployId, chunk) {
  db.prepare('UPDATE deploys SET log = log || ? WHERE id = ?').run(chunk, deployId);
}

export function finishDeploy(deployId, status) {
  db.prepare('UPDATE deploys SET status = ?, ended_at = ? WHERE id = ?')
    .run(status, now(), deployId);
}

export function latestDeploy(appId) {
  return db.prepare('SELECT * FROM deploys WHERE app_id = ? ORDER BY started_at DESC LIMIT 1')
    .get(appId);
}
