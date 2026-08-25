import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { CONTROL_PORT, ROOT_DOMAIN } from '../core/config.js';
import { listApps, getApp, deleteApp, latestDeploy, updateApp } from '../db/apps.js';
import { deploy, stopApp, startApp } from '../core/deploy.js';
import { logs, removeContainer } from '../core/docker.js';
import { dropDatabase } from '../core/postgres.js';
import { openTunnel, closeTunnel, localUrl } from '../routing/tunnel.js';
import { lanUrl, lanAddress, stopStatic } from '../routing/lan.js';
import { reconcile, containerState } from '../core/health.js';
import { reload } from '../routing/caddy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Marks folders that Hoster could actually deploy, so they surface first. */
const PROJECT_MARKERS = [
  'package.json', 'Dockerfile', 'requirements.txt', 'pyproject.toml',
  'go.mod', 'Gemfile', 'Cargo.toml', 'composer.json', 'index.html',
];
const looksLikeProject = (dir) => {
  try { return PROJECT_MARKERS.some((f) => fs.existsSync(path.join(dir, f))); }
  catch { return false; }
};

export function createServer() {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '../../dashboard/public')));

  const wrap = (fn) => (req, res) => {
    Promise.resolve(fn(req, res)).catch((err) =>
      res.status(500).json({ error: err.message }));
  };

  app.get('/api/apps', wrap(async (_req, res) => {
    // Report what is actually running, not what the last deploy returned.
    await reconcile();
    res.json(listApps().map((a) => ({
      ...a,
      local_url: localUrl(a.slug),
      lan_url: lanUrl(a),
      last_deploy: latestDeploy(a.id),
    })));
  }));

  app.post('/api/apps/:slug/deploy', wrap(async (req, res) => {
    const { sourcePath } = req.body ?? {};
    const existing = getApp(req.params.slug);
    const src = sourcePath ?? existing?.source_path;
    if (!src) return res.status(400).json({ error: 'sourcePath is required' });
    const result = await deploy({ slug: req.params.slug, sourcePath: src });
    res.json({ url: result.url, app: result.app });
  }));

  app.patch('/api/apps/:slug', wrap((req, res) => {
    const allowed = ['build_cmd', 'out_dir', 'start_cmd', 'kind_override', 'env_json'];
    const fields = Object.fromEntries(
      Object.entries(req.body ?? {}).filter(([k]) => allowed.includes(k)),
    );
    if (!Object.keys(fields).length) return res.status(400).json({ error: 'nothing to update' });
    res.json(updateApp(req.params.slug, fields));
  }));

  app.post('/api/apps/:slug/stop', wrap(async (req, res) => {
    await stopApp(req.params.slug);
    res.json({ ok: true });
  }));

  app.post('/api/apps/:slug/start', wrap(async (req, res) => {
    await startApp(req.params.slug);
    res.json({ ok: true });
  }));

  app.get('/api/apps/:slug/logs', wrap(async (req, res) => {
    const a = getApp(req.params.slug);
    if (!a) return res.status(404).json({ error: 'not found' });
    if (a.kind === 'static') {
      return res.json({ logs: latestDeploy(a.id)?.log ?? '' });
    }
    res.json({ logs: await logs(a.slug) });
  }));

  app.post('/api/apps/:slug/public', wrap(async (req, res) => {
    const a = getApp(req.params.slug);
    if (!a) return res.status(404).json({ error: 'not found' });
    if (req.body?.enabled === false) {
      closeTunnel(a.slug);
      return res.json({ public: false });
    }
    const url = await openTunnel(a.slug);
    res.json({ public: true, url });
  }));

  app.delete('/api/apps/:slug', wrap(async (req, res) => {
    const a = getApp(req.params.slug);
    if (!a) return res.status(404).json({ error: 'not found' });
    closeTunnel(a.slug);
    stopStatic(a.slug);
    await removeContainer(a.slug);
    await dropDatabase(a.db_name, a.slug);
    deleteApp(a.slug);
    await reload();
    res.json({ ok: true });
  }));

  // Directory browser for the deploy picker. Read-only, and it only ever lists
  // directory names — never file contents.
  app.get('/api/browse', wrap((req, res) => {
    const dir = req.query.path
      ? path.resolve(String(req.query.path))
      : os.homedir();

    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      return res.status(400).json({ error: `not a directory: ${dir}` });
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => {
        const full = path.join(dir, e.name);
        return { name: e.name, path: full, project: looksLikeProject(full) };
      })
      .sort((a, b) => Number(b.project) - Number(a.project) || a.name.localeCompare(b.name));

    res.json({ path: dir, parent: path.dirname(dir) === dir ? null : path.dirname(dir), entries });
  }));

  app.get('/api/info', (_req, res) =>
    res.json({ domain: ROOT_DOMAIN, port: CONTROL_PORT, lan: lanAddress() }));

  return app;
}
