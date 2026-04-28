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
- Expected: ~58 test files pass, ~645+ tests pass (count grows over time)
- Run specific test file: `npx vitest run tests/unit/your-test.test.ts`

## Testing Auth & Role-Based Access

### Dual Auth Systems
The app has two auth systems — be careful not to mix them:
- **HMAC password auth**: Admin panel login, token in `x-auth-token` header, validated by global `APP_PASSWORD` gate in `app.ts`
- **JWT user auth**: Multi-user accounts, token in `Authorization: Bearer` header or `token` cookie, validated by `requireAuth` middleware

Without `APP_PASSWORD` set, the global HMAC gate is inactive, so requests go straight to route-level middleware. This is ideal for testing `requireAuth` + `requireRole` behavior in isolation.

### Creating Test Users for JWT Auth Testing
```bash
# 1. Create owner user (first user via setup endpoint)
SETUP_RESP=$(curl -s -X POST http://localhost:3001/api/auth/setup \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@test.local","password":"testpassword123","name":"Test Owner"}')
OWNER_TOKEN=$(echo "$SETUP_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# 2. Create member user (requires owner JWT)
curl -s -X POST http://localhost:3001/api/users \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -d '{"email":"member@test.local","password":"testpassword123","name":"Test Member","role":"member"}'

# 3. Login as member to get member JWT
LOGIN_RESP=$(curl -s -X POST http://localhost:3001/api/auth/user-login \
  -H 'Content-Type: application/json' \
  -d '{"email":"member@test.local","password":"testpassword123"}')
MEMBER_TOKEN=$(echo "$LOGIN_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
```

### Testing Role-Gated Endpoints
For any endpoint with `requireAuth` + `requireRole('owner', 'admin')`:
```bash
# No auth → 401
curl -s -w "\nHTTP: %{http_code}" http://localhost:3001/api/admin/feature-flags

# Member JWT → 403
curl -s -w "\nHTTP: %{http_code}" -H "Authorization: Bearer $MEMBER_TOKEN" http://localhost:3001/api/admin/feature-flags

# Owner JWT → 200
curl -s -w "\nHTTP: %{http_code}" -H "Authorization: Bearer $OWNER_TOKEN" http://localhost:3001/api/admin/feature-flags
```

### Testing HMAC-Gated Endpoints (e.g. /api/ai-stats)
HMAC-gated endpoints check `x-auth-token` header or `auth_token` cookie. Without `APP_PASSWORD` set, you cannot generate a valid HMAC token. You can still verify:
- Endpoint responds (doesn't hang) — use `curl --max-time 5`
- Returns 403 with proper error JSON when no valid token provided
- If `APP_PASSWORD` is set, you'd need to authenticate via `POST /api/auth/login` with the password to get the HMAC token

## Testing Middleware Behavior
When testing Express middleware fixes (e.g., verifying a function is called correctly as middleware):
- Use `curl --max-time 5` to detect hanging requests (middleware that never calls `next()`)
- A response within the timeout (even 403/401) proves the middleware pipeline is working
- A timeout proves `next()` is never called — the exact symptom of broken middleware

## Testing Schema Module (D1-D5)

### Exported Pure Functions (can be unit tested directly)
- `server/site-architecture.ts`: `getParentNode()`, `getSiblingNodes()`, `getChildNodes()`, `getAncestorChain()`, `flattenTree()`
- `server/content-matrices.ts`: `getSchemaTypesForTemplate(pageType)` — returns combined primary+secondary schema types
- `server/schema-suggester.ts`: `PAGE_TYPE_SCHEMA_MAP` (exported constant with 16 page type entries)

### Private Functions (code inspection only)
- `injectCrossReferences()` in `schema-suggester.ts` — contains D3 hub page logic and D5 relationship enrichment. Not exported, so test via unit testing the building blocks + code reading.

### Testing Pattern for Schema Features
```bash
# Write tests in tests/unit/ using vitest
# Import functions directly:
import { getParentNode, getSiblingNodes, getChildNodes } from '../../server/site-architecture';
import { getSchemaTypesForTemplate } from '../../server/content-matrices';
import { PAGE_TYPE_SCHEMA_MAP } from '../../server/schema-suggester';

# Run specific test file:
npx vitest run tests/unit/your-test.test.ts
```

### API Keys Required for Full Schema Testing
- Schema generation (`generateSchemaForPage`, `generateSchemaSuggestions`) requires `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`
- Site architecture fetching requires `WEBFLOW_API_TOKEN`
- Without these, test pure functions and verify builds only

## Testing Schema Module (D4, D6, D7)

### D4 — Competitor Schema Intelligence
- **Exported:** `compareSchemas(ourTypes, competitorResult)` from `server/competitor-schema.ts` — pure function, no network needed
- **Exported:** `crawlCompetitorSchemas(domain, maxPages?)` — requires live network access to competitor domains
- **API endpoint:** `GET /api/competitor-schema/:workspaceId` — requires workspace with `competitorDomains` configured
- Rate limiting: max 2 concurrent fetches, 500ms between batches, 10s timeout
- Caching: 24h TTL, file-based in `competitor-schemas/` data dir

### D6 — E-E-A-T Enrichment
- **Exported:** `extractEeatFromBrief(brief)` from `server/schema-suggester.ts` — pure function
- Extracts: `authorName`, `authorTitle`, `expertiseTopics` from brief's `eeatGuidance` field
- **Known regex edge case:** Names with "Dr." prefix or period-delimited (e.g., "Author: John Doe. Covers...") may over-capture. Comma-delimited input works correctly (e.g., "Author: John Doe, covers...").
- Full E-E-A-T injection into AI prompt requires OpenAI/Anthropic API key

### D7 — Schema Pre-Generation
- **Exported:** `generateSchemaSkeleton(cell, template, siteUrl)` from `server/schema-queue.ts` — pure function, deterministic
- **Exported:** `queueSchemaPreGeneration(workspaceId, matrixId, cellId)` — async, triggers on cell status transition
- **Exported:** `listPendingSchemas(workspaceId)`, `markSchemaApplied(cellId)`, `markSchemaStale(cellId)`
- **API endpoint:** `GET /api/pending-schemas/:workspaceId`
- **Trigger:** PATCH cell status to `brief_generated` or `approved` via `PATCH /api/content-matrices/:wsId/:matrixId/cells/:cellId`
- **Stale marking:** PATCH cell with changed `targetKeyword` or `customKeyword`

### D7 Integration Test Pattern
The full D7 lifecycle can be tested end-to-end via API without any external keys:
```typescript
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { createTemplate } from '../../server/content-templates.js';

const ctx = createTestContext(13251);
await ctx.startServer();
const ws = createWorkspace('Test');
const tpl = createTemplate(ws.id, { name: 'Blog', pageType: 'blog' });

// Create matrix → PATCH cell to brief_generated → wait 500ms → GET /api/pending-schemas/:wsId
// Verify: pending schema with status 'pending', schemaTypes contains 'BlogPosting'
// PATCH cell with new keyword → verify schema marked 'stale'
// PATCH cell to 'approved' → verify new pending schema created
```
- `listPendingSchemas` returns transformed objects: `{ cellId, plannedUrl, schemaTypes, status, createdAt }` — NOT raw JSON
- Allow 500ms after PATCH for async pre-generation to complete

## Testing Backup Verification

The backup system runs automatically 30 seconds after server startup (`server/backup.ts`).

### Steps:
1. Start the server (`npm run dev:server`)
2. Wait ~35 seconds for the startup backup to trigger
3. Check server logs for `Backup verified` with `tableCount` and `totalRows`
4. Inspect the manifest:
```bash
cat ~/.asset-dashboard/backups/backup-*/_manifest.json
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

## Testing Graceful Shutdown
The graceful shutdown handler in `server/index.ts` should stop all background schedulers before closing the database. To verify:
1. Start the server: `PORT=3001 npx tsx server/index.ts`
2. Send SIGTERM: `kill -SIGTERM <pid>`
3. Check logs for "Shutdown signal received, draining..." and clean exit
4. No "cannot use database after close" errors should appear

To verify all schedulers are stopped, check `server/index.ts` for `stop*()` calls in the `gracefulShutdown` function. As of 2026-04, there should be 12 stop calls (matching all schedulers started in `server/startup.ts`).

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

## Devin Secrets Needed

No secrets required for basic backend testing. Optional for extended testing:
- `WEBFLOW_API_TOKEN` — Webflow-dependent features
- `OPENAI_API_KEY` — AI features
- `STRIPE_SECRET_KEY` — Payment flows
- `APP_PASSWORD` — Required to test HMAC auth flows (admin panel login, ai-stats with valid token)
