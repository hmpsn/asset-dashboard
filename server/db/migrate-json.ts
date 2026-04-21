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


// ═══════════════════════════════════════════════════════════════════
// Tier 2 — Per-workspace modules
// ═══════════════════════════════════════════════════════════════════

// ── Approvals ──

function migrateApprovals(): number {
  const dir = getDataDir('approvals');
  if (!fs.existsSync(dir)) { console.log('[migrate] No approvals directory — skipping.'); return 0; }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  if (files.length === 0) return 0;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO approval_batches
      (id, workspace_id, site_id, name, items, status, created_at, updated_at)
    VALUES (@id, @workspace_id, @site_id, @name, @items, @status, @created_at, @updated_at)
  `);

  let total = 0;
  const run = db.transaction(() => {
    for (const file of files) {
      const wsId = path.basename(file, '.json');
      let records: any[];
      try { records = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')); } catch { continue; }
      if (!Array.isArray(records)) continue;
      for (const r of records) {
        const info = insert.run({
          id: r.id, workspace_id: r.workspaceId || wsId,
          site_id: r.siteId || '',
          name: r.name || '', items: JSON.stringify(r.items || []),
          status: r.status || 'pending',
          created_at: r.createdAt || new Date().toISOString(),
          updated_at: r.updatedAt || r.createdAt || new Date().toISOString(),
        });
        total += info.changes;
      }
      console.log(`[migrate] approvals/${file}: ${records.length} batch(es)`);
    }
  });
  run();
  return total;
}

// ── Content Briefs ──

function migrateContentBriefs(): number {
  const dir = getDataDir('content-briefs');
  if (!fs.existsSync(dir)) { console.log('[migrate] No content-briefs directory — skipping.'); return 0; }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  if (files.length === 0) return 0;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO content_briefs
      (id, workspace_id, target_keyword, secondary_keywords, suggested_title,
       suggested_meta_desc, outline, word_count_target, intent, audience,
       competitor_insights, internal_link_suggestions, created_at,
       executive_summary, content_format, tone_and_style, people_also_ask,
       topical_entities, serp_analysis, difficulty_score, traffic_potential,
       cta_recommendations, eeat_guidance, content_checklist, schema_recommendations,
       page_type, reference_urls, real_people_also_ask, real_top_results)
    VALUES
      (@id, @workspace_id, @target_keyword, @secondary_keywords, @suggested_title,
       @suggested_meta_desc, @outline, @word_count_target, @intent, @audience,
       @competitor_insights, @internal_link_suggestions, @created_at,
       @executive_summary, @content_format, @tone_and_style, @people_also_ask,
       @topical_entities, @serp_analysis, @difficulty_score, @traffic_potential,
       @cta_recommendations, @eeat_guidance, @content_checklist, @schema_recommendations,
       @page_type, @reference_urls, @real_people_also_ask, @real_top_results)
  `);

  let total = 0;
  const run = db.transaction(() => {
    for (const file of files) {
      const wsId = path.basename(file, '.json');
      let records: any[];
      try { records = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')); } catch { continue; }
      if (!Array.isArray(records)) continue;
      for (const r of records) {
        const info = insert.run({
          id: r.id, workspace_id: r.workspaceId || wsId,
          target_keyword: r.targetKeyword || '',
          secondary_keywords: JSON.stringify(r.secondaryKeywords || []),
          suggested_title: r.suggestedTitle || '',
          suggested_meta_desc: r.suggestedMetaDesc || '',
          outline: JSON.stringify(r.outline || []),
          word_count_target: r.wordCountTarget || 1500,
          intent: r.intent || 'informational',
          audience: r.audience || '',
          competitor_insights: r.competitorInsights || '',
          internal_link_suggestions: JSON.stringify(r.internalLinkSuggestions || []),
          created_at: r.createdAt || new Date().toISOString(),
          executive_summary: r.executiveSummary ?? null,
          content_format: r.contentFormat ?? null,
          tone_and_style: r.toneAndStyle ?? null,
          people_also_ask: r.peopleAlsoAsk ? JSON.stringify(r.peopleAlsoAsk) : null,
          topical_entities: r.topicalEntities ? JSON.stringify(r.topicalEntities) : null,
          serp_analysis: r.serpAnalysis ? JSON.stringify(r.serpAnalysis) : null,
          difficulty_score: r.difficultyScore ?? null,
          traffic_potential: r.trafficPotential ?? null,
          cta_recommendations: r.ctaRecommendations ? JSON.stringify(r.ctaRecommendations) : null,
          eeat_guidance: r.eeatGuidance ? JSON.stringify(r.eeatGuidance) : null,
          content_checklist: r.contentChecklist ? JSON.stringify(r.contentChecklist) : null,
          schema_recommendations: r.schemaRecommendations ? JSON.stringify(r.schemaRecommendations) : null,
          page_type: r.pageType ?? null,
          reference_urls: r.referenceUrls ? JSON.stringify(r.referenceUrls) : null,
          real_people_also_ask: r.realPeopleAlsoAsk ? JSON.stringify(r.realPeopleAlsoAsk) : null,
          real_top_results: r.realTopResults ? JSON.stringify(r.realTopResults) : null,
        });
        total += info.changes;
      }
      console.log(`[migrate] content-briefs/${file}: ${records.length} brief(s)`);
    }
  });
  run();
  return total;
}

// ── Content Requests ──

function migrateContentRequests(): number {
  const dir = getDataDir('content-requests');
  if (!fs.existsSync(dir)) { console.log('[migrate] No content-requests directory — skipping.'); return 0; }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  if (files.length === 0) return 0;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO content_topic_requests
      (id, workspace_id, topic, target_keyword, intent, priority, rationale, status,
       brief_id, client_note, internal_note, decline_reason, client_feedback,
       source, service_type, page_type, upgraded_at, delivery_url, delivery_notes,
       target_page_id, target_page_slug, comments, requested_at, updated_at)
    VALUES
      (@id, @workspace_id, @topic, @target_keyword, @intent, @priority, @rationale, @status,
       @brief_id, @client_note, @internal_note, @decline_reason, @client_feedback,
       @source, @service_type, @page_type, @upgraded_at, @delivery_url, @delivery_notes,
       @target_page_id, @target_page_slug, @comments, @requested_at, @updated_at)
  `);

  let total = 0;
  const run = db.transaction(() => {
    for (const file of files) {
      const wsId = path.basename(file, '.json');
      let records: any[];
      try { records = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')); } catch { continue; }
      if (!Array.isArray(records)) continue;
      for (const r of records) {
        const info = insert.run({
          id: r.id, workspace_id: r.workspaceId || wsId,
          topic: r.topic || '', target_keyword: r.targetKeyword || '',
          intent: r.intent || '', priority: r.priority || 'medium',
          rationale: r.rationale || '', status: r.status || 'requested',
          brief_id: r.briefId ?? null, client_note: r.clientNote ?? null,
          internal_note: r.internalNote ?? null, decline_reason: r.declineReason ?? null,
          client_feedback: r.clientFeedback ?? null,
          source: r.source ?? null, service_type: r.serviceType ?? null,
          page_type: r.pageType ?? null, upgraded_at: r.upgradedAt ?? null,
          delivery_url: r.deliveryUrl ?? null, delivery_notes: r.deliveryNotes ?? null,
          target_page_id: r.targetPageId ?? null, target_page_slug: r.targetPageSlug ?? null,
          comments: JSON.stringify(r.comments || []),
          requested_at: r.requestedAt || new Date().toISOString(),
          updated_at: r.updatedAt || r.requestedAt || new Date().toISOString(),
        });
        total += info.changes;
      }
      console.log(`[migrate] content-requests/${file}: ${records.length} request(s)`);
    }
  });
  run();
  return total;
}

// ── Content Posts ──

function migrateContentPosts(): number {
  const dir = getDataDir('content-posts');
  if (!fs.existsSync(dir)) { console.log('[migrate] No content-posts directory — skipping.'); return 0; }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  if (files.length === 0) return 0;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO content_posts
      (id, workspace_id, brief_id, target_keyword, title, meta_description,
       introduction, sections, conclusion, seo_title, seo_meta_description,
       total_word_count, target_word_count, status, unification_status,
       unification_note, created_at, updated_at)
    VALUES
      (@id, @workspace_id, @brief_id, @target_keyword, @title, @meta_description,
       @introduction, @sections, @conclusion, @seo_title, @seo_meta_description,
       @total_word_count, @target_word_count, @status, @unification_status,
       @unification_note, @created_at, @updated_at)
  `);

  let total = 0;
  const run = db.transaction(() => {
    for (const file of files) {
      const wsId = path.basename(file, '.json');
      let records: any[];
      try { records = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')); } catch { continue; }
      if (!Array.isArray(records)) continue;
      for (const r of records) {
        const info = insert.run({
          id: r.id, workspace_id: r.workspaceId || wsId,
          brief_id: r.briefId || '', target_keyword: r.targetKeyword || '',
          title: r.title || '', meta_description: r.metaDescription || '',
          introduction: r.introduction || '', sections: JSON.stringify(r.sections || []),
          conclusion: r.conclusion || '',
          seo_title: r.seoTitle ?? null, seo_meta_description: r.seoMetaDescription ?? null,
          total_word_count: r.totalWordCount || 0, target_word_count: r.targetWordCount || 0,
          status: r.status || 'draft',
          unification_status: r.unificationStatus ?? null,
          unification_note: r.unificationNote ?? null,
          created_at: r.createdAt || new Date().toISOString(),
          updated_at: r.updatedAt || r.createdAt || new Date().toISOString(),
        });
        total += info.changes;
      }
      console.log(`[migrate] content-posts/${file}: ${records.length} post(s)`);
    }
  });
  run();
  return total;
}

// ── Work Orders ──

function migrateWorkOrders(): number {
  const dir = getDataDir('work-orders');
  if (!fs.existsSync(dir)) { console.log('[migrate] No work-orders directory — skipping.'); return 0; }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  if (files.length === 0) return 0;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO work_orders
      (id, workspace_id, payment_id, product_type, status, page_ids,
       issue_checks, quantity, assigned_to, completed_at, notes, created_at, updated_at)
    VALUES
      (@id, @workspace_id, @payment_id, @product_type, @status, @page_ids,
       @issue_checks, @quantity, @assigned_to, @completed_at, @notes, @created_at, @updated_at)
  `);

  let total = 0;
  const run = db.transaction(() => {
    for (const file of files) {
      const wsId = path.basename(file, '.json');
      let records: any[];
      try { records = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')); } catch { continue; }
      if (!Array.isArray(records)) continue;
      for (const r of records) {
        const info = insert.run({
          id: r.id, workspace_id: r.workspaceId || wsId,
          payment_id: r.paymentId || '', product_type: r.productType || '',
          status: r.status || 'pending',
          page_ids: JSON.stringify(r.pageIds || []),
          issue_checks: r.issueChecks ? JSON.stringify(r.issueChecks) : null,
          quantity: r.quantity || 1,
          assigned_to: r.assignedTo ?? null,
          completed_at: r.completedAt ?? null,
          notes: r.notes ?? null,
          created_at: r.createdAt || new Date().toISOString(),
          updated_at: r.updatedAt || r.createdAt || new Date().toISOString(),
        });
        total += info.changes;
      }
      console.log(`[migrate] work-orders/${file}: ${records.length} order(s)`);
    }
  });
  run();
  return total;
}

// ── Recommendations ──

function migrateRecommendations(): number {
  const dir = getDataDir('recommendations');
  if (!fs.existsSync(dir)) { console.log('[migrate] No recommendations directory — skipping.'); return 0; }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  if (files.length === 0) return 0;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO recommendation_sets
      (workspace_id, generated_at, recommendations, summary)
    VALUES (@workspace_id, @generated_at, @recommendations, @summary)
  `);

  let total = 0;
  const run = db.transaction(() => {
    for (const file of files) {
      const wsId = path.basename(file, '.json');
      let record: any;
      try { record = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')); } catch { continue; }
      if (!record || typeof record !== 'object') continue;
      const info = insert.run({
        workspace_id: record.workspaceId || wsId,
        generated_at: record.generatedAt || new Date().toISOString(),
        recommendations: JSON.stringify(record.recommendations || []),
        summary: JSON.stringify(record.summary || {}),
      });
      total += info.changes;
      console.log(`[migrate] recommendations/${file}: 1 set`);
    }
  });
  run();
  return total;
}

// ── Annotations ──

function migrateAnnotations(): number {
  const uploadRoot = getUploadRoot();
  let total = 0;
  // Annotations are stored at UPLOAD_ROOT/<wsId>/.annotations.json
  let dirs: string[];
  try { dirs = fs.readdirSync(uploadRoot); } catch { return 0; }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO annotations
      (id, workspace_id, date, label, description, color, created_at)
    VALUES (@id, @workspace_id, @date, @label, @description, @color, @created_at)
  `);

  const run = db.transaction(() => {
    for (const wsId of dirs) {
      const annoFile = path.join(uploadRoot, wsId, '.annotations.json');
      if (!fs.existsSync(annoFile)) continue;
      let records: any[];
      try { records = JSON.parse(fs.readFileSync(annoFile, 'utf-8')); } catch { continue; }
      if (!Array.isArray(records)) continue;
      for (const r of records) {
        const info = insert.run({
          id: r.id, workspace_id: r.workspaceId || wsId,
          date: r.date || '', label: r.label || '',
          description: r.description ?? null,
          color: r.color ?? null,
          created_at: r.createdAt || new Date().toISOString(),
        });
        total += info.changes;
      }
      console.log(`[migrate] annotations for ${wsId}: ${records.length} annotation(s)`);
    }
  });
  run();
  return total;
}

// ── SEO Changes ──

function migrateSeoChanges(): number {
  const dir = getDataDir('seo-changes');
  if (!fs.existsSync(dir)) { console.log('[migrate] No seo-changes directory — skipping.'); return 0; }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  if (files.length === 0) return 0;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO seo_changes
      (id, workspace_id, page_id, page_slug, page_title, fields, source, changed_at)
    VALUES (@id, @workspace_id, @page_id, @page_slug, @page_title, @fields, @source, @changed_at)
  `);

  let total = 0;
  const run = db.transaction(() => {
    for (const file of files) {
      const wsId = path.basename(file, '.json');
      let records: any[];
      try { records = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')); } catch { continue; }
      if (!Array.isArray(records)) continue;
      for (const r of records) {
        const info = insert.run({
          id: r.id, workspace_id: r.workspaceId || wsId,
          page_id: r.pageId || '', page_slug: r.pageSlug || '',
          page_title: r.pageTitle || '',
          fields: JSON.stringify(r.fields || []),
          source: r.source || '',
          changed_at: r.changedAt || new Date().toISOString(),
        });
        total += info.changes;
      }
      console.log(`[migrate] seo-changes/${file}: ${records.length} change(s)`);
    }
  });
  run();
  return total;
}

// ── Content Decay ──

function migrateContentDecay(): number {
  const dir = getDataDir('content-decay');
  if (!fs.existsSync(dir)) { console.log('[migrate] No content-decay directory — skipping.'); return 0; }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  if (files.length === 0) return 0;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO decay_analyses
      (workspace_id, analyzed_at, total_pages, decaying_pages, summary)
    VALUES (@workspace_id, @analyzed_at, @total_pages, @decaying_pages, @summary)
  `);

  let total = 0;
  const run = db.transaction(() => {
    for (const file of files) {
      const wsId = path.basename(file, '.json');
      let record: any;
      try { record = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')); } catch { continue; }
      if (!record || typeof record !== 'object') continue;
      const info = insert.run({
        workspace_id: record.workspaceId || wsId,
        analyzed_at: record.analyzedAt || new Date().toISOString(),
        total_pages: record.totalPages || 0,
        decaying_pages: JSON.stringify(record.decayingPages || []),
        summary: JSON.stringify(record.summary || {}),
      });
      total += info.changes;
      console.log(`[migrate] content-decay/${file}: 1 analysis`);
    }
  });
  run();
  return total;
}

// ── ROI History ──

function migrateRoiHistory(): number {
  const dir = getDataDir('roi-history');
  if (!fs.existsSync(dir)) { console.log('[migrate] No roi-history directory — skipping.'); return 0; }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  if (files.length === 0) return 0;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO roi_snapshots
      (workspace_id, organic_traffic_value, computed_at)
    VALUES (@workspace_id, @organic_traffic_value, @computed_at)
  `);

  let total = 0;
  const run = db.transaction(() => {
    for (const file of files) {
      const wsId = path.basename(file, '.json');
      let records: any[];
      try { records = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')); } catch { continue; }
      if (!Array.isArray(records)) continue;
      for (const r of records) {
        const info = insert.run({
          workspace_id: wsId,
          organic_traffic_value: r.organicTrafficValue ?? (typeof r.value === 'number' ? r.value : (typeof r === 'number' ? r : 0)),
          computed_at: r.computedAt || r.recordedAt || r.date || new Date().toISOString(),
        });
        total += info.changes;
      }
      console.log(`[migrate] roi-history/${file}: ${records.length} snapshot(s)`);
    }
  });
  run();
  return total;
}

// ── Feedback ──

function migrateFeedback(): number {
  const dir = getDataDir('feedback');
  if (!fs.existsSync(dir)) { console.log('[migrate] No feedback directory — skipping.'); return 0; }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  if (files.length === 0) return 0;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO feedback
      (id, workspace_id, type, title, description, status,
       context, submitted_by, replies, created_at, updated_at)
    VALUES
      (@id, @workspace_id, @type, @title, @description, @status,
       @context, @submitted_by, @replies, @created_at, @updated_at)
  `);

  let total = 0;
  const run = db.transaction(() => {
    for (const file of files) {
      const wsId = path.basename(file, '.json');
      let records: any[];
      try { records = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')); } catch { continue; }
      if (!Array.isArray(records)) continue;
      for (const r of records) {
        const info = insert.run({
          id: r.id, workspace_id: r.workspaceId || wsId,
          type: r.type || 'general',
          title: r.title || '',
          description: r.description || r.content || '',
          status: r.status || 'new',
          context: r.context ? JSON.stringify(r.context) : null,
          submitted_by: r.submittedBy ?? r.authorName ?? null,
          replies: JSON.stringify(r.replies || []),
          created_at: r.createdAt || new Date().toISOString(),
          updated_at: r.updatedAt || r.createdAt || new Date().toISOString(),
        });
        total += info.changes;
      }
      console.log(`[migrate] feedback/${file}: ${records.length} item(s)`);
    }
  });
  run();
  return total;
}

// ── Rank Tracking Config ──

function migrateRankTracking(): number {
  const uploadRoot = getUploadRoot();
  let total = 0;
  let dirs: string[];
  try { dirs = fs.readdirSync(uploadRoot); } catch { return 0; }

  const insertConfig = db.prepare(`
    INSERT OR IGNORE INTO rank_tracking_config
      (workspace_id, tracked_keywords)
    VALUES (@workspace_id, @tracked_keywords)
  `);

  const insertSnapshot = db.prepare(`
    INSERT OR IGNORE INTO rank_snapshots
      (workspace_id, date, queries)
    VALUES (@workspace_id, @date, @queries)
  `);

  const run = db.transaction(() => {
    for (const wsId of dirs) {
      const rtDir = path.join(uploadRoot, wsId, '.rank-tracking');
      if (!fs.existsSync(rtDir)) continue;

      // Migrate config
      const configFile = path.join(rtDir, 'config.json');
      if (fs.existsSync(configFile)) {
        try {
          const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
          const info = insertConfig.run({
            workspace_id: wsId,
            tracked_keywords: JSON.stringify(config.trackedKeywords || config.keywords || []),
          });
          total += info.changes;
          console.log(`[migrate] rank-tracking config for ${wsId}`);
        } catch { /* skip corrupt config */ }
      }

      // Migrate snapshots
      const snapshotsFile = path.join(rtDir, 'snapshots.json');
      if (fs.existsSync(snapshotsFile)) {
        try {
          const snapshots = JSON.parse(fs.readFileSync(snapshotsFile, 'utf-8'));
          if (Array.isArray(snapshots)) {
            for (const s of snapshots) {
              const info = insertSnapshot.run({
                workspace_id: wsId,
                date: s.date || s.capturedAt || new Date().toISOString().slice(0, 10),
                queries: JSON.stringify(s.queries || []),
              });
              total += info.changes;
            }
            console.log(`[migrate] rank-tracking snapshots for ${wsId}: ${snapshots.length}`);
          }
        } catch { /* skip corrupt snapshot */ }
      }
    }
  });
  run();
  return total;
}

// ── Tier 3 — Per-site snapshots + config/admin ──

function migrateAuditSnapshots(): number {
  const reportsDir = getDataDir('reports');
  if (!fs.existsSync(reportsDir)) {
    console.log('[migrate] No reports directory found — skipping audit snapshots.');
    return 0;
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO audit_snapshots
      (id, site_id, site_name, created_at, audit, logo_url, action_items, previous_score)
    VALUES (@id, @site_id, @site_name, @created_at, @audit, @logo_url, @action_items, @previous_score)
  `);

  let total = 0;
  const sites = fs.readdirSync(reportsDir).filter(f => {
    try { return fs.statSync(path.join(reportsDir, f)).isDirectory(); } catch { return false; }
  });

  const insertAll = db.transaction(() => {
    for (const siteId of sites) {
      const siteDir = path.join(reportsDir, siteId);
      const files = fs.readdirSync(siteDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(siteDir, file), 'utf-8'));
          const info = insert.run({
            id: data.id || file.replace('.json', ''),
            site_id: data.siteId || siteId,
            site_name: data.siteName || siteId,
            created_at: data.createdAt || new Date().toISOString(),
            audit: JSON.stringify(data.audit || {}),
            logo_url: data.logoUrl ?? null,
            action_items: JSON.stringify(data.actionItems || []),
            previous_score: data.previousScore ?? null,
          });
          total += info.changes;
        } catch (err) {
          console.warn(`[migrate] Failed to migrate audit snapshot ${file}:`, err);
        }
      }
    }
  });

  insertAll();
  console.log(`[migrate] Audit snapshots: inserted ${total} record(s)`);
  return total;
}

function migrateSchemaSnapshots(): number {
  const schemasDir = getDataDir('schemas');
  if (!fs.existsSync(schemasDir)) {
    console.log('[migrate] No schemas directory found — skipping.');
    return 0;
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO schema_snapshots
      (id, site_id, workspace_id, created_at, results, page_count)
    VALUES (@id, @site_id, @workspace_id, @created_at, @results, @page_count)
  `);

  let total = 0;
  const insertAll = db.transaction(() => {
    const files = fs.readdirSync(schemasDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(schemasDir, file), 'utf-8'));
        const info = insert.run({
          id: data.id || `schema-${file.replace('.json', '')}-${Date.now()}`,
          site_id: data.siteId || file.replace('.json', ''),
          workspace_id: data.workspaceId || '',
          created_at: data.createdAt || new Date().toISOString(),
          results: JSON.stringify(data.results || []),
          page_count: data.pageCount || (data.results || []).length,
        });
        total += info.changes;
      } catch (err) {
        console.warn(`[migrate] Failed to migrate schema snapshot ${file}:`, err);
      }
    }
  });

  insertAll();
  console.log(`[migrate] Schema snapshots: inserted ${total} record(s)`);
  return total;
}

function migrateRedirectSnapshots(): number {
  const redirectsDir = getDataDir('redirects');
  if (!fs.existsSync(redirectsDir)) {
    console.log('[migrate] No redirects directory found — skipping.');
    return 0;
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO redirect_snapshots
      (id, site_id, created_at, result)
    VALUES (@id, @site_id, @created_at, @result)
  `);

  let total = 0;
  const insertAll = db.transaction(() => {
    const files = fs.readdirSync(redirectsDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(redirectsDir, file), 'utf-8'));
        const info = insert.run({
          id: data.id || `redirect-${file.replace('.json', '')}-${Date.now()}`,
          site_id: data.siteId || file.replace('.json', ''),
          created_at: data.createdAt || new Date().toISOString(),
          result: JSON.stringify(data.result || {}),
        });
        total += info.changes;
      } catch (err) {
        console.warn(`[migrate] Failed to migrate redirect snapshot ${file}:`, err);
      }
    }
  });

  insertAll();
  console.log(`[migrate] Redirect snapshots: inserted ${total} record(s)`);
  return total;
}

function migratePerformanceSnapshots(): number {
  const perfDir = getDataDir('performance');
  if (!fs.existsSync(perfDir)) {
    console.log('[migrate] No performance directory found — skipping.');
    return 0;
  }

  const insert = db.prepare(`
    INSERT OR REPLACE INTO performance_snapshots
      (sub, site_id, created_at, result)
    VALUES (@sub, @site_id, @created_at, @result)
  `);

  let total = 0;
  const insertAll = db.transaction(() => {
    // Scan subdirectories (page-weight, pagespeed, pagespeed-single, link-check, internal-links, competitor)
    const subs = fs.readdirSync(perfDir).filter(f => {
      try { return fs.statSync(path.join(perfDir, f)).isDirectory(); } catch { return false; }
    });

    for (const sub of subs) {
      const subDir = path.join(perfDir, sub);
      const files = fs.readdirSync(subDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(subDir, file), 'utf-8'));
          const info = insert.run({
            sub,
            site_id: data.siteId || file.replace('.json', ''),
            created_at: data.createdAt || new Date().toISOString(),
            result: JSON.stringify(data.result ?? data),
          });
          total += info.changes;
        } catch (err) {
          console.warn(`[migrate] Failed to migrate performance snapshot ${sub}/${file}:`, err);
        }
      }
    }
  });

  insertAll();
  console.log(`[migrate] Performance snapshots: inserted ${total} record(s)`);
  return total;
}

function migrateChatSessions(): number {
  const chatDir = getDataDir('chat-sessions');
  if (!fs.existsSync(chatDir)) {
    console.log('[migrate] No chat-sessions directory found — skipping.');
    return 0;
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO chat_sessions
      (id, workspace_id, channel, title, messages, summary, created_at, updated_at)
    VALUES (@id, @workspace_id, @channel, @title, @messages, @summary, @created_at, @updated_at)
  `);

  let total = 0;
  const insertAll = db.transaction(() => {
    const workspaces = fs.readdirSync(chatDir).filter(f => {
      try { return fs.statSync(path.join(chatDir, f)).isDirectory(); } catch { return false; }
    });

    for (const wsId of workspaces) {
      const wsDir = path.join(chatDir, wsId);
      const files = fs.readdirSync(wsDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(wsDir, file), 'utf-8'));
          const info = insert.run({
            id: data.id || file.replace('.json', ''),
            workspace_id: data.workspaceId || wsId,
            channel: data.channel || 'client',
            title: data.title || 'Untitled',
            messages: JSON.stringify(data.messages || []),
            summary: data.summary ?? null,
            created_at: data.createdAt || new Date().toISOString(),
            updated_at: data.updatedAt || data.createdAt || new Date().toISOString(),
          });
          total += info.changes;
        } catch (err) {
          console.warn(`[migrate] Failed to migrate chat session ${wsId}/${file}:`, err);
        }
      }
    }
  });

  insertAll();
  console.log(`[migrate] Chat sessions: inserted ${total} record(s)`);
  return total;
}

function migrateGoogleTokens(): number {
  const tokenFile = path.join(getDataDir(''), 'google-tokens.json');
  if (!fs.existsSync(tokenFile)) {
    console.log('[migrate] No google-tokens.json found — skipping.');
    return 0;
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO google_tokens
      (site_id, access_token, refresh_token, expires_at, scope)
    VALUES (@site_id, @access_token, @refresh_token, @expires_at, @scope)
  `);

  let total = 0;
  try {
    const store = JSON.parse(fs.readFileSync(tokenFile, 'utf-8'));
    const insertAll = db.transaction(() => {
      for (const [siteId, tokens] of Object.entries(store)) {
        const t = tokens as { access_token: string; refresh_token?: string; expires_at: number; scope: string };
        const info = insert.run({
          site_id: siteId,
          access_token: t.access_token,
          refresh_token: t.refresh_token ?? null,
          expires_at: t.expires_at,
          scope: t.scope || '',
        });
        total += info.changes;
      }
    });
    insertAll();
  } catch (err) {
    console.warn('[migrate] Failed to migrate google tokens:', err);
  }

  console.log(`[migrate] Google tokens: inserted ${total} record(s)`);
  return total;
}

function migrateUsageTracking(): number {
  const usageDir = path.join(process.cwd(), 'data', 'usage');
  if (!fs.existsSync(usageDir)) {
    console.log('[migrate] No usage directory found — skipping.');
    return 0;
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO usage_tracking
      (workspace_id, month, feature, count)
    VALUES (@workspace_id, @month, @feature, @count)
  `);

  let total = 0;
  const insertAll = db.transaction(() => {
    const files = fs.readdirSync(usageDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const workspaceId = file.replace('.json', '');
        const data = JSON.parse(fs.readFileSync(path.join(usageDir, file), 'utf-8'));
        if (data.month && data.counts) {
          for (const [feature, count] of Object.entries(data.counts)) {
            const info = insert.run({
              workspace_id: workspaceId,
              month: data.month,
              feature,
              count: count as number,
            });
            total += info.changes;
          }
        }
      } catch (err) {
        console.warn(`[migrate] Failed to migrate usage tracking ${file}:`, err);
      }
    }
  });

  insertAll();
  console.log(`[migrate] Usage tracking: inserted ${total} record(s)`);
  return total;
}

// ── Tier 5 — Workspaces ──

function migrateWorkspaces(): number {
  const configFile = path.join(getUploadRoot(), '.workspaces.json');
  if (!fs.existsSync(configFile)) {
    console.log('[migrate] No .workspaces.json found — skipping workspaces.');
    return 0;
  }

  let workspaces: Array<Record<string, unknown>>;
  try {
    workspaces = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
  } catch (err) {
    console.warn('[migrate] Failed to parse .workspaces.json:', err);
    return 0;
  }
  if (!Array.isArray(workspaces)) return 0;

  const insertWs = db.prepare(`
    INSERT OR IGNORE INTO workspaces
      (id, name, folder, webflow_site_id, webflow_site_name, webflow_token,
       gsc_property_url, ga4_property_id, client_password, client_email,
       live_domain, event_config, event_groups, keyword_strategy,
       competitor_domains, personas, client_portal_enabled, seo_client_view,
       analytics_client_view, auto_reports, auto_report_frequency,
       brand_voice, knowledge_base, brand_logo_url, brand_accent_color,
       tier, trial_ends_at, stripe_customer_id, stripe_subscription_id,
       onboarding_enabled, onboarding_completed, content_pricing,
       portal_contacts, audit_suppressions, created_at)
    VALUES
      (@id, @name, @folder, @webflow_site_id, @webflow_site_name, @webflow_token,
       @gsc_property_url, @ga4_property_id, @client_password, @client_email,
       @live_domain, @event_config, @event_groups, @keyword_strategy,
       @competitor_domains, @personas, @client_portal_enabled, @seo_client_view,
       @analytics_client_view, @auto_reports, @auto_report_frequency,
       @brand_voice, @knowledge_base, @brand_logo_url, @brand_accent_color,
       @tier, @trial_ends_at, @stripe_customer_id, @stripe_subscription_id,
       @onboarding_enabled, @onboarding_completed, @content_pricing,
       @portal_contacts, @audit_suppressions, @created_at)
  `);

  const insertPageState = db.prepare(`
    INSERT OR IGNORE INTO page_edit_states
      (workspace_id, page_id, slug, status, audit_issues, fields, source,
       approval_batch_id, content_request_id, work_order_id, recommendation_id,
       rejection_note, updated_at, updated_by)
    VALUES
      (@workspace_id, @page_id, @slug, @status, @audit_issues, @fields, @source,
       @approval_batch_id, @content_request_id, @work_order_id, @recommendation_id,
       @rejection_note, @updated_at, @updated_by)
  `);

  const insertSeoEdit = db.prepare(`
    INSERT OR IGNORE INTO seo_edit_tracking
      (workspace_id, page_id, status, updated_at, fields)
    VALUES (@workspace_id, @page_id, @status, @updated_at, @fields)
  `);

  let total = 0;
  const insertAll = db.transaction(() => {
    for (const ws of workspaces) {
      const info = insertWs.run({
        id: ws.id as string,
        name: ws.name as string,
        folder: ws.folder as string,
        webflow_site_id: (ws.webflowSiteId as string) ?? null,
        webflow_site_name: (ws.webflowSiteName as string) ?? null,
        webflow_token: (ws.webflowToken as string) ?? null,
        gsc_property_url: (ws.gscPropertyUrl as string) ?? null,
        ga4_property_id: (ws.ga4PropertyId as string) ?? null,
        client_password: (ws.clientPassword as string) ?? null,
        client_email: (ws.clientEmail as string) ?? null,
        live_domain: (ws.liveDomain as string) ?? null,
        event_config: ws.eventConfig ? JSON.stringify(ws.eventConfig) : null,
        event_groups: ws.eventGroups ? JSON.stringify(ws.eventGroups) : null,
        keyword_strategy: ws.keywordStrategy ? JSON.stringify(ws.keywordStrategy) : null,
        competitor_domains: ws.competitorDomains ? JSON.stringify(ws.competitorDomains) : null,
        personas: ws.personas ? JSON.stringify(ws.personas) : null,
        client_portal_enabled: ws.clientPortalEnabled === undefined ? null : (ws.clientPortalEnabled ? 1 : 0),
        seo_client_view: ws.seoClientView === undefined ? null : (ws.seoClientView ? 1 : 0),
        analytics_client_view: ws.analyticsClientView === undefined ? null : (ws.analyticsClientView ? 1 : 0),
        auto_reports: ws.autoReports === undefined ? null : (ws.autoReports ? 1 : 0),
        auto_report_frequency: (ws.autoReportFrequency as string) ?? null,
        brand_voice: (ws.brandVoice as string) ?? null,
        knowledge_base: (ws.knowledgeBase as string) ?? null,
        brand_logo_url: (ws.brandLogoUrl as string) ?? null,
        brand_accent_color: (ws.brandAccentColor as string) ?? null,
        tier: (ws.tier as string) ?? 'free',
        trial_ends_at: (ws.trialEndsAt as string) ?? null,
        stripe_customer_id: (ws.stripeCustomerId as string) ?? null,
        stripe_subscription_id: (ws.stripeSubscriptionId as string) ?? null,
        onboarding_enabled: ws.onboardingEnabled === undefined ? null : (ws.onboardingEnabled ? 1 : 0),
        onboarding_completed: ws.onboardingCompleted === undefined ? null : (ws.onboardingCompleted ? 1 : 0),
        content_pricing: ws.contentPricing ? JSON.stringify(ws.contentPricing) : null,
        portal_contacts: ws.portalContacts ? JSON.stringify(ws.portalContacts) : null,
        audit_suppressions: ws.auditSuppressions ? JSON.stringify(ws.auditSuppressions) : null,
        created_at: (ws.createdAt as string) || new Date().toISOString(),
      });
      total += info.changes;

      // Migrate pageEditStates
      const pageEditStates = ws.pageEditStates as Record<string, Record<string, unknown>> | undefined;
      if (pageEditStates) {
        for (const [pageId, state] of Object.entries(pageEditStates)) {
          insertPageState.run({
            workspace_id: ws.id as string,
            page_id: pageId,
            slug: (state.slug as string) ?? null,
            status: (state.status as string) || 'clean',
            audit_issues: state.auditIssues ? JSON.stringify(state.auditIssues) : null,
            fields: state.fields ? JSON.stringify(state.fields) : null,
            source: (state.source as string) ?? null,
            approval_batch_id: (state.approvalBatchId as string) ?? null,
            content_request_id: (state.contentRequestId as string) ?? null,
            work_order_id: (state.workOrderId as string) ?? null,
            recommendation_id: (state.recommendationId as string) ?? null,
            rejection_note: (state.rejectionNote as string) ?? null,
            updated_at: (state.updatedAt as string) || new Date().toISOString(),
            updated_by: (state.updatedBy as string) ?? null,
          });
        }
      }

      // Migrate seoEditTracking
      const seoEditTracking = ws.seoEditTracking as Record<string, Record<string, unknown>> | undefined;
      if (seoEditTracking) {
        for (const [pageId, t] of Object.entries(seoEditTracking)) {
          insertSeoEdit.run({
            workspace_id: ws.id as string,
            page_id: pageId,
            status: (t.status as string) || 'flagged',
            updated_at: (t.updatedAt as string) || new Date().toISOString(),
            fields: t.fields ? JSON.stringify(t.fields) : null,
          });
        }
      }
    }
  });

  insertAll();
  console.log(`[migrate] Workspaces: ${workspaces.length} workspace(s), inserted ${total}`);
  return total;
}

// --- Run all migrations ---
console.log('[migrate] Starting JSON → SQLite data migration...');

const results = {
  // Tier 1 — Foundation
  payments: migratePayments(),
  // Tier 1 — Global singletons
  users: migrateUsers(),
  clientUsers: migrateClientUsers(),
  resetTokens: migrateResetTokens(),
  activityLog: migrateActivityLog(),
  requests: migrateRequests(),
  churnSignals: migrateChurnSignals(),
  anomalies: migrateAnomalies(),
  auditSchedules: migrateAuditSchedules(),
  // Tier 2 — Per-workspace modules
  approvals: migrateApprovals(),
  contentBriefs: migrateContentBriefs(),
  contentRequests: migrateContentRequests(),
  contentPosts: migrateContentPosts(),
  workOrders: migrateWorkOrders(),
  recommendations: migrateRecommendations(),
  annotations: migrateAnnotations(),
  seoChanges: migrateSeoChanges(),
  contentDecay: migrateContentDecay(),
  roiHistory: migrateRoiHistory(),
  feedback: migrateFeedback(),
  rankTracking: migrateRankTracking(),
  // Tier 3 — Per-site snapshots + config/admin
  auditSnapshots: migrateAuditSnapshots(),
  schemaSnapshots: migrateSchemaSnapshots(),
  redirectSnapshots: migrateRedirectSnapshots(),
  performanceSnapshots: migratePerformanceSnapshots(),
  chatSessions: migrateChatSessions(),
  googleTokens: migrateGoogleTokens(),
  usageTracking: migrateUsageTracking(),
  // Tier 5 — Workspaces
  workspaces: migrateWorkspaces(),
};

const totalInserted = Object.values(results).reduce((a, b) => a + b, 0);
console.log(`[migrate] Done. Total inserted: ${totalInserted} record(s).`);
console.log('[migrate] Breakdown:', results);
