# Testing Asset Dashboard Backend

## Overview
Asset Dashboard is a full-stack app (React + Express/TypeScript) with SQLite persistence. Backend runs on port 3001.

## Starting the Server Locally
```bash
cd ~/repos/asset-dashboard
echo "PORT=3001" > .env
npm run dev:server
```
- Server starts on `http://localhost:3001`
- Watch stdout for `[db] Applying migration: ...` lines to confirm SQLite migrations run
- No `APP_PASSWORD` env var needed in dev — auth middleware only activates when `APP_PASSWORD` is set
- No Stripe/Webflow/OpenAI keys needed for basic CRUD and infrastructure testing
- Clean data dir with `rm -rf ~/.asset-dashboard` before testing for a fresh start

## Running Tests
```bash
cd ~/repos/asset-dashboard && npx vitest run
```
- Pre-existing failure: `TabBar.test.tsx` or `users-api.test.ts` may fail — unrelated to backend changes
- Expected: ~37-38/38 test files pass, ~464-596 tests pass (count grows over time)

## Testing Backup Verification

The backup system runs automatically 30 seconds after server startup (`server/backup.ts`).

### Steps:
1. Start the server (`npm run dev:server`)
2. Wait ~35 seconds for the startup backup to trigger
3. Check server logs for `Backup verified` with `tableCount` and `totalRows`
4. Inspect the manifest:
```bash
cat ~/.asset-dashboard/backups/backup-*/\_manifest.json
```
5. Verify manifest contains:
   - `verified: true`
   - `tableCounts` object with table names and row counts
   - `_migrations` table should NOT appear (filtered by LIKE pattern)
   - `files` and `bytes` > 0
   - `dashboard.db` file exists in the backup directory

### Notes:
- On a fresh database, `totalRows` will be 0 but `tableCount` should be ~33 (all schema tables exist)
- S3 upload only runs if `BACKUP_S3_BUCKET` env var is set
- Backup interval is 24h but the first backup fires at startup + 30s

## Testing Job Persistence

Jobs are persisted to SQLite via write-through cache (`server/jobs.ts`). The `006-jobs.sql` migration creates the table.

### Creating Test Jobs:
The `sales-report` job type works without external API keys — it crawls a URL directly:
```bash
curl -X POST http://localhost:3001/api/jobs \
  -H "Content-Type: application/json" \
  -d '{"type": "sales-report", "params": {"url": "https://example.com"}}'
```

Other job types (`seo-audit`, `compress`, `bulk-alt`, `keyword-strategy`, `schema-generator`) require Webflow tokens or OpenAI keys and will reject before creating the job.

### Listing Jobs:
```bash
curl http://localhost:3001/api/jobs
```

### Testing Persistence Across Restart:
1. Create a job (sales-report works well)
2. Optionally insert fake running/pending jobs directly into SQLite:
```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database(process.env.HOME + '/.asset-dashboard/dashboard.db');
db.prepare(\"INSERT INTO jobs (id, type, status, message, created_at, updated_at) VALUES ('test-running', 'test', 'running', 'Test', datetime('now'), datetime('now'))\").run();
db.prepare(\"INSERT INTO jobs (id, type, status, message, created_at, updated_at) VALUES ('test-pending', 'test', 'pending', 'Test', datetime('now'), datetime('now'))\").run();
db.close();
"
```
3. Stop the server (Ctrl+C) — watch for graceful shutdown logs
4. Restart the server
5. Verify via `GET /api/jobs`:
   - Previously completed jobs retain `status: done`
   - Previously running/pending jobs now have `status: error` with `error: "Server restarted — job interrupted"`
   - New jobs can be created after restart

### Key Behavior:
- `loadJobsFromDb()` runs on startup: marks running/pending as interrupted, loads 200 most recent jobs into cache
- `markRunningJobsInterrupted()` runs during graceful shutdown (wrapped in try-catch)
- Write-through: all mutations write to SQLite first, then update in-memory Map
- `listJobs()` reads from cache only; `getJob()` falls back to SQLite for cache misses

## Testing Payment CRUD (SQLite)
Payments are accessed via:
- `GET /api/stripe/payments/:workspaceId` — list all payments for a workspace
- `GET /api/stripe/payments/:workspaceId/:paymentId` — get single payment
- These endpoints don't require auth in dev mode

To create test payments, use a Node.js script that imports directly:
```bash
node --import tsx -e "
import { createPayment, listPayments, getPayment } from './server/payments.js';
import { runMigrations } from './server/db/index.js';
runMigrations();
const payment = createPayment('test-ws', {
  workspaceId: 'test-ws',
  stripeSessionId: 'cs_test_123',
  productType: 'brief_blog',
  amount: 4900,
  currency: 'usd',
  status: 'paid',
});
console.log(payment);
"
```

## Verifying SQLite Database
`sqlite3` CLI may not be available on the VM. Use Node.js instead:
```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database(process.env.HOME + '/.asset-dashboard/dashboard.db');
console.log('Tables:', db.prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all());
console.log('Migrations:', db.prepare('SELECT * FROM _migrations').all());
console.log('Job count:', db.prepare('SELECT COUNT(*) as count FROM jobs').get());
db.close();
"
```

## Database Location
- Dev: `~/.asset-dashboard/dashboard.db` (DATA_BASE fallback in `server/db/index.ts`)
- Production: `/var/data/asset-dashboard/dashboard.db` (Render persistent disk)

## Key Architecture Notes
- Prepared statements are lazily initialized (not at import time) to avoid crashes in test environments
- Migration runner wraps each migration in a transaction for atomicity
- `runMigrations()` is called on server startup in `server/index.ts` before route mounting
- WAL mode enabled for concurrent read performance
- Graceful shutdown sequence: mark health 503 → mark jobs interrupted → close WebSocket → drain HTTP → flush data → close SQLite

## Devin Secrets Needed
None required for basic backend testing. The server runs without any API keys in development mode.
