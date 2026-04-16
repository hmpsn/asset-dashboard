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
 *   2026-04 — 035/036/037 collision fix (two files shared same numeric prefix)
 *     035-schema-validations.sql  → 061-schema-validations.sql
 *     036-llms-txt-cache.sql      → 062-llms-txt-cache.sql
 *     037-llms-txt-freshness.sql  → 063-llms-txt-freshness.sql
 */
const MIGRATION_RENAMES: Array<[oldName: string, newName: string]> = [
  ['048-meeting-briefs.sql', '054-meeting-briefs.sql'],
  ['048-site-intelligence-client-view.sql', '055-site-intelligence-client-view.sql'],
  ['035-schema-validations.sql', '061-schema-validations.sql'],
  ['036-llms-txt-cache.sql', '062-llms-txt-cache.sql'],
  ['037-llms-txt-freshness.sql', '063-llms-txt-freshness.sql'],
];

/**
 * Run all pending SQL migrations from server/db/migrations/.
 * Tracks applied migrations in a `_migrations` table.
 *
 * Concurrency safety: the entire check + apply loop runs inside a single
 * IMMEDIATE transaction, serialising concurrent server starts against the same
 * database file (common in the test suite where multiple servers share
 * ~/.asset-dashboard/dashboard.db). Only one process holds the write lock at a
 * time; others block (up to busy_timeout = 5 s), then see all migrations
 * already applied and exit immediately. This prevents the TOCTOU window where
 * two processes both read the applied set, both see the same migration as
 * pending, and race to apply it.
 *
 * Note: PRAGMA foreign_keys cannot be used inside a transaction (SQLite
 * restriction). We disable it before entering the IMMEDIATE transaction and
 * restore it in a finally block.
 */
export function runMigrations(): void {
  // Create the migrations tracking table if it doesn't exist.
  // Safe to run outside the main transaction: CREATE TABLE IF NOT EXISTS is
  // idempotent and concurrent executions do not conflict.
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

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort(); // lexicographic order ensures 001 < 002 < ...

  // Prepare statements outside the transaction to avoid re-preparing on
  // every call and to satisfy better-sqlite3's statement caching expectations.
  const aliasInsert = db.prepare(
    `INSERT OR IGNORE INTO _migrations (name, applied_at)
     SELECT ?, applied_at FROM _migrations WHERE name = ?`,
  );
  const selectApplied = db.prepare('SELECT name FROM _migrations');
  const insert = db.prepare('INSERT OR IGNORE INTO _migrations (name, applied_at) VALUES (?, ?)');

  // PRAGMA foreign_keys cannot be set inside a transaction.
  // Disable FK enforcement before acquiring the write lock; restore it after.
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      // Apply filename aliases BEFORE loading the applied set — this is the ONLY
      // place the rename bridge can run, because the main loop compares candidate
      // filenames against a snapshot of the applied set taken on the next line.
      for (const [oldName, newName] of MIGRATION_RENAMES) {
        aliasInsert.run(newName, oldName);
      }

      const applied = new Set(
        (selectApplied.all() as Array<{ name: string }>).map(r => r.name),
      );

      for (const file of files) {
        if (applied.has(file)) continue;

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
      }
    }).immediate();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

export default db;
