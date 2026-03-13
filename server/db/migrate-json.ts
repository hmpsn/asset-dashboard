/**
 * One-time data migration script: reads existing JSON files and
 * inserts them into the corresponding SQLite tables.
 *
 * Idempotent — uses INSERT OR IGNORE so re-running is safe.
 *
 * Usage: npx tsx server/db/migrate-json.ts
 */
import fs from 'fs';
import path from 'path';
import { getDataDir, getUploadRoot } from '../data-dir.js';
import db, { runMigrations } from './index.js';

// Ensure schema is up to date before migrating data
runMigrations();

// ── Payments ──

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

// ── Users (internal admin) ──

function migrateUsers(): number {
  const usersFile = path.join(getDataDir('auth'), 'users.json');
  if (!fs.existsSync(usersFile)) {
    console.log('[migrate] No users.json found — skipping.');
    return 0;
  }

  let records: Array<{
    id: string; email: string; name: string; passwordHash: string;
    role: string; workspaceIds?: string[]; avatarUrl?: string;
    lastLoginAt?: string; createdAt: string; updatedAt: string;
  }>;
  try {
    records = JSON.parse(fs.readFileSync(usersFile, 'utf-8'));
  } catch (err) {
    console.warn('[migrate] Failed to parse users.json:', err);
    return 0;
  }
  if (!Array.isArray(records)) return 0;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO users
      (id, email, name, password_hash, role, workspace_ids,
       avatar_url, last_login_at, created_at, updated_at)
    VALUES
      (@id, @email, @name, @password_hash, @role, @workspace_ids,
       @avatar_url, @last_login_at, @created_at, @updated_at)
  `);

  let total = 0;
  const insertAll = db.transaction(() => {
    for (const r of records) {
      const info = insert.run({
        id: r.id,
        email: r.email,
        name: r.name,
        password_hash: r.passwordHash,
        role: r.role || 'member',
        workspace_ids: JSON.stringify(r.workspaceIds || []),
        avatar_url: r.avatarUrl ?? null,
        last_login_at: r.lastLoginAt ?? null,
        created_at: r.createdAt,
        updated_at: r.updatedAt,
      });
      total += info.changes;
    }
  });
  insertAll();
  console.log(`[migrate] users.json: ${records.length} user(s), inserted ${total}`);
  return total;
}

// ── Client Users ──

function migrateClientUsers(): number {
  const clientUsersFile = path.join(getDataDir('auth'), 'client-users.json');
  if (!fs.existsSync(clientUsersFile)) {
    console.log('[migrate] No client-users.json found — skipping.');
    return 0;
  }

  let records: Array<{
    id: string; email: string; name: string; passwordHash: string;
    role: string; workspaceId: string; avatarUrl?: string;
    invitedBy?: string; lastLoginAt?: string;
    createdAt: string; updatedAt: string;
  }>;
  try {
    records = JSON.parse(fs.readFileSync(clientUsersFile, 'utf-8'));
  } catch (err) {
    console.warn('[migrate] Failed to parse client-users.json:', err);
    return 0;
  }
  if (!Array.isArray(records)) return 0;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO client_users
      (id, email, name, password_hash, role, workspace_id,
       avatar_url, invited_by, last_login_at, created_at, updated_at)
    VALUES
      (@id, @email, @name, @password_hash, @role, @workspace_id,
       @avatar_url, @invited_by, @last_login_at, @created_at, @updated_at)
  `);

  let total = 0;
  const insertAll = db.transaction(() => {
    for (const r of records) {
      const info = insert.run({
        id: r.id,
        email: r.email,
        name: r.name,
        password_hash: r.passwordHash,
        role: r.role || 'client_member',
        workspace_id: r.workspaceId,
        avatar_url: r.avatarUrl ?? null,
        invited_by: r.invitedBy ?? null,
        last_login_at: r.lastLoginAt ?? null,
        created_at: r.createdAt,
        updated_at: r.updatedAt,
      });
      total += info.changes;
    }
  });
  insertAll();
  console.log(`[migrate] client-users.json: ${records.length} client user(s), inserted ${total}`);
  return total;
}

// ── Reset Tokens ──

function migrateResetTokens(): number {
  const tokensFile = path.join(getDataDir('auth'), 'reset-tokens.json');
  if (!fs.existsSync(tokensFile)) {
    console.log('[migrate] No reset-tokens.json found — skipping.');
    return 0;
  }

  let records: Array<{
    token: string; userId: string; workspaceId: string;
    email: string; expiresAt: number;
  }>;
  try {
    records = JSON.parse(fs.readFileSync(tokensFile, 'utf-8'));
  } catch (err) {
    console.warn('[migrate] Failed to parse reset-tokens.json:', err);
    return 0;
  }
  if (!Array.isArray(records)) return 0;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO reset_tokens (token, user_id, workspace_id, email, expires_at)
    VALUES (@token, @user_id, @workspace_id, @email, @expires_at)
  `);

  let total = 0;
  const insertAll = db.transaction(() => {
    for (const r of records) {
      const info = insert.run({
        token: r.token,
        user_id: r.userId,
        workspace_id: r.workspaceId,
        email: r.email,
        expires_at: r.expiresAt,
      });
      total += info.changes;
    }
  });
  insertAll();
  console.log(`[migrate] reset-tokens.json: ${records.length} token(s), inserted ${total}`);
  return total;
}

// ── Activity Log ──

function migrateActivityLog(): number {
  const logFile = path.join(getUploadRoot(), '.activity-log.json');
  if (!fs.existsSync(logFile)) {
    console.log('[migrate] No .activity-log.json found — skipping.');
    return 0;
  }

  let records: Array<{
    id: string; workspaceId: string; type: string; title: string;
    description?: string; metadata?: Record<string, unknown>;
    actorId?: string; actorName?: string; createdAt: string;
  }>;
  try {
    records = JSON.parse(fs.readFileSync(logFile, 'utf-8'));
  } catch (err) {
    console.warn('[migrate] Failed to parse .activity-log.json:', err);
    return 0;
  }
  if (!Array.isArray(records)) return 0;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO activity_log
      (id, workspace_id, type, title, description, metadata,
       actor_id, actor_name, created_at)
    VALUES
      (@id, @workspace_id, @type, @title, @description, @metadata,
       @actor_id, @actor_name, @created_at)
  `);

  let total = 0;
  const insertAll = db.transaction(() => {
    for (const r of records) {
      const info = insert.run({
        id: r.id,
        workspace_id: r.workspaceId,
        type: r.type,
        title: r.title,
        description: r.description ?? null,
        metadata: r.metadata ? JSON.stringify(r.metadata) : null,
        actor_id: r.actorId ?? null,
        actor_name: r.actorName ?? null,
        created_at: r.createdAt,
      });
      total += info.changes;
    }
  });
  insertAll();
  console.log(`[migrate] .activity-log.json: ${records.length} entries, inserted ${total}`);
  return total;
}

// ── Requests ──

function migrateRequests(): number {
  const requestsFile = path.join(getUploadRoot(), '.requests.json');
  if (!fs.existsSync(requestsFile)) {
    console.log('[migrate] No .requests.json found — skipping.');
    return 0;
  }

  let records: Array<{
    id: string; workspaceId: string; title: string; description: string;
    category: string; priority: string; status: string;
    submittedBy?: string; pageUrl?: string; pageId?: string;
    attachments?: unknown[]; notes: unknown[];
    createdAt: string; updatedAt: string;
  }>;
  try {
    records = JSON.parse(fs.readFileSync(requestsFile, 'utf-8'));
  } catch (err) {
    console.warn('[migrate] Failed to parse .requests.json:', err);
    return 0;
  }
  if (!Array.isArray(records)) return 0;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO requests
      (id, workspace_id, title, description, category, priority,
       status, submitted_by, page_url, page_id, attachments, notes,
       created_at, updated_at)
    VALUES
      (@id, @workspace_id, @title, @description, @category, @priority,
       @status, @submitted_by, @page_url, @page_id, @attachments, @notes,
       @created_at, @updated_at)
  `);

  let total = 0;
  const insertAll = db.transaction(() => {
    for (const r of records) {
      const info = insert.run({
        id: r.id,
        workspace_id: r.workspaceId,
        title: r.title,
        description: r.description,
        category: r.category,
        priority: r.priority || 'medium',
        status: r.status || 'new',
        submitted_by: r.submittedBy ?? null,
        page_url: r.pageUrl ?? null,
        page_id: r.pageId ?? null,
        attachments: r.attachments ? JSON.stringify(r.attachments) : null,
        notes: JSON.stringify(r.notes || []),
        created_at: r.createdAt,
        updated_at: r.updatedAt,
      });
      total += info.changes;
    }
  });
  insertAll();
  console.log(`[migrate] .requests.json: ${records.length} request(s), inserted ${total}`);
  return total;
}

// ── Churn Signals ──

function migrateChurnSignals(): number {
  const signalsFile = path.join(getUploadRoot(), '.churn-signals.json');
  if (!fs.existsSync(signalsFile)) {
    console.log('[migrate] No .churn-signals.json found — skipping.');
    return 0;
  }

  let records: Array<{
    id: string; workspaceId: string; workspaceName: string;
    type: string; severity: string; title: string; description: string;
    detectedAt: string; dismissedAt?: string;
  }>;
  try {
    records = JSON.parse(fs.readFileSync(signalsFile, 'utf-8'));
  } catch (err) {
    console.warn('[migrate] Failed to parse .churn-signals.json:', err);
    return 0;
  }
  if (!Array.isArray(records)) return 0;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO churn_signals
      (id, workspace_id, workspace_name, type, severity,
       title, description, detected_at, dismissed_at)
    VALUES
      (@id, @workspace_id, @workspace_name, @type, @severity,
       @title, @description, @detected_at, @dismissed_at)
  `);

  let total = 0;
  const insertAll = db.transaction(() => {
    for (const r of records) {
      const info = insert.run({
        id: r.id,
        workspace_id: r.workspaceId,
        workspace_name: r.workspaceName,
        type: r.type,
        severity: r.severity,
        title: r.title,
        description: r.description,
        detected_at: r.detectedAt,
        dismissed_at: r.dismissedAt ?? null,
      });
      total += info.changes;
    }
  });
  insertAll();
  console.log(`[migrate] .churn-signals.json: ${records.length} signal(s), inserted ${total}`);
  return total;
}

// ── Anomalies ──

function migrateAnomalies(): number {
  const anomaliesFile = path.join(getUploadRoot(), '.anomalies.json');
  if (!fs.existsSync(anomaliesFile)) {
    console.log('[migrate] No .anomalies.json found — skipping.');
    return 0;
  }

  let records: Array<{
    id: string; workspaceId: string; workspaceName: string;
    type: string; severity: string; title: string; description: string;
    metric: string; currentValue: number; previousValue: number;
    changePct: number; aiSummary?: string;
    detectedAt: string; dismissedAt?: string; acknowledgedAt?: string;
    source: string;
  }>;
  try {
    records = JSON.parse(fs.readFileSync(anomaliesFile, 'utf-8'));
  } catch (err) {
    console.warn('[migrate] Failed to parse .anomalies.json:', err);
    return 0;
  }
  if (!Array.isArray(records)) return 0;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO anomalies
      (id, workspace_id, workspace_name, type, severity,
       title, description, metric, current_value, previous_value, change_pct,
       ai_summary, detected_at, dismissed_at, acknowledged_at, source)
    VALUES
      (@id, @workspace_id, @workspace_name, @type, @severity,
       @title, @description, @metric, @current_value, @previous_value, @change_pct,
       @ai_summary, @detected_at, @dismissed_at, @acknowledged_at, @source)
  `);

  let total = 0;
  const insertAll = db.transaction(() => {
    for (const r of records) {
      const info = insert.run({
        id: r.id,
        workspace_id: r.workspaceId,
        workspace_name: r.workspaceName,
        type: r.type,
        severity: r.severity,
        title: r.title,
        description: r.description,
        metric: r.metric,
        current_value: r.currentValue,
        previous_value: r.previousValue,
        change_pct: r.changePct,
        ai_summary: r.aiSummary ?? null,
        detected_at: r.detectedAt,
        dismissed_at: r.dismissedAt ?? null,
        acknowledged_at: r.acknowledgedAt ?? null,
        source: r.source,
      });
      total += info.changes;
    }
  });
  insertAll();
  console.log(`[migrate] .anomalies.json: ${records.length} anomaly(ies), inserted ${total}`);
  return total;
}

// ── Audit Schedules ──

function migrateAuditSchedules(): number {
  const schedulesFile = path.join(getUploadRoot(), '.audit-schedules.json');
  if (!fs.existsSync(schedulesFile)) {
    console.log('[migrate] No .audit-schedules.json found — skipping.');
    return 0;
  }

  let records: Array<{
    workspaceId: string; enabled: boolean; intervalDays: number;
    scoreDropThreshold: number; lastRunAt?: string; lastScore?: number;
  }>;
  try {
    records = JSON.parse(fs.readFileSync(schedulesFile, 'utf-8'));
  } catch (err) {
    console.warn('[migrate] Failed to parse .audit-schedules.json:', err);
    return 0;
  }
  if (!Array.isArray(records)) return 0;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO audit_schedules
      (workspace_id, enabled, interval_days, score_drop_threshold,
       last_run_at, last_score)
    VALUES
      (@workspace_id, @enabled, @interval_days, @score_drop_threshold,
       @last_run_at, @last_score)
  `);

  let total = 0;
  const insertAll = db.transaction(() => {
    for (const r of records) {
      const info = insert.run({
        workspace_id: r.workspaceId,
        enabled: r.enabled ? 1 : 0,
        interval_days: r.intervalDays || 7,
        score_drop_threshold: r.scoreDropThreshold || 5,
        last_run_at: r.lastRunAt ?? null,
        last_score: r.lastScore ?? null,
      });
      total += info.changes;
    }
  });
  insertAll();
  console.log(`[migrate] .audit-schedules.json: ${records.length} schedule(s), inserted ${total}`);
  return total;
}

// --- Run all migrations ---
console.log('[migrate] Starting JSON \u2192 SQLite data migration...');

const results = {
  payments: migratePayments(),
  users: migrateUsers(),
  clientUsers: migrateClientUsers(),
  resetTokens: migrateResetTokens(),
  activityLog: migrateActivityLog(),
  requests: migrateRequests(),
  churnSignals: migrateChurnSignals(),
  anomalies: migrateAnomalies(),
  auditSchedules: migrateAuditSchedules(),
};

const totalInserted = Object.values(results).reduce((a, b) => a + b, 0);
console.log(`[migrate] Done. Total inserted: ${totalInserted} record(s).`);
console.log('[migrate] Breakdown:', results);
