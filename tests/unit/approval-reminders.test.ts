import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalBatch, ApprovalItem } from '../../shared/types/approvals.js';
import type { Workspace } from '../../shared/types/workspace.js';

const mocks = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
  getClientPortalUrl: vi.fn(),
  listBatches: vi.fn(),
  isEmailConfigured: vi.fn(),
  sendEmail: vi.fn(),
  canSend: vi.fn(),
  recordSend: vi.fn(),
  getReminderSentAt: vi.fn(),
  upsertReminder: vi.fn(),
  deleteReminder: vi.fn(),
  pruneReminders: vi.fn(),
  logInfo: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('../../server/workspaces.js', () => ({
  listWorkspaces: mocks.listWorkspaces,
  getClientPortalUrl: mocks.getClientPortalUrl,
}));

vi.mock('../../server/approvals.js', () => ({
  listBatches: mocks.listBatches,
}));

vi.mock('../../server/email.js', () => ({
  isEmailConfigured: mocks.isEmailConfigured,
  sendEmail: mocks.sendEmail,
}));

vi.mock('../../server/email-throttle.js', () => ({
  canSend: mocks.canSend,
  recordSend: mocks.recordSend,
}));

vi.mock('../../server/sent-reminders-db.js', () => ({
  getReminderSentAt: mocks.getReminderSentAt,
  upsertReminder: mocks.upsertReminder,
  deleteReminder: mocks.deleteReminder,
  pruneReminders: mocks.pruneReminders,
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    info: mocks.logInfo,
    error: mocks.logError,
  }),
}));

const {
  checkStaleApprovals,
  startApprovalReminders,
  stopApprovalReminders,
} = await import('../../server/approval-reminders.js');

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'ws_approval_reminder',
    name: 'Acme Studio',
    clientEmail: 'client@example.com',
    clientPortalEnabled: true,
    ...overrides,
  } as Workspace;
}

function item(overrides: Partial<ApprovalItem> = {}): ApprovalItem {
  return {
    id: 'item_1',
    pageId: 'page_1',
    pageTitle: 'Home',
    pageSlug: '/',
    field: 'seoTitle',
    currentValue: 'Old title',
    proposedValue: 'New title',
    status: 'pending',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

function batch(overrides: Partial<ApprovalBatch> = {}): ApprovalBatch {
  return {
    id: 'batch_1',
    workspaceId: 'ws_approval_reminder',
    siteId: 'site_1',
    name: 'Homepage SEO',
    items: [item()],
    status: 'pending',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-05T12:00:00.000Z'));

  mocks.listWorkspaces.mockReturnValue([workspace()]);
  mocks.getClientPortalUrl.mockReturnValue('https://dashboard.example.com/client/ws_approval_reminder');
  mocks.listBatches.mockReturnValue([]);
  mocks.isEmailConfigured.mockReturnValue(true);
  mocks.sendEmail.mockResolvedValue(undefined);
  mocks.canSend.mockReturnValue({ allowed: true });
  mocks.getReminderSentAt.mockReturnValue(null);
});

afterEach(() => {
  stopApprovalReminders();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('approval reminders', () => {
  it('sends stale pending approval reminders and records successful sends', async () => {
    mocks.listBatches.mockReturnValue([
      batch({
        items: [
          item({ id: 'item_1' }),
          item({ id: 'item_2' }),
          item({ id: 'item_3', status: 'approved' }),
        ],
      }),
    ]);

    await checkStaleApprovals();

    expect(mocks.sendEmail).toHaveBeenCalledWith(
      'client@example.com',
      'Reminder: 2 SEO changes awaiting your approval — Acme Studio',
      expect.stringContaining('https://dashboard.example.com/client/ws_approval_reminder'),
    );
    expect(mocks.recordSend).toHaveBeenCalledWith(
      'client@example.com',
      'action',
      'approval_reminder',
      'ws_approval_reminder',
      1,
    );
    expect(mocks.upsertReminder).toHaveBeenCalledWith('approval:batch_1');
    expect(mocks.pruneReminders).toHaveBeenCalledWith('-7 days');
  });

  it('does not mark reminders as sent when outbound email is disabled', async () => {
    mocks.isEmailConfigured.mockReturnValue(false);
    mocks.listBatches.mockReturnValue([batch()]);

    await checkStaleApprovals();

    expect(mocks.listWorkspaces).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.recordSend).not.toHaveBeenCalled();
    expect(mocks.upsertReminder).not.toHaveBeenCalled();
    expect(mocks.pruneReminders).toHaveBeenCalledWith('-7 days');
  });

  it('does not mark reminders as sent if email becomes disabled before send', async () => {
    mocks.isEmailConfigured
      .mockReturnValueOnce(true)
      .mockReturnValue(false);
    mocks.listBatches.mockReturnValue([batch()]);

    await checkStaleApprovals();

    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.recordSend).not.toHaveBeenCalled();
    expect(mocks.upsertReminder).not.toHaveBeenCalled();
  });

  it('skips batches that are not stale enough or have no pending items', async () => {
    mocks.listBatches.mockReturnValue([
      batch({ id: 'fresh_batch', createdAt: '2026-05-03T12:00:00.000Z' }),
      batch({ id: 'approved_batch', items: [item({ status: 'approved' })] }),
    ]);

    await checkStaleApprovals();

    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.recordSend).not.toHaveBeenCalled();
    expect(mocks.upsertReminder).not.toHaveBeenCalled();
  });

  it('skips recently reminded batches without recording another send', async () => {
    mocks.getReminderSentAt.mockReturnValue('2026-05-04T12:00:00.000Z');
    mocks.listBatches.mockReturnValue([batch()]);

    await checkStaleApprovals();

    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.recordSend).not.toHaveBeenCalled();
    expect(mocks.upsertReminder).not.toHaveBeenCalled();
  });

  it('respects throttle blocks before sending or marking reminders', async () => {
    mocks.canSend.mockReturnValue({ allowed: false, reason: 'global daily cap: 5/5' });
    mocks.listBatches.mockReturnValue([batch()]);

    await checkStaleApprovals();

    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.recordSend).not.toHaveBeenCalled();
    expect(mocks.upsertReminder).not.toHaveBeenCalled();
    expect(mocks.logInfo).toHaveBeenCalledWith(
      'Throttled approval reminder to client@example.com: global daily cap: 5/5',
    );
  });

  it('deletes reminder state for applied batches', async () => {
    mocks.listBatches.mockReturnValue([
      batch({ id: 'applied_batch', status: 'applied' }),
    ]);

    await checkStaleApprovals();

    expect(mocks.deleteReminder).toHaveBeenCalledWith('approval:applied_batch');
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.upsertReminder).not.toHaveBeenCalled();
  });

  it('starts the reminder timers only once and stops them cleanly', () => {
    startApprovalReminders();
    startApprovalReminders();

    expect(vi.getTimerCount()).toBe(2);

    stopApprovalReminders();

    expect(vi.getTimerCount()).toBe(0);
  });
});
