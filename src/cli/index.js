#!/usr/bin/env node
import path from 'node:path';
import { CONTROL_PORT } from '../core/config.js';

const BASE = `http://localhost:${CONTROL_PORT}`;

async function api(route, opts = {}) {
  const res = await fetch(BASE + route, {
    ...opts,
    headers: { 'content-type': 'application/json', ...opts.headers },
  }).catch(() => {
    throw new Error(`control plane unreachable — is it running? (npm start)`);
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body;
}

const slugify = (s) =>
  path.basename(path.resolve(s)).toLowerCase().replace(/[^a-z0-9-]/g, '-');

const commands = {
  async deploy([src, nameFlag, name]) {
    if (!src) throw new Error('usage: hoster deploy <path> [--name <slug>]');
    const slug = nameFlag === '--name' && name ? name : slugify(src);
    console.log(`deploying ${slug}...`);
    const out = await api(`/api/apps/${slug}/deploy`, {
      method: 'POST',
      body: JSON.stringify({ sourcePath: path.resolve(src) }),
    });
    console.log(`\n  ${out.url}\n`);
  },

  async ls() {
    const apps = await api('/api/apps');
    if (!apps.length) return console.log('no apps yet — try: hoster deploy ./my-app');
    for (const a of apps) {
      const pub = a.tunnel_url ? `  public: ${a.tunnel_url}` : '';
      console.log(`${a.status.padEnd(8)} ${a.slug.padEnd(20)} ${a.local_url}${pub}`);
    }
  },

  async logs([slug]) {
    if (!slug) throw new Error('usage: hoster logs <slug>');
    console.log((await api(`/api/apps/${slug}/logs`)).logs);
  },

  async share([slug]) {
    if (!slug) throw new Error('usage: hoster share <slug>');
    console.log('opening tunnel...');
    const out = await api(`/api/apps/${slug}/public`, {
      method: 'POST', body: JSON.stringify({ enabled: true }),
    });
    console.log(`\n  ${out.url}\n  (works for anyone with internet)\n`);
  },

  async unshare([slug]) {
    await api(`/api/apps/${slug}/public`, {
      method: 'POST', body: JSON.stringify({ enabled: false }),
    });
    console.log('tunnel closed');
  },

  async stop([slug]) { await api(`/api/apps/${slug}/stop`, { method: 'POST' }); console.log('stopped'); },
  async start([slug]) { await api(`/api/apps/${slug}/start`, { method: 'POST' }); console.log('started'); },
  async rm([slug]) { await api(`/api/apps/${slug}`, { method: 'DELETE' }); console.log('removed'); },
};

const [cmd, ...args] = process.argv.slice(2);

if (!cmd || cmd === 'help' || !commands[cmd]) {
  console.log(`hoster — local hosting for front-end and back-end apps

  hoster deploy <path> [--name <slug>]   build and publish an app
  hoster ls                              list apps and their URLs
  hoster logs <slug>                     show app logs
  hoster share <slug>                    get a public internet URL
  hoster unshare <slug>                  close the public URL
  hoster stop|start <slug>               stop or start an app
  hoster rm <slug>                       remove app, container and database
`);
  process.exit(cmd && cmd !== 'help' ? 1 : 0);
}

commands[cmd](args).catch((err) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});
