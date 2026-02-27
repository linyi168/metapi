import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { config } from '../config.js';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

const dbPath = `${config.dataDir}/hub.db`;
mkdirSync(dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

function tableColumnExists(table: string, column: string): boolean {
  const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>;
  return rows.some((row) => row.name === column);
}

function ensureTokenManagementSchema() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS account_tokens (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      account_id integer NOT NULL,
      name text NOT NULL,
      token text NOT NULL,
      source text DEFAULT 'manual',
      enabled integer DEFAULT true,
      is_default integer DEFAULT false,
      created_at text DEFAULT (datetime('now')),
      updated_at text DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE cascade
    );
  `);

  if (!tableColumnExists('route_channels', 'token_id')) {
    sqlite.exec('ALTER TABLE route_channels ADD COLUMN token_id integer;');
  }

  sqlite.exec(`
    INSERT INTO account_tokens (account_id, name, token, source, enabled, is_default, created_at, updated_at)
    SELECT
      a.id,
      'default',
      a.api_token,
      'legacy',
      true,
      true,
      datetime('now'),
      datetime('now')
    FROM accounts AS a
    WHERE
      a.api_token IS NOT NULL
      AND trim(a.api_token) <> ''
      AND NOT EXISTS (
        SELECT 1 FROM account_tokens AS t
        WHERE t.account_id = a.id
        AND t.token = a.api_token
      );
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS token_model_availability (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      token_id integer NOT NULL,
      model_name text NOT NULL,
      available integer,
      latency_ms integer,
      checked_at text DEFAULT (datetime('now')),
      FOREIGN KEY (token_id) REFERENCES account_tokens(id) ON DELETE cascade
    );
  `);

  sqlite.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS token_model_availability_token_model_unique
    ON token_model_availability(token_id, model_name);
  `);
}

function ensureSiteStatusSchema() {
  if (!tableColumnExists('sites', 'status')) {
    sqlite.exec(`ALTER TABLE sites ADD COLUMN status text DEFAULT 'active';`);
  }

  sqlite.exec(`
    UPDATE sites
    SET status = lower(trim(status))
    WHERE status IS NOT NULL
      AND lower(trim(status)) IN ('active', 'disabled')
      AND status != lower(trim(status));
  `);

  sqlite.exec(`
    UPDATE sites
    SET status = 'active'
    WHERE status IS NULL
      OR trim(status) = ''
      OR lower(trim(status)) NOT IN ('active', 'disabled');
  `);
}

ensureTokenManagementSchema();
ensureSiteStatusSchema();

export const db = drizzle(sqlite, { schema });
export { schema };
