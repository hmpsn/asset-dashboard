/**
 * Email throttle — prevents client inbox spam.
 *
 * Categories & limits:
 *   status       (request_status, request_response)         → 1/day, morning digest
 *   audit        (audit_complete, audit_improved, recs)     → 1 per 14 days
 *   action       (approval_ready, brief_ready, published…)  → 3/day
 *   alert        (anomaly_alert, audit_alert)               → 1/day
 *   transactional (password_reset, welcome, trial_warning)  → unlimited
 *   internal     (request_new, content_request, payment…)   → admin inbox, unlimited
 *   report       (monthly/weekly)                           → handled by its own module
 *
 * Global cap: max 5 non-transactional client emails per day.
 *
 * Morning digest: status events are held until ~9 AM (configurable TZ).
 */

import db from './db/index.js';
import type { EmailEventType } from './email-templates.js';
import { createLogger } from './logger.js';

const log = createLogger('email-throttle');

// ── Category mapping ──

export type ThrottleCategory = 'status' | 'audit' | 'action' | 'alert' | 'transactional' | 'internal' | 'report';

const CATEGORY_MAP: Record<EmailEventType, ThrottleCategory> = {
  // Status — daily morning digest
  request_status: 'status',
  request_response: 'status',

  // Audit — max 1 per 14 days
  audit_complete: 'audit',
  audit_improved: 'audit',
  recommendations_ready: 'audit',

  // Action — requires client action, max 3/day
  approval_ready: 'action',
  content_brief_ready: 'action',
  content_published: 'action',
  fixes_applied: 'action',

  // Alert — max 1/day
  anomaly_alert: 'alert',
  audit_alert: 'alert',

  // Transactional — never throttled
  password_reset: 'transactional',
  client_welcome: 'transactional',
  trial_expiry_warning: 'transactional',

  // Internal (admin inbox) — never throttled
  request_new: 'internal',
  content_request: 'internal',
  payment_received: 'internal',
  churn_signal: 'internal',
  feedback_new: 'internal',
};

export function getThrottleCategory(type: EmailEventType): ThrottleCategory {
  return CATEGORY_MAP[type] || 'action';
}

// ── Rate-limit config ──

interface CategoryLimit {
  maxPerWindow: number;
  windowDays: number;
}

const LIMITS: Record<string, CategoryLimit> = {
  status: { maxPerWindow: 1, windowDays: 1 },
  audit:  { maxPerWindow: 1, windowDays: 14 },
  action: { maxPerWindow: 3, windowDays: 1 },
  alert:  { maxPerWindow: 1, windowDays: 1 },
};

const GLOBAL_DAILY_CAP = 5; // max non-transactional emails per client per day

// ── Prepared statements (lazy) ──

let _insertStmt: ReturnType<typeof db.prepare> | null = null;
let _countCatStmt: ReturnType<typeof db.prepare> | null = null;
let _countGlobalStmt: ReturnType<typeof db.prepare> | null = null;
let _lastSendStmt: ReturnType<typeof db.prepare> | null = null;
let _cleanupStmt: ReturnType<typeof db.prepare> | null = null;

function insertStmt() {
  if (!_insertStmt) _insertStmt = db.prepare(
    `INSERT INTO email_sends (recipient, category, email_type, workspace_id, event_count, sent_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`
  );
  return _insertStmt;
}

function countCatStmt() {
  if (!_countCatStmt) _countCatStmt = db.prepare(
    `SELECT COUNT(*) as cnt FROM email_sends
     WHERE recipient = ? AND category = ? AND sent_at >= datetime('now', ?)`
  );
  return _countCatStmt;
}

function countGlobalStmt() {
  if (!_countGlobalStmt) _countGlobalStmt = db.prepare(
    `SELECT COUNT(*) as cnt FROM email_sends
     WHERE recipient = ? AND category NOT IN ('transactional','internal')
     AND sent_at >= datetime('now', '-1 day')`
  );
  return _countGlobalStmt;
}

function lastSendStmt() {
  if (!_lastSendStmt) _lastSendStmt = db.prepare(
    `SELECT sent_at FROM email_sends
     WHERE recipient = ? AND category = ?
     ORDER BY sent_at DESC LIMIT 1`
  );
  return _lastSendStmt;
}

function cleanupStmt() {
  if (!_cleanupStmt) _cleanupStmt = db.prepare(
    `DELETE FROM email_sends WHERE sent_at < datetime('now', '-30 days')`
  );
  return _cleanupStmt;
}

// ── Public API ──

export interface ThrottleResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Check if we can send an email of the given category to the recipient.
 * Returns { allowed: true } or { allowed: false, reason: '...' }.
 */
export function canSend(recipient: string, category: ThrottleCategory): ThrottleResult {
  // Transactional & internal are never throttled
  if (category === 'transactional' || category === 'internal' || category === 'report') {
    return { allowed: true };
  }

  // Category-specific limit
  const limit = LIMITS[category];
  if (limit) {
    const windowArg = `-${limit.windowDays} day${limit.windowDays > 1 ? 's' : ''}`;
    const row = countCatStmt().get(recipient, category, windowArg) as { cnt: number };
    if (row.cnt >= limit.maxPerWindow) {
      return {
        allowed: false,
        reason: `${category}: ${row.cnt}/${limit.maxPerWindow} in last ${limit.windowDays}d`,
      };
    }
  }

  // Global daily cap
  const global = countGlobalStmt().get(recipient) as { cnt: number };
  if (global.cnt >= GLOBAL_DAILY_CAP) {
    return {
      allowed: false,
      reason: `global daily cap: ${global.cnt}/${GLOBAL_DAILY_CAP}`,
    };
  }

  return { allowed: true };
}

/**
 * Record that an email was sent (call after successful send).
 */
export function recordSend(
  recipient: string,
  category: ThrottleCategory,
  emailType: string,
  workspaceId: string,
  eventCount: number = 1,
): void {
  try {
    insertStmt().run(recipient, category, emailType, workspaceId, eventCount);
  } catch (err) {
    log.error({ err }, 'Failed to record email send');
  }
}

/**
 * Get the last time we sent an email of the given category to the recipient.
 */
export function getLastSendTime(recipient: string, category: ThrottleCategory): Date | null {
  const row = lastSendStmt().get(recipient, category) as { sent_at: string } | undefined;
  return row ? new Date(row.sent_at + 'Z') : null;
}

/**
 * Clean up old records (> 30 days). Call periodically.
 */
export function cleanupOldSends(): number {
  const result = cleanupStmt().run();
  return result.changes;
}

// ── Morning digest helpers ──

const DIGEST_HOUR = parseInt(process.env.EMAIL_DIGEST_HOUR || '9', 10);
const DIGEST_TZ = process.env.EMAIL_DIGEST_TZ || 'America/New_York';

/**
 * Compute milliseconds until the next target hour in the configured timezone.
 * Used to set the batch timer for status emails.
 */
export function msUntilMorning(): number {
  const now = new Date();
  // Get current hour in target timezone
  const tzHour = parseInt(now.toLocaleString('en-US', { timeZone: DIGEST_TZ, hour: 'numeric', hour12: false }), 10);
  const tzMinute = parseInt(now.toLocaleString('en-US', { timeZone: DIGEST_TZ, minute: 'numeric' }), 10);

  let hoursUntil: number;
  if (tzHour < DIGEST_HOUR) {
    // Today, later
    hoursUntil = DIGEST_HOUR - tzHour;
  } else {
    // Tomorrow
    hoursUntil = 24 - tzHour + DIGEST_HOUR;
  }

  const msUntil = (hoursUntil * 60 - tzMinute) * 60 * 1000;
  // Clamp: at least 5 min, at most 24h
  return Math.max(5 * 60 * 1000, Math.min(msUntil, 24 * 60 * 60 * 1000));
}

/**
 * Check if we're currently in the morning digest window (target hour ± 30 min).
 */
export function isMorningWindow(): boolean {
  const now = new Date();
  const tzHour = parseInt(now.toLocaleString('en-US', { timeZone: DIGEST_TZ, hour: 'numeric', hour12: false }), 10);
  const tzMinute = parseInt(now.toLocaleString('en-US', { timeZone: DIGEST_TZ, minute: 'numeric' }), 10);
  const totalMin = tzHour * 60 + tzMinute;
  const targetMin = DIGEST_HOUR * 60;
  return totalMin >= targetMin && totalMin <= targetMin + 30;
}

/**
 * Determine if a restored event should be sent immediately (overdue)
 * or deferred to the next morning.
 */
export function isOverdueForMorning(createdAt: string): boolean {
  const created = new Date(createdAt);
  const now = new Date();
  // If event is > 20 hours old, it missed its morning window — send soon
  return (now.getTime() - created.getTime()) > 20 * 60 * 60 * 1000;
}

// ── Scheduled cleanup ──

let _cleanupInterval: ReturnType<typeof setInterval> | null = null;

export function startThrottleCleanup() {
  // Clean up old records daily
  _cleanupInterval = setInterval(() => {
    const removed = cleanupOldSends();
    if (removed > 0) log.info(`Cleaned up ${removed} old email_sends records`);
  }, 24 * 60 * 60 * 1000);

  // Initial cleanup after 2 min
  setTimeout(() => {
    const removed = cleanupOldSends();
    if (removed > 0) log.info(`Initial cleanup: ${removed} old email_sends records`);
  }, 2 * 60 * 1000);

  log.info(`Email throttle active — status digest at ${DIGEST_HOUR}:00 ${DIGEST_TZ}, audit cooldown 14d, global cap ${GLOBAL_DAILY_CAP}/day`);
}

export function stopThrottleCleanup() {
  if (_cleanupInterval) {
    clearInterval(_cleanupInterval);
    _cleanupInterval = null;
  }
}
