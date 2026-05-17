import db, { runMigrations } from '../server/db/index.js';

runMigrations();
db.pragma('wal_checkpoint(TRUNCATE)');
db.close();
