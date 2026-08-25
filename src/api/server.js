import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTROL_PORT, ROOT_DOMAIN } from '../core/config.js';
import { listApps, getApp, deleteApp, latestDeploy, updateApp } from '../db/apps.js';
import { deploy, stopApp, startApp } from '../core/deploy.js';
import { logs, removeContainer } from '../core/docker.js';
import { dropDatabase } from '../core/postgres.js';
import { openTunnel, closeTunnel, localUrl } from '../routing/tunnel.js';
import { reload } from '../routing/caddy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createServer() {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '../../dashboard/public')));

  const wrap = (fn) => (req, res) => {
    Promise.resolve(fn(req, res)).catch((err) =>
      res.status(500).json({ error: err.message }));
  };

  app.get('/api/apps', wrap((_req, res) => {
    res.json(listApps().map((a) => ({
      ...a,
      local_url: localUrl(a.slug),
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
    await removeContainer(a.slug);
    await dropDatabase(a.db_name, a.slug);
    deleteApp(a.slug);
    await reload();
    res.json({ ok: true });
  }));

  app.get('/api/info', (_req, res) =>
    res.json({ domain: ROOT_DOMAIN, port: CONTROL_PORT }));

  return app;
}
