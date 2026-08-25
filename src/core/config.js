import os from 'node:os';
import path from 'node:path';

export const HOME = path.join(os.homedir(), '.hoster');
export const DATA_DIR = path.join(HOME, 'data');
export const APPS_DIR = path.join(HOME, 'apps');
export const LOGS_DIR = path.join(HOME, 'logs');
export const CADDY_DIR = path.join(HOME, 'caddy');

export const DB_PATH = path.join(DATA_DIR, 'hoster.db');

// Control plane. 7000 is free; 9092 is taken by an existing redpanda container.
export const CONTROL_PORT = Number(process.env.HOSTER_PORT ?? 7010);

// Apps get ports from this range, assigned on first deploy and then sticky.
export const APP_PORT_MIN = 7100;
export const APP_PORT_MAX = 7999;

// Every app is reachable at <slug>.<ROOT_DOMAIN> on the LAN.
export const ROOT_DOMAIN = process.env.HOSTER_DOMAIN ?? 'hoster.local';

export const POSTGRES = {
  container: 'hoster-postgres',
  image: 'postgres:16-alpine',
  // Bound to loopback, not 0.0.0.0: the database is for apps on the docker
  // network and for you at a psql prompt, never for the rest of the LAN.
  bindHost: '127.0.0.1',
  port: 7432,
  superUser: 'hoster',
  volume: 'hoster-pgdata',
};

export const CADDY_CONTAINER = 'hoster-caddy';
export const CADDY_IMAGE = 'caddy:2-alpine';
export const NETWORK = 'hoster-net';
