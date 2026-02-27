import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { config } from '../config.js';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

const dbPath = `${config.dataDir}/hub.db`;
mkdirSync(dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
const db = drizzle(sqlite);
migrate(db, { migrationsFolder: './drizzle' });
sqlite.close();
console.log('Migration complete.');
