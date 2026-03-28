/**
 * sync-staging-db.ts — Copy production database to staging
 *
 * Downloads the live SQLite database from production and uploads it to staging.
 * Staging restarts automatically after import to open the new database fresh.
 *
 * Usage:
 *   npm run db:sync-staging
 *
 * Requires APP_PASSWORD to be set (or pass via --password flag):
 *   APP_PASSWORD=yourpassword npm run db:sync-staging
 */

const PROD_URL = process.env.PROD_URL || 'https://insights.hmpsn.studio';
const STAGING_URL = process.env.STAGING_URL || 'https://asset-dashboard-staging.onrender.com';
const PASSWORD = process.env.APP_PASSWORD || process.argv.find(a => a.startsWith('--password='))?.split('=')[1];

if (!PASSWORD) {
  console.error('\n  Error: APP_PASSWORD is required.\n');
  console.error('  Usage: APP_PASSWORD=yourpassword npm run db:sync-staging\n');
  process.exit(1);
}

const AUTH_HEADERS = {
  'x-auth-token': PASSWORD,
};

async function run() {
  console.log('\n📦 Syncing production database to staging...\n');

  // ── Step 1: Download from production ────────────────────────────────────────
  console.log(`  → Exporting from ${PROD_URL}...`);
  const exportRes = await fetch(`${PROD_URL}/api/admin/db-export`, {
    headers: AUTH_HEADERS,
  });

  if (!exportRes.ok) {
    const text = await exportRes.text();
    console.error(`  ✗ Export failed (${exportRes.status}): ${text}`);
    process.exit(1);
  }

  const dbBuffer = Buffer.from(await exportRes.arrayBuffer());
  const sizeKb = Math.round(dbBuffer.length / 1024);
  console.log(`  ✓ Downloaded ${sizeKb} KB`);

  // ── Step 2: Upload to staging ────────────────────────────────────────────────
  console.log(`  → Importing to ${STAGING_URL}...`);
  const importRes = await fetch(`${STAGING_URL}/api/admin/db-import`, {
    method: 'POST',
    headers: {
      ...AUTH_HEADERS,
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(dbBuffer.length),
    },
    body: dbBuffer,
  });

  if (!importRes.ok) {
    const text = await importRes.text();
    console.error(`  ✗ Import failed (${importRes.status}): ${text}`);
    process.exit(1);
  }

  const result = await importRes.json() as { ok: boolean; bytes: number; message: string };
  console.log(`  ✓ ${result.message}`);
  console.log('\n  Staging will restart in ~30 seconds with the production database.\n');
}

run().catch(err => {
  console.error('  ✗ Unexpected error:', err.message);
  process.exit(1);
});
