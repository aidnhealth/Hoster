import fs from 'node:fs';
import path from 'node:path';
import { runOrThrow } from '../core/exec.js';

/** Directories never worth copying into a build, and never safe to overwrite. */
const EXCLUDES = ['node_modules', '.git', 'dist', 'build', '.next', '.venv', '__pycache__'];

/**
 * The Node version a project expects, from .nvmrc or package.json engines.
 * Building on the wrong major is a common and confusing failure.
 */
export function nodeVersionFor(source) {
  const nvmrc = path.join(source, '.nvmrc');
  if (fs.existsSync(nvmrc)) {
    const v = fs.readFileSync(nvmrc, 'utf8').trim().replace(/^v/, '').split('.')[0];
    if (/^\d+$/.test(v)) return v;
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
    const range = pkg.engines?.node;
    const m = range && range.match(/(\d+)/);
    if (m) return m[1];
  } catch { /* no package.json, or unparseable */ }
  return '22';
}

/**
 * Build a front-end project WITHOUT touching its directory.
 *
 * The source is mounted read-only and copied into a scratch layer inside the
 * container, so npm install, the build, and any generated dist all happen on a
 * throwaway copy. The user's node_modules, dist and git state are never written
 * to — which matters because Hoster is usually pointed at a working checkout
 * someone is actively developing in.
 */
export async function buildStaticIsolated({ source, outDir, buildScript, buildCmd, outSubdir, env = {}, log }) {
  const nodeVersion = nodeVersionFor(source);
  log(`building in a node:${nodeVersion} container (your source is mounted read-only)`);

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const excludeArgs = EXCLUDES.map((e) => `--exclude=./${e}`).join(' ');
  const envExports = Object.entries(env)
    .map(([k, v]) => `export ${k}=${JSON.stringify(String(v))}`)
    .join('\n');

  const script = `
set -e
mkdir -p /build
tar -C /src ${excludeArgs} -cf - . | tar -C /build -xf -
cd /build
${envExports}
if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
${buildCmd ? buildCmd : `npm run ${buildScript}`}
if [ ! -d "/build/${outSubdir}" ]; then
  echo "BUILD_OUTPUT_MISSING: expected /build/${outSubdir}" >&2
  echo "what the build actually produced:" >&2
  ls -1 /build >&2
  exit 2
fi
cp -R "/build/${outSubdir}/." /out/
`;

  await runOrThrow('docker', [
    'run', '--rm',
    '-v', `${source}:/src:ro`,
    '-v', `${outDir}:/out`,
    '-w', '/build',
    `node:${nodeVersion}-alpine`,
    'sh', '-c', script,
  ], { onData: log });

  const produced = fs.readdirSync(outDir);
  if (!produced.length) throw new Error('build produced no files');
  log(`build finished: ${produced.length} entries published`);
}
