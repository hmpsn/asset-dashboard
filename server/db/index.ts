/**
 * SQLite database singleton and migration runner.
 *
 * Uses better-sqlite3 for synchronous, high-performance SQLite access.
 * The database file lives alongside existing JSON files on the persistent disk.
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DATA_BASE } from '../data-dir.js';
import { createLogger } from '../logger.js';

const log = createLogger('db');

const dbDir = DATA_BASE || path.join(process.env.HOME || '', '.asset-dashboard');
fs.mkdirSync(dbDir, { recursive: true });

const dbPath = path.join(dbDir, 'dashboard.db');

const db = new Database(dbPath);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
// Wait up to 5 seconds when the database is locked (avoids SQLITE_BUSY in parallel test workers)
db.pragma('busy_timeout = 5000');
// Enable foreign key enforcement
db.pragma('foreign_keys = ON');

/**
 * Migration filename aliases — idempotent rename bridge.
 *
 * When a migration file is renamed, the `_migrations` tracker (keyed by filename)
 * must be taught about the new name or the runner will try to re-apply the SQL on
 * existing databases. This map runs BEFORE the applied set is loaded, so the new
 * filename is seen as already-applied by the main loop.
 *
 * Pattern: append entries here as `[oldName, newName]`. Never remove old entries.
 *
 * History:
 *   2026-04 — 048 triple-prefix cleanup
 *     048-meeting-briefs.sql                → 054-meeting-briefs.sql
 *     048-site-intelligence-client-view.sql → 055-site-intelligence-client-view.sql
 */
const MIGRATION_RENAMES: Array<[oldName: string, newName: string]> = [
  ['048-meeting-briefs.sql', '054-meeting-briefs.sql'],
  ['048-site-intelligence-client-view.sql', '055-site-intelligence-client-view.sql'],
];

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
    path.dirname(fileURLToPath(import.meta.url)),
    'migrations',
  );

  if (!fs.existsSync(migrationsDir)) {
    log.info('No migrations directory found — skipping.');
    return;
  }

  // Apply filename aliases BEFORE loading the applied set — this is the ONLY
  // place the rename bridge can run, because the main loop compares candidate
  // filenames against a snapshot of the applied set taken on the next line.
  const aliasInsert = db.prepare(
    `INSERT OR IGNORE INTO _migrations (name, applied_at)
     SELECT ?, applied_at FROM _migrations WHERE name = ?`,
  );
  for (const [oldName, newName] of MIGRATION_RENAMES) {
    aliasInsert.run(newName, oldName);
  }

  const applied = new Set(
    (db.prepare('SELECT name FROM _migrations').all() as Array<{ name: string }>).map(r => r.name),
  );

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort(); // lexicographic order ensures 001 < 002 < ...

  const insert = db.prepare('INSERT OR IGNORE INTO _migrations (name, applied_at) VALUES (?, ?)');

  const applyMigration = db.transaction((file: string) => {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    log.info(`Applying migration: ${file}`);
    // For migrations containing ALTER TABLE ADD COLUMN or RENAME COLUMN,
    // execute each statement individually so idempotency errors don't abort
    // the entire migration:
    //   ADD COLUMN  → "duplicate column name" if column already exists
    //   RENAME COLUMN → "no such column" if column was already renamed
    const needsPerStatement =
      /ALTER\s+TABLE\s+\S+\s+ADD\s+COLUMN/i.test(sql) ||
      /ALTER\s+TABLE\s+\S+\s+RENAME\s+COLUMN/i.test(sql);
    if (needsPerStatement) {
      // Strip comment lines, then split on semicolons
      const stripped = sql.replace(/^--.*$/gm, '');
      const statements = stripped
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0);
      for (const stmt of statements) {
        try {
          db.exec(stmt);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : '';
          if (msg.includes('duplicate column name')) {
            log.info(`Skipping (column already exists): ${stmt.slice(0, 60)}…`);
          } else if (msg.includes('no such column')) {
            // RENAME COLUMN: target column doesn't exist — already renamed on this DB
            log.info(`Skipping (column already renamed or absent): ${stmt.slice(0, 60)}…`);
          } else {
            throw err;
          }
        }
      }
    } else {
      db.exec(sql);
    }
    insert.run(file, new Date().toISOString());
  });

  for (const file of files) {
    if (applied.has(file)) continue;
    // Temporarily disable FK checks so migrations that recreate tables with
    // new FK constraints can copy existing data (which may include orphaned
    // workspace_id refs). PRAGMA foreign_keys must be set OUTSIDE transactions.
    db.pragma('foreign_keys = OFF');
    applyMigration(file);
    db.pragma('foreign_keys = ON');
  }
}

export default db;
