/**
 * One-time data migration script: reads existing JSON payment files and
 * inserts them into the SQLite payments table.
 *
 * Idempotent — uses INSERT OR IGNORE so re-running is safe.
 *
 * Usage: npx tsx server/db/migrate-json.ts
 */
import fs from 'fs';
import path from 'path';
import { getDataDir } from '../data-dir.js';
import db, { runMigrations } from './index.js';

// Ensure schema is up to date before migrating data
runMigrations();

interface JsonPaymentRecord {
  id: string;
  workspaceId: string;
  stripeSessionId: string;
  stripePaymentIntentId?: string;
  productType: string;
  amount: number;
  currency: string;
  status: string;
  contentRequestId?: string;
  metadata?: Record<string, string>;
  createdAt: string;
  paidAt?: string;
}

function migratePayments(): number {
  const paymentsDir = getDataDir('payments');
  if (!fs.existsSync(paymentsDir)) {
    console.log('[migrate] No payments directory found — skipping.');
    return 0;
  }

  const files = fs.readdirSync(paymentsDir).filter(f => f.endsWith('.json'));
  if (files.length === 0) {
    console.log('[migrate] No payment JSON files found.');
    return 0;
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO payments
      (id, workspace_id, stripe_session_id, stripe_payment_intent_id,
       product_type, amount, currency, status, content_request_id,
       metadata, created_at, paid_at)
    VALUES
      (@id, @workspace_id, @stripe_session_id, @stripe_payment_intent_id,
       @product_type, @amount, @currency, @status, @content_request_id,
       @metadata, @created_at, @paid_at)
  `);

  let total = 0;

  const insertAll = db.transaction(() => {
    for (const file of files) {
      const workspaceId = path.basename(file, '.json');
      const filePath = path.join(paymentsDir, file);
      let records: JsonPaymentRecord[];
      try {
        records = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      } catch (err) {
        console.warn(`[migrate] Failed to parse ${filePath}:`, err);
        continue;
      }

      if (!Array.isArray(records)) {
        console.warn(`[migrate] ${filePath} is not an array — skipping.`);
        continue;
      }

      for (const r of records) {
        const info = insert.run({
          id: r.id,
          workspace_id: r.workspaceId || workspaceId,
          stripe_session_id: r.stripeSessionId,
          stripe_payment_intent_id: r.stripePaymentIntentId ?? null,
          product_type: r.productType,
          amount: r.amount,
          currency: r.currency,
          status: r.status,
          content_request_id: r.contentRequestId ?? null,
          metadata: r.metadata ? JSON.stringify(r.metadata) : null,
          created_at: r.createdAt,
          paid_at: r.paidAt ?? null,
        });
        total += info.changes;
      }
      console.log(`[migrate] ${file}: ${records.length} payment record(s)`);
    }
  });

  insertAll();

  return total;
}

// --- Run ---
console.log('[migrate] Starting JSON → SQLite data migration...');
const count = migratePayments();
console.log(`[migrate] Done. Inserted ${count} payment record(s).`);
