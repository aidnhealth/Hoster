import fs from 'node:fs';
import { createServer } from './api/server.js';
import { CONTROL_PORT, HOME, APPS_DIR, LOGS_DIR, ROOT_DOMAIN } from './core/config.js';
import { ensureNetwork } from './core/docker.js';
import { ensureCaddy } from './routing/caddy.js';
import { clearStaleTunnels } from './routing/tunnel.js';
import { restoreStatic, lanAddress } from './routing/lan.js';
import { reconcile } from './core/health.js';

for (const dir of [HOME, APPS_DIR, LOGS_DIR]) fs.mkdirSync(dir, { recursive: true });

const stale = await clearStaleTunnels();
if (stale) console.log(`cleared ${stale} stale tunnel(s) from the last run`);

await ensureNetwork();
await ensureCaddy().catch((e) => console.error('caddy not started:', e.message));

const restored = await restoreStatic();
if (restored) console.log(`restored ${restored} static app(s)`);

const drift = await reconcile();
for (const c of drift) {
  console.log(`${c.slug}: ${c.from} -> ${c.to}${c.restarts ? ` (${c.restarts} restarts)` : ''}`);
}

createServer().listen(CONTROL_PORT, '0.0.0.0', () => {
  console.log(`hoster control plane -> http://localhost:${CONTROL_PORT}`);
  const ip = lanAddress();
  if (ip) console.log(`on your network       -> http://${ip}:<app port>`);
});
