/**
 * Vitest per-worker setup — disables SQLite foreign key enforcement during tests.
 *
 * Migration 019 added REFERENCES workspaces(id) ON DELETE CASCADE to 20+ tables
 * that previously had no FK constraint. Production enforces these, but unit/integration
 * tests insert rows with ad-hoc workspace IDs that don't exist in the workspaces table.
 * Disabling FK checks here restores the pre-019 test behavior.
 */
import db from '../server/db/index.js';

db.pragma('foreign_keys = OFF');
