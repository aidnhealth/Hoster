import fs from 'node:fs';
import path from 'node:path';
import { run, runOrThrow } from './exec.js';
import { APPS_DIR, NETWORK, ROOT_DOMAIN } from './config.js';
import { detect } from '../builders/detect.js';
import { buildStaticIsolated } from '../builders/staging.js';
import { ensureNetwork, removeContainer } from './docker.js';
import { provisionDatabase } from './postgres.js';
import { ensureCaddy, reload } from '../routing/caddy.js';
import { serveStatic, stopStatic } from '../routing/lan.js';
import {
  createApp, getApp, updateApp, startDeploy, appendLog, finishDeploy,
} from '../db/apps.js';

const IMAGE = (slug) => `hoster/${slug}:latest`;

export async function deploy({ slug, sourcePath, withDatabase = true, onLog = () => {} }) {
  const source = path.resolve(sourcePath);
  if (!fs.existsSync(source)) throw new Error(`source path does not exist: ${source}`);

  let app = getApp(slug) ?? createApp({ slug, sourcePath: source });
  const deployId = startDeploy(app.id);

  const log = (msg) => {
    const line = msg.endsWith('\n') ? msg : msg + '\n';
    appendLog(deployId, line);
    onLog(line);
  };

  try {
    await ensureNetwork();

    const plan = detect(source);

    // Anything the user configured for this app wins over detection, so a
    // project can be deployed as-is even when its own scripts do not fit.
    if (app.kind_override) plan.kind = app.kind_override;
    if (app.out_dir) plan.outDir = app.out_dir;
    if (app.build_cmd) {
      plan.buildCmd = app.build_cmd;
      plan.strategy = plan.kind === 'static' ? 'static-build' : plan.strategy;
    }
    log(`detected: ${plan.label} (${plan.strategy})`);
    if (app.build_cmd) log(`build command overridden: ${app.build_cmd}`);

    let dbInfo = { db_name: app.db_name, db_url: app.db_url };
    if (withDatabase && plan.kind === 'container') {
      // Always run this, even when the app already recorded a database. It is
      // idempotent, and re-running is what brings the app back up if postgres
      // was reset underneath it or its stored password went stale.
      log('provisioning postgres database...');
      dbInfo = await provisionDatabase(slug);
      log(`database ready: ${dbInfo.db_name}`);
    }

    if (plan.kind === 'static') {
      await buildStatic({ app, source, plan, log });
      await serveStatic({ ...app, kind: 'static' });
      log(`serving on port ${app.port} for other devices on the network`);
    } else {
      await buildAndRunContainer({ app, source, plan, dbInfo, log });
    }

    app = updateApp(slug, {
      kind: plan.kind,
      status: 'live',
      source_path: source,
      db_name: dbInfo.db_name ?? null,
      db_url: dbInfo.db_url ?? null,
    });

    await ensureCaddy();
    await reload();

    finishDeploy(deployId, 'live');
    const scheme = ROOT_DOMAIN.endsWith('.localhost') ? 'http' : 'https';
    const url = `${scheme}://${slug}.${ROOT_DOMAIN}`;
    log(`live at ${url}`);
    return { app, url };
  } catch (err) {
    log(`FAILED: ${err.message}`);
    updateApp(slug, { status: 'failed' });
    finishDeploy(deployId, 'failed');
    throw err;
  }
}

/**
 * Publish a front-end build. The compile happens in a container against a
 * read-only mount, so nothing is ever written inside the user's project.
 */
async function buildStatic({ app, source, plan, log }) {
  const target = path.join(APPS_DIR, app.slug);
  const env = JSON.parse(app.env_json ?? '{}');

  if (plan.strategy === 'static-build') {
    await buildStaticIsolated({
      source,
      outDir: target,
      buildScript: plan.buildScript ?? 'build',
      buildCmd: plan.buildCmd,
      outSubdir: plan.outDir ?? 'dist',
      env,
      log,
    });
    return;
  }

  // A plain folder of HTML: copy it as-is, still without touching the original.
  const outDir = path.join(source, plan.outDir ?? '.');
  if (!fs.existsSync(outDir)) throw new Error(`${plan.outDir} does not exist`);
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(outDir, target, { recursive: true });
  log(`published static files -> ${target}`);
}

async function buildAndRunContainer({ app, source, plan, dbInfo, log }) {
  const image = IMAGE(app.slug);

  if (plan.strategy === 'dockerfile') {
    log('building image from Dockerfile...');
    await runOrThrow('docker', ['build', '-t', image, source], { onData: log });
  } else {
    log('building image with nixpacks...');
    await runOrThrow('nixpacks', ['build', source, '--name', image], { onData: log });
  }

  log('starting container...');
  await removeContainer(app.slug);

  const env = JSON.parse(app.env_json ?? '{}');
  const envArgs = Object.entries({
    PORT: String(app.port),
    NODE_ENV: 'production',
    ...(dbInfo.db_url ? { DATABASE_URL: dbInfo.db_url } : {}),
    ...env,
  }).flatMap(([k, v]) => ['-e', `${k}=${v}`]);

  await runOrThrow('docker', [
    'run', '-d',
    '--name', app.slug,
    '--network', NETWORK,
    '--restart', 'unless-stopped',
    // Caps so one runaway app can't take the whole machine down.
    '--memory', '1g',
    '--cpus', '1.5',
    // Published on 0.0.0.0 so phones and laptops on the same network can reach
    // the app by IP. Hostnames cannot do this job: *.localhost is loopback on
    // whichever device resolves it.
    '-p', `0.0.0.0:${app.port}:${app.port}`,
    // Lets a container reach services running on the host — a database or
    // broker the project already uses — at host.docker.internal.
    '--add-host', 'host.docker.internal:host-gateway',
    ...envArgs,
    image,
    // An override replaces the image's own CMD, so a project can be started
    // differently without editing its Dockerfile.
    ...(app.start_cmd ? app.start_cmd.split(' ').filter(Boolean) : []),
  ]);
}

export async function stopApp(slug) {
  const app = getApp(slug);
  if (!app) throw new Error(`no such app: ${slug}`);
  if (app.kind === 'container') await run('docker', ['stop', slug]);
  else stopStatic(slug);
  updateApp(slug, { status: 'stopped' });
  await reload();
}

export async function startApp(slug) {
  const app = getApp(slug);
  if (!app) throw new Error(`no such app: ${slug}`);
  if (app.kind === 'container') await runOrThrow('docker', ['start', slug]);
  else await serveStatic(app);
  updateApp(slug, { status: 'live' });
  await reload();
}
