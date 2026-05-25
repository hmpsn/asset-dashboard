import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
  getClientPortalUrl: vi.fn(),
  isEmailConfigured: vi.fn(),
  sendEmail: vi.fn(),
  renderDigest: vi.fn(),
  hasReminder: vi.fn(),
  markReminderSent: vi.fn(),
  pruneReminders: vi.fn(),
}));

vi.mock('../../server/workspaces.js', () => ({
  listWorkspaces: mocks.listWorkspaces,
  getClientPortalUrl: mocks.getClientPortalUrl,
}));

vi.mock('../../server/email.js', () => ({
  isEmailConfigured: mocks.isEmailConfigured,
  sendEmail: mocks.sendEmail,
}));

vi.mock('../../server/email-templates.js', () => ({
  renderDigest: mocks.renderDigest,
}));

vi.mock('../../server/sent-reminders-db.js', () => ({
  hasReminder: mocks.hasReminder,
  markReminderSent: mocks.markReminderSent,
  pruneReminders: mocks.pruneReminders,
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

describe('trial-reminders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-25T12:00:00.000Z'));

    mocks.isEmailConfigured.mockReturnValue(true);
    mocks.getClientPortalUrl.mockReturnValue('https://app.example.com/client/ws-1');
    mocks.hasReminder.mockReturnValue(false);
    mocks.renderDigest.mockReturnValue({ subject: 'Trial ending', html: '<p>Reminder</p>' });
    mocks.sendEmail.mockResolvedValue(undefined);
    mocks.listWorkspaces.mockReturnValue([
      {
        id: 'ws-1',
        name: 'Workspace One',
        clientEmail: 'client@example.com',
        trialEndsAt: '2026-05-28T12:00:00.000Z',
      },
    ]);
  });

  afterEach(async () => {
    const mod = await import('../../server/trial-reminders.js');
    mod.stopTrialReminders();
    vi.useRealTimers();
  });

  it('runs startup check once and sends reminder when trial is near expiry', async () => {
    const mod = await import('../../server/trial-reminders.js');
    mod.startTrialReminders();

    await vi.advanceTimersByTimeAsync(90_000);

    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(mocks.markReminderSent).toHaveBeenCalledWith('trial:ws-1:4');
    expect(mocks.pruneReminders).toHaveBeenCalledWith('-30 days');
  });

  it('does not run startup send after stop is called before the startup timeout', async () => {
    const mod = await import('../../server/trial-reminders.js');
    mod.startTrialReminders();
    mod.stopTrialReminders();

    await vi.advanceTimersByTimeAsync(90_000);

    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('is idempotent across duplicate start calls', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const mod = await import('../../server/trial-reminders.js');

    mod.startTrialReminders();
    mod.startTrialReminders();

    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });
});
