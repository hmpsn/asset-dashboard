# Testing Asset Dashboard Backend

## Overview
Asset Dashboard is a full-stack app (React + Express/TypeScript) with JSON-on-disk persistence being migrated to SQLite. Backend runs on port 3001.

## Starting the Server Locally
```bash
cd ~/repos/asset-dashboard
node --import tsx server/index.ts
```
- Server starts on `http://localhost:3001`
- Watch stdout for `[db] Applying migration: ...` lines to confirm SQLite migrations run
- No `APP_PASSWORD` env var needed in dev — auth middleware only activates when `APP_PASSWORD` is set (see `server/index.ts:182`)
- No Stripe keys needed for basic CRUD testing

## Running Tests
```bash
cd ~/repos/asset-dashboard && npx vitest run
```
- Pre-existing failure: `TabBar.test.tsx` fails on `getAllByRole('button')` — unrelated to backend changes
- Expected: 37/38 test files pass, 464/465 tests pass

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
Note: `createPayment` requires Stripe integration for the checkout flow, so direct function calls are the easiest way to test CRUD.

## Verifying SQLite Database
`sqlite3` CLI may not be available. Use Node.js instead:
```bash
node --import tsx -e "
import Database from 'better-sqlite3';
const db = new Database('/home/ubuntu/.asset-dashboard/dashboard.db');
console.log('Tables:', db.prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all());
console.log('Migrations:', db.prepare('SELECT * FROM _migrations').all());
console.log('Payment count:', db.prepare('SELECT COUNT(*) as count FROM payments').get());
db.close();
"
```

## Testing JSON Migration Script
1. Create test JSON files at `~/.asset-dashboard/payments/{workspaceId}.json`
2. Run: `npx tsx server/db/migrate-json.ts`
3. Verify records via API or direct DB query
4. Run again to verify idempotency (INSERT OR IGNORE prevents duplicates)

## Database Location
- Dev: `~/.asset-dashboard/dashboard.db` (DATA_BASE fallback in `server/db/index.ts:12`)
- Production: `/var/data/asset-dashboard/dashboard.db` (Render persistent disk)

## Key Architecture Notes
- Prepared statements are lazily initialized (not at import time) to avoid crashes in test environments
- Migration runner wraps each migration in a transaction for atomicity
- `runMigrations()` is called on server startup in `server/index.ts` before route mounting
- WAL mode enabled for concurrent read performance

## Devin Secrets Needed
None required for basic backend testing. The server runs without any API keys in development mode.
