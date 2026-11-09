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
db.exec(fs.readFileSync(schemaPath, 'utf8'));

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
