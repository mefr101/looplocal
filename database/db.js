// Database access. Uses Node's built-in SQLite driver (no native modules to compile).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

// Bump this whenever schema.sql changes in a way that needs a fresh database.
// (There is no migration tool: during development, `npm run reset` rebuilds everything.)
export const SCHEMA_VERSION = 3;

const schemaSql = () => fs.readFileSync(schemaPath, 'utf8');
const currentVersion = () => db.prepare('PRAGMA user_version').get().user_version;

/**
 * Create the tables if they don't exist yet. If the database was built from an
 * older schema, stop with a clear message instead of failing later with a
 * confusing "no such column" error.
 */
export function ensureSchema() {
  const hasTables = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'organizations'").get();
  if (hasTables && currentVersion() !== SCHEMA_VERSION) {
    throw new Error(
      'The database was created by an older version of LoopLocal. ' +
      'Run `npm run reset` to rebuild it with demo data (this deletes existing data).');
  }
  db.exec(schemaSql());
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

/** Delete every table and rebuild from schema.sql. Used by `npm run reset`. */
export function resetSchema() {
  db.exec('PRAGMA foreign_keys = OFF;');
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  for (const { name } of tables) db.exec(`DROP TABLE IF EXISTS "${name}"`);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(schemaSql());
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

/**
 * Run `work` inside a write transaction. BEGIN IMMEDIATE takes the write lock
 * up front, so two concurrent reservations cannot both read the same stock
 * and then both write. If `work` throws, everything is rolled back.
 */
export function withTransaction(work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work(db);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
