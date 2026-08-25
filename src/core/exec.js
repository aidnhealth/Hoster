import { spawn } from 'node:child_process';

/** Run a command, buffering output. Never throws on non-zero; returns the code. */
export function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; opts.onData?.(d.toString()); });
    child.stderr.on('data', (d) => { stderr += d; opts.onData?.(d.toString()); });
    child.on('error', (err) => resolve({ code: -1, stdout, stderr: String(err) }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** Same as run, but throws when the command fails. Use where failure is fatal. */
export async function runOrThrow(cmd, args, opts = {}) {
  const res = await run(cmd, args, opts);
  if (res.code !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed (${res.code})\n${res.stderr || res.stdout}`);
  }
  return res;
}
