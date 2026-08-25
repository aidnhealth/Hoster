import { run, runOrThrow } from './exec.js';
import { POSTGRES, NETWORK } from './config.js';
import { containerExists, isRunning } from './docker.js';
import { postgresSuperPass, appDbPassword, forgetApp } from './secrets.js';

/** Bring up the shared Postgres instance that backs every app's database. */
export async function ensurePostgres() {
  // A running container is not necessarily an accepting one, so still wait.
  if (await isRunning(POSTGRES.container)) return waitReady();

  if (await containerExists(POSTGRES.container)) {
    await runOrThrow('docker', ['start', POSTGRES.container]);
  } else {
    await runOrThrow('docker', [
      'run', '-d',
      '--name', POSTGRES.container,
      '--network', NETWORK,
      '--restart', 'unless-stopped',
      '-e', `POSTGRES_USER=${POSTGRES.superUser}`,
      '-e', `POSTGRES_PASSWORD=${postgresSuperPass()}`,
      '-e', 'POSTGRES_DB=postgres',
      '-v', `${POSTGRES.volume}:/var/lib/postgresql/data`,
      '-p', `${POSTGRES.bindHost}:${POSTGRES.port}:5432`,
      POSTGRES.image,
    ]);
  }
  await waitReady();
}

async function waitReady(attempts = 60) {
  // The postgres entrypoint runs a temporary init server on a unix socket before
  // the real one starts, and pg_isready cannot tell them apart. Probing over TCP
  // with a real query only succeeds once the actual server is accepting traffic.
  for (let i = 0; i < attempts; i++) {
    const { code } = await run('docker', [
      'exec', POSTGRES.container,
      'psql', '-h', '127.0.0.1', '-U', POSTGRES.superUser, '-d', 'postgres', '-tAc', 'SELECT 1',
    ]);
    if (code === 0) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('postgres did not become ready in time');
}

const psql = (sql) => runOrThrow('docker', [
  'exec', POSTGRES.container,
  'psql', '-h', '127.0.0.1', '-U', POSTGRES.superUser, '-d', 'postgres', '-tAc', sql,
]);

/**
 * Give an app its own database and role. Idempotent, so redeploying an app
 * reuses the existing database rather than wiping it.
 */
export async function provisionDatabase(slug) {
  await ensurePostgres();
  const name = `app_${slug.replace(/[^a-z0-9_]/gi, '_').toLowerCase()}`;
  const pass = appDbPassword(slug);

  const { stdout } = await psql(`SELECT 1 FROM pg_roles WHERE rolname='${name}'`);
  if (stdout.trim() === '1') {
    // Re-assert the password so a role created before secrets were generated
    // is brought in line rather than left on a guessable one.
    await psql(`ALTER ROLE ${name} LOGIN PASSWORD '${pass}'`);
  } else {
    await psql(`CREATE ROLE ${name} LOGIN PASSWORD '${pass}'`);
  }

  const { stdout: dbOut } = await psql(`SELECT 1 FROM pg_database WHERE datname='${name}'`);
  if (dbOut.trim() !== '1') {
    await psql(`CREATE DATABASE ${name} OWNER ${name}`);
  }

  return {
    db_name: name,
    // Containers reach postgres over the shared docker network by container name.
    db_url: `postgresql://${name}:${pass}@${POSTGRES.container}:5432/${name}`,
  };
}

export async function dropDatabase(dbName, slug) {
  if (slug) forgetApp(slug);
  if (!dbName) return;
  await psql(`DROP DATABASE IF EXISTS ${dbName}`);
  await psql(`DROP ROLE IF EXISTS ${dbName}`);
}
