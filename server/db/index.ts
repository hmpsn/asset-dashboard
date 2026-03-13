/**
 * SQLite database singleton and migration runner.
 *
 * Uses better-sqlite3 for synchronous, high-performance SQLite access.
 * The database file lives alongside existing JSON files on the persistent disk.
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { DATA_BASE } from '../data-dir.js';

const dbDir = DATA_BASE || path.join(process.env.HOME || '', '.asset-dashboard');
fs.mkdirSync(dbDir, { recursive: true });

const dbPath = path.join(dbDir, 'dashboard.db');

const db = new Database(dbPath);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
// Enable foreign key enforcement
db.pragma('foreign_keys = ON');

/**
 * Run all pending SQL migrations from server/db/migrations/.
 * Tracks applied migrations in a `_migrations` table.
 */
export function runMigrations(): void {
  // Create the migrations tracking table if it doesn't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const migrationsDir = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    'migrations',
  );

  if (!fs.existsSync(migrationsDir)) {
    console.log('[db] No migrations directory found — skipping.');
    return;
  }

  const applied = new Set(
    (db.prepare('SELECT name FROM _migrations').all() as Array<{ name: string }>).map(r => r.name),
  );

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort(); // lexicographic order ensures 001 < 002 < ...

  const insert = db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)');

  const applyMigration = db.transaction((file: string) => {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    console.log(`[db] Applying migration: ${file}`);
    db.exec(sql);
    insert.run(file, new Date().toISOString());
  });

  for (const file of files) {
    if (applied.has(file)) continue;
    applyMigration(file);
  }
}

export default db;
