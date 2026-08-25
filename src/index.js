import fs from 'node:fs';
import { createServer } from './api/server.js';
import { CONTROL_PORT, HOME, APPS_DIR, LOGS_DIR, ROOT_DOMAIN } from './core/config.js';
import { ensureNetwork } from './core/docker.js';
import { ensureCaddy } from './routing/caddy.js';

for (const dir of [HOME, APPS_DIR, LOGS_DIR]) fs.mkdirSync(dir, { recursive: true });

await ensureNetwork();
await ensureCaddy().catch((e) => console.error('caddy not started:', e.message));

createServer().listen(CONTROL_PORT, () => {
  console.log(`hoster control plane -> http://localhost:${CONTROL_PORT}`);
  console.log(`dashboard            -> https://${ROOT_DOMAIN}`);
});
