import fs from 'node:fs';
import Database from 'better-sqlite3';
import { DB_PATH, DATA_DIR } from '../core/config.js';

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS apps (
    id          TEXT PRIMARY KEY,
    slug        TEXT NOT NULL UNIQUE,
    source_path TEXT NOT NULL,
    kind        TEXT,               -- static | container
    port        INTEGER UNIQUE,     -- host port, sticky once assigned
    status      TEXT NOT NULL DEFAULT 'created',
    public      INTEGER NOT NULL DEFAULT 0,  -- exposed via cloudflare tunnel
    db_name     TEXT,
    db_url      TEXT,
    env_json    TEXT NOT NULL DEFAULT '{}',
    tunnel_url  TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS deploys (
    id         TEXT PRIMARY KEY,
    app_id     TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    status     TEXT NOT NULL,       -- building | live | failed
    log        TEXT NOT NULL DEFAULT '',
    started_at INTEGER NOT NULL,
    ended_at   INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_deploys_app ON deploys(app_id, started_at DESC);
`);

/**
 * Added after the first release. Overrides let a project be deployed without
 * editing it — the settings live here rather than in the user's repository.
 */
const columns = db.prepare('PRAGMA table_info(apps)').all().map((c) => c.name);
const addColumn = (name, decl) => {
  if (!columns.includes(name)) db.exec(`ALTER TABLE apps ADD COLUMN ${name} ${decl}`);
};
addColumn('build_cmd', 'TEXT');     // replaces the detected build command
addColumn('out_dir', 'TEXT');       // replaces the detected output directory
addColumn('start_cmd', 'TEXT');     // replaces a container's start command
addColumn('kind_override', 'TEXT'); // force 'static' or 'container'
