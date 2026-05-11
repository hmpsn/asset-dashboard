import { afterEach, describe, expect, it, vi } from 'vitest';
import db from '../../server/db/index.js';
import {
  canSend,
  cleanupOldSends,
  getLastSendTime,
  getThrottleCategory,
  isMorningWindow,
  isOverdueForMorning,
  msUntilMorning,
  recordSend,
  startThrottleCleanup,
  stopThrottleCleanup,
} from '../../server/email-throttle.js';
import type { EmailEventType } from '../../server/email-templates.js';
import type { ThrottleCategory } from '../../server/email-throttle.js';

const RECIPIENT_PREFIX = 'email-throttle-test';
const WORKSPACE_ID = 'email-throttle-ws';

function recipient(name: string): string {
  return `${RECIPIENT_PREFIX}-${name}@example.com`;
}

function cleanup(): void {
  db.prepare(`DELETE FROM email_sends WHERE recipient LIKE ?`).run(`${RECIPIENT_PREFIX}-%`);
}

function insertSend(
  to: string,
  category: ThrottleCategory,
  sentAt: string,
  emailType = 'approval_ready',
): void {
  const actualSentAt = sentAt === 'now'
    ? (db.prepare(`SELECT datetime('now') AS now`).get() as { now: string }).now
    : sentAt;
  db.prepare(`
    INSERT INTO email_sends (recipient, category, email_type, workspace_id, event_count, sent_at)
    VALUES (?, ?, ?, ?, 1, ?)
  `).run(to, category, emailType, WORKSPACE_ID, actualSentAt);
}

afterEach(() => {
  stopThrottleCleanup();
  vi.useRealTimers();
  cleanup();
});

describe('email throttle', () => {
  it('maps email event types to throttle categories with action as the fallback', () => {
    expect(getThrottleCategory('request_status')).toBe('status');
    expect(getThrottleCategory('audit_complete')).toBe('audit');
    expect(getThrottleCategory('approval_ready')).toBe('action');
    expect(getThrottleCategory('anomaly_alert')).toBe('alert');
    expect(getThrottleCategory('password_reset')).toBe('transactional');
    expect(getThrottleCategory('request_new')).toBe('internal');
    expect(getThrottleCategory('action_approved')).toBe('internal');
    expect(getThrottleCategory('client_briefing_ready')).toBe('internal');
    expect(getThrottleCategory('unknown_type' as EmailEventType)).toBe('action');
  });

  it('always allows transactional, internal, and report categories', () => {
    const to = recipient('bypass');
    for (let i = 0; i < 8; i += 1) {
      recordSend(to, 'action', 'approval_ready', WORKSPACE_ID);
    }

    expect(canSend(to, 'transactional')).toEqual({ allowed: true });
    expect(canSend(to, 'internal')).toEqual({ allowed: true });
    expect(canSend(to, 'report')).toEqual({ allowed: true });
  });

  it('blocks status, audit, alert, and action categories at their category limits', () => {
    const statusTo = recipient('status-limit');
    recordSend(statusTo, 'status', 'request_status', WORKSPACE_ID);
    expect(canSend(statusTo, 'status')).toMatchObject({
      allowed: false,
      reason: 'status: 1/1 in last 1d',
    });

    const auditTo = recipient('audit-limit');
    recordSend(auditTo, 'audit', 'audit_complete', WORKSPACE_ID);
    expect(canSend(auditTo, 'audit')).toMatchObject({
      allowed: false,
      reason: 'audit: 1/1 in last 14d',
    });

    const alertTo = recipient('alert-limit');
    recordSend(alertTo, 'alert', 'anomaly_alert', WORKSPACE_ID);
    expect(canSend(alertTo, 'alert')).toMatchObject({
      allowed: false,
      reason: 'alert: 1/1 in last 1d',
    });

    const actionTo = recipient('action-limit');
    recordSend(actionTo, 'action', 'approval_ready', WORKSPACE_ID);
    recordSend(actionTo, 'action', 'content_brief_ready', WORKSPACE_ID);
    recordSend(actionTo, 'action', 'content_post_ready', WORKSPACE_ID);
    expect(canSend(actionTo, 'action')).toMatchObject({
      allowed: false,
      reason: 'action: 3/3 in last 1d',
    });
  });

  it('allows sends again when category-specific records are outside the throttle window', () => {
    const to = recipient('expired-window');
    insertSend(to, 'status', '2026-01-01 00:00:00', 'request_status');

    expect(canSend(to, 'status')).toEqual({ allowed: true });
  });

  it('enforces the global daily cap for non-exempt client email categories', () => {
    const to = recipient('global-cap');
    insertSend(to, 'status', 'now', 'request_status');
    insertSend(to, 'audit', 'now', 'audit_complete');
    insertSend(to, 'action', 'now', 'approval_ready');
    insertSend(to, 'action', 'now', 'content_brief_ready');
    insertSend(to, 'alert', 'now', 'anomaly_alert');

    expect(canSend(to, 'action')).toMatchObject({
      allowed: false,
      reason: 'global daily cap: 5/5',
    });
  });

  it('does not count transactional, internal, or report rows toward the global cap', () => {
    const to = recipient('global-exemptions');
    for (let i = 0; i < 3; i += 1) {
      insertSend(to, 'transactional', 'now', 'password_reset');
      insertSend(to, 'internal', 'now', 'request_new');
      insertSend(to, 'report', 'now', 'monthly_report');
    }

    expect(canSend(to, 'action')).toEqual({ allowed: true });
  });

  it('records sends, returns the last send time, and cleans up old rows', () => {
    const to = recipient('records');

    expect(getLastSendTime(to, 'action')).toBeNull();
    recordSend(to, 'action', 'approval_ready', WORKSPACE_ID, 2);

    const row = db.prepare(`
      SELECT category, email_type, workspace_id, event_count
      FROM email_sends
      WHERE recipient = ?
    `).get(to) as {
      category: string;
      email_type: string;
      workspace_id: string;
      event_count: number;
    };
    expect(row).toEqual({
      category: 'action',
      email_type: 'approval_ready',
      workspace_id: WORKSPACE_ID,
      event_count: 2,
    });
    expect(getLastSendTime(to, 'action')).toBeInstanceOf(Date);

    db.prepare(`UPDATE email_sends SET sent_at = ? WHERE recipient = ?`)
      .run('2026-01-01 00:00:00', to);
    expect(cleanupOldSends()).toBeGreaterThanOrEqual(1);
    expect(getLastSendTime(to, 'action')).toBeNull();
  });

  it('detects restored morning-digest events that are overdue', () => {
    const old = new Date(Date.now() - 21 * 60 * 60 * 1000).toISOString();
    const recent = new Date(Date.now() - 19 * 60 * 60 * 1000).toISOString();

    expect(isOverdueForMorning(old)).toBe(true);
    expect(isOverdueForMorning(recent)).toBe(false);
  });

  it('computes the next morning digest delay and active window in the configured timezone', () => {
    vi.useFakeTimers();

    vi.setSystemTime(new Date('2026-05-05T12:45:00.000Z'));
    expect(msUntilMorning()).toBe(15 * 60 * 1000);
    expect(isMorningWindow()).toBe(false);

    vi.setSystemTime(new Date('2026-05-05T13:10:00.000Z'));
    expect(isMorningWindow()).toBe(true);

    vi.setSystemTime(new Date('2026-05-05T13:31:00.000Z'));
    expect(isMorningWindow()).toBe(false);
  });

  it('starts scheduled cleanup and removes old email send records on the initial timer', () => {
    vi.useFakeTimers();
    const to = recipient('scheduled-cleanup');
    insertSend(to, 'action', '2026-01-01 00:00:00', 'approval_ready');

    startThrottleCleanup();
    vi.advanceTimersByTime(2 * 60 * 1000);

    expect(getLastSendTime(to, 'action')).toBeNull();
  });
});
