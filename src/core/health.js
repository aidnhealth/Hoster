import { run } from './exec.js';
import { ROOT_DOMAIN } from './config.js';
import { listApps, updateApp } from '../db/apps.js';

/**
 * Ask Caddy for the app exactly as a visitor would. This is the same path a
 * tunnel serves, so if this fails, sharing the app would publish a broken link.
 */
export async function probe(app, timeoutMs = 5000) {
  const url = `http://localhost/`;
  const { stdout } = await run('curl', [
    '-s', '-o', '/dev/null', '-w', '%{http_code}',
    '--max-time', String(Math.ceil(timeoutMs / 1000)),
    '-H', `Host: ${app.slug}.${ROOT_DOMAIN}`,
    url,
  ]);
  const code = Number(stdout.trim());
  return {
    code,
    ok: code >= 200 && code < 500 && code !== 0,
    reason: code === 0 ? 'no response'
      : code === 502 ? 'the app is not accepting connections'
      : code === 503 ? 'the app is unavailable'
      : `HTTP ${code}`,
  };
}

/** True container state, rather than what the last deploy happened to return. */
export async function containerState(slug) {
  const { stdout } = await run('docker', [
    'inspect', '-f', '{{.State.Status}}|{{.State.Restarting}}|{{.RestartCount}}', slug,
  ]);
  const [status, restarting, count] = stdout.trim().split('|');
  if (!status) return null;
  return {
    status,
    crashLooping: restarting === 'true' || Number(count) > 2,
    restarts: Number(count) || 0,
  };
}

/**
 * Reconcile stored status with reality. A deploy returning success only means
 * the container started, not that it stayed up — without this the dashboard
 * reports "live" for something that is crash-looping.
 */
export async function reconcile() {
  const changes = [];
  for (const app of listApps()) {
    if (app.kind !== 'container' || app.status === 'stopped') continue;
    const state = await containerState(app.slug);
    if (!state) continue;

    const next = state.crashLooping ? 'crashed'
      : state.status === 'running' ? 'live'
      : state.status === 'exited' ? 'crashed'
      : app.status;

    if (next !== app.status) {
      updateApp(app.slug, { status: next });
      changes.push({ slug: app.slug, from: app.status, to: next, restarts: state.restarts });
    }
  }
  return changes;
}
