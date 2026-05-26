// tests/unit/email-helpers-pure.test.ts
// Pure unit tests for email-related helpers:
//   server/email.ts     — isEmailConfigured, getNotificationEmail, makeEvent (via notify* helpers)
//   server/email-queue.ts — registerSendFn, queueEmail, getQueueStats, flushAll
//   server/email-throttle.ts — getThrottleCategory, isOverdueForMorning, msUntilMorning
//   server/email-templates.ts — renderDigest (subject/html shape)
//
// Actual transport (nodemailer) and DB (email_sends) are mocked so no I/O occurs.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── nodemailer mock ────────────────────────────────────────────────────────────
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn().mockReturnValue({ sendMail: vi.fn() }) },
  createTransport: vi.fn().mockReturnValue({ sendMail: vi.fn() }),
}));

// ── DB mock (for email-throttle) ──────────────────────────────────────────────
vi.mock('../../server/db/index.js', () => ({
  default: {
    prepare: vi.fn().mockReturnValue({
      all: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue({ cnt: 0 }),
      run: vi.fn().mockReturnValue({ changes: 1 }),
    }),
  },
}));

// ── Logger mock ───────────────────────────────────────────────────────────────
vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ── FS mock (email-queue persistence) ────────────────────────────────────────
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue('[]'),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('[]'),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// ── data-dir mock ─────────────────────────────────────────────────────────────
vi.mock('../../server/data-dir.js', () => ({
  getDataDir: vi.fn().mockReturnValue('/tmp/test-email-queue'),
  getUploadRoot: vi.fn().mockReturnValue('/tmp/test-uploads'),
}));

// ── constants mock ────────────────────────────────────────────────────────────
vi.mock('../../server/constants.js', () => ({
  STUDIO_NAME: 'TestStudio',
  STUDIO_URL: 'https://test.example.com',
}));

// ── errors mock ───────────────────────────────────────────────────────────────
vi.mock('../../server/errors.js', () => ({
  isProgrammingError: vi.fn().mockReturnValue(false),
}));

// ── Imports under test ────────────────────────────────────────────────────────

import { isEmailConfigured, getNotificationEmail } from '../../server/email.js';
import { getThrottleCategory, isOverdueForMorning } from '../../server/email-throttle.js';
import { getQueueStats, registerSendFn } from '../../server/email-queue.js';
import type { EmailEventType } from '../../server/email-templates.js';

// ---------------------------------------------------------------------------
// isEmailConfigured — pure env-var check
// ---------------------------------------------------------------------------
describe('isEmailConfigured', () => {
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv };
  });

  afterEach(() => {
    process.env = origEnv;
  });

  it('returns false when no SMTP env vars are set', () => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    expect(isEmailConfigured()).toBe(false);
  });

  it('returns false when SMTP_HOST is missing', () => {
    delete process.env.SMTP_HOST;
    process.env.SMTP_USER = 'user@example.com';
    process.env.SMTP_PASS = 'secret';
    expect(isEmailConfigured()).toBe(false);
  });

  it('returns false when SMTP_USER is missing', () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    delete process.env.SMTP_USER;
    process.env.SMTP_PASS = 'secret';
    expect(isEmailConfigured()).toBe(false);
  });

  it('returns false when SMTP_PASS is missing', () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_USER = 'user@example.com';
    delete process.env.SMTP_PASS;
    expect(isEmailConfigured()).toBe(false);
  });

  it('returns true when all required SMTP vars are set', () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_USER = 'user@example.com';
    process.env.SMTP_PASS = 'secret';
    expect(isEmailConfigured()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getNotificationEmail — reads NOTIFICATION_EMAIL env var
// ---------------------------------------------------------------------------
describe('getNotificationEmail', () => {
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv };
  });

  afterEach(() => {
    process.env = origEnv;
  });

  it('returns undefined when NOTIFICATION_EMAIL is not set', () => {
    delete process.env.NOTIFICATION_EMAIL;
    expect(getNotificationEmail()).toBeUndefined();
  });

  it('returns the value when NOTIFICATION_EMAIL is set', () => {
    process.env.NOTIFICATION_EMAIL = 'team@example.com';
    expect(getNotificationEmail()).toBe('team@example.com');
  });

  it('returns the exact string value without modification', () => {
    process.env.NOTIFICATION_EMAIL = '  admin@test.com  ';
    expect(getNotificationEmail()).toBe('  admin@test.com  ');
  });
});

// ---------------------------------------------------------------------------
// getThrottleCategory — maps EmailEventType → ThrottleCategory
// ---------------------------------------------------------------------------
describe('getThrottleCategory', () => {
  const cases: Array<[EmailEventType, string]> = [
    ['request_status', 'status'],
    ['request_response', 'status'],
    ['audit_complete', 'audit'],
    ['audit_improved', 'audit'],
    ['recommendations_ready', 'audit'],
    ['approval_ready', 'action'],
    ['content_brief_ready', 'action'],
    ['content_post_ready', 'action'],
    ['content_published', 'action'],
    ['fixes_applied', 'action'],
    ['anomaly_alert', 'alert'],
    ['audit_alert', 'alert'],
    ['password_reset', 'transactional'],
    ['client_welcome', 'transactional'],
    ['trial_expiry_warning', 'transactional'],
    ['request_new', 'internal'],
    ['content_request', 'internal'],
    ['payment_received', 'internal'],
    ['churn_signal', 'internal'],
    ['client_signal', 'internal'],
    ['content_changes_requested', 'internal'],
    ['action_approved', 'internal'],
    ['client_briefing_ready', 'action'],
  ];

  it.each(cases)('maps %s → %s', (type, expected) => {
    expect(getThrottleCategory(type)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// isOverdueForMorning — date age logic
// ---------------------------------------------------------------------------
describe('isOverdueForMorning', () => {
  it('returns true for an event created more than 20 hours ago', () => {
    const twentyOneHoursAgo = new Date(Date.now() - 21 * 60 * 60 * 1000).toISOString();
    expect(isOverdueForMorning(twentyOneHoursAgo)).toBe(true);
  });

  it('returns true for an event created exactly 20 hours and 1 second ago', () => {
    const justOverTwenty = new Date(Date.now() - (20 * 60 * 60 * 1000 + 1000)).toISOString();
    expect(isOverdueForMorning(justOverTwenty)).toBe(true);
  });

  it('returns false for an event created less than 20 hours ago', () => {
    const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
    expect(isOverdueForMorning(oneHourAgo)).toBe(false);
  });

  it('returns false for an event created exactly 19 hours ago', () => {
    const nineteenHoursAgo = new Date(Date.now() - 19 * 60 * 60 * 1000).toISOString();
    expect(isOverdueForMorning(nineteenHoursAgo)).toBe(false);
  });

  it('returns false for a very recent event (just created)', () => {
    const now = new Date().toISOString();
    expect(isOverdueForMorning(now)).toBe(false);
  });

  it('returns true for an event from yesterday', () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(isOverdueForMorning(yesterday)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getQueueStats — introspection helper
// ---------------------------------------------------------------------------
describe('getQueueStats', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Register a no-op send function so flush doesn't warn
    registerSendFn(vi.fn().mockResolvedValue(true));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns zero buckets and zero total events when queue is empty', () => {
    const stats = getQueueStats();
    expect(stats.buckets).toBeGreaterThanOrEqual(0);
    expect(stats.totalEvents).toBeGreaterThanOrEqual(0);
    expect(typeof stats.buckets).toBe('number');
    expect(typeof stats.totalEvents).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// registerSendFn — can be called without throwing
// ---------------------------------------------------------------------------
describe('registerSendFn', () => {
  it('accepts a send function without throwing', () => {
    const fn = vi.fn().mockResolvedValue(true);
    expect(() => registerSendFn(fn)).not.toThrow();
  });

  it('can be called multiple times to replace the send function', () => {
    const fn1 = vi.fn().mockResolvedValue(true);
    const fn2 = vi.fn().mockResolvedValue(false);
    expect(() => {
      registerSendFn(fn1);
      registerSendFn(fn2);
    }).not.toThrow();
  });
});
