import { run, runOrThrow } from './exec.js';
import { NETWORK } from './config.js';

export async function ensureNetwork() {
  const { stdout } = await run('docker', ['network', 'ls', '--format', '{{.Name}}']);
  if (!stdout.split('\n').includes(NETWORK)) {
    await runOrThrow('docker', ['network', 'create', NETWORK]);
  }
}

export async function containerExists(name) {
  const { stdout } = await run('docker', ['ps', '-a', '--format', '{{.Names}}']);
  return stdout.split('\n').includes(name);
}

export async function isRunning(name) {
  const { stdout } = await run('docker', ['ps', '--format', '{{.Names}}']);
  return stdout.split('\n').includes(name);
}

export async function removeContainer(name) {
  if (await containerExists(name)) {
    await run('docker', ['rm', '-f', name]);
  }
}

export async function logs(name, tail = 200) {
  const { stdout, stderr } = await run('docker', ['logs', '--tail', String(tail), name]);
  return stdout + stderr;
}
