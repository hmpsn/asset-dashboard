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
    mocks.sendEmail.mockResolvedValue(true);
    mocks.listWorkspaces.mockReturnValue([
      {
        id: 'ws-1',
        name: 'Workspace One',
        clientEmail: 'client@example.com',
        trialEndsAt: '2026-05-29T12:00:00.000Z',
      },
    ]);
  });

  afterEach(async () => {
    const mod = await import('../../server/trial-reminders.js');
    mod.stopTrialReminders();
    vi.useRealTimers();
  });

  it('sends the day-10 warning when 4 days remain and links to Plans', async () => {
    const mod = await import('../../server/trial-reminders.js');
    mod.startTrialReminders();

    await vi.advanceTimersByTimeAsync(90_000);

    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(mocks.markReminderSent).toHaveBeenCalledWith('trial:ws-1:4');
    expect(mocks.renderDigest).toHaveBeenCalledWith('trial_expiry_warning', [
      expect.objectContaining({
        dashboardUrl: 'https://app.example.com/client/ws-1/plans',
        data: { daysRemaining: 4 },
      }),
    ]);
    expect(mocks.pruneReminders).toHaveBeenCalledWith('-30 days');
  });

  it('does not send the day-10 warning when 5 days remain', async () => {
    mocks.listWorkspaces.mockReturnValue([
      {
        id: 'ws-5',
        name: 'Workspace Five',
        clientEmail: 'five@example.com',
        trialEndsAt: '2026-05-30T12:00:00.000Z',
      },
    ]);

    const mod = await import('../../server/trial-reminders.js');
    mod.startTrialReminders();

    await vi.advanceTimersByTimeAsync(90_000);

    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.markReminderSent).not.toHaveBeenCalled();
  });

  it('skips sending when the 4-day reminder was already sent', async () => {
    mocks.hasReminder.mockImplementation((key: string) => key === 'trial:ws-1:4');

    const mod = await import('../../server/trial-reminders.js');
    mod.startTrialReminders();

    await vi.advanceTimersByTimeAsync(90_000);

    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.markReminderSent).not.toHaveBeenCalled();
  });

  it('skips workspaces without a client email', async () => {
    mocks.listWorkspaces.mockReturnValue([
      {
        id: 'ws-no-email',
        name: 'No Email Workspace',
        clientEmail: '',
        trialEndsAt: '2026-05-28T12:00:00.000Z',
      },
    ]);

    const mod = await import('../../server/trial-reminders.js');
    mod.startTrialReminders();

    await vi.advanceTimersByTimeAsync(90_000);

    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.markReminderSent).not.toHaveBeenCalled();
  });

  it('does not mark the reminder as sent when email delivery returns false', async () => {
    mocks.sendEmail.mockResolvedValue(false);

    const mod = await import('../../server/trial-reminders.js');
    mod.startTrialReminders();

    await vi.advanceTimersByTimeAsync(90_000);

    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(mocks.markReminderSent).not.toHaveBeenCalled();
  });

  it('omits dashboardUrl when the client portal URL is unavailable', async () => {
    mocks.getClientPortalUrl.mockReturnValue(undefined);

    const mod = await import('../../server/trial-reminders.js');
    mod.startTrialReminders();

    await vi.advanceTimersByTimeAsync(90_000);

    expect(mocks.renderDigest).toHaveBeenCalledWith('trial_expiry_warning', [
      expect.objectContaining({
        dashboardUrl: undefined,
        data: { daysRemaining: 4 },
      }),
    ]);
  });

  it('prioritizes 1-day reminder key when only one day remains', async () => {
    mocks.listWorkspaces.mockReturnValue([
      {
        id: 'ws-urgent',
        name: 'Urgent Workspace',
        clientEmail: 'urgent@example.com',
        trialEndsAt: '2026-05-26T00:01:00.000Z',
      },
    ]);

    const mod = await import('../../server/trial-reminders.js');
    mod.startTrialReminders();
    await vi.advanceTimersByTimeAsync(90_000);

    expect(mocks.markReminderSent).toHaveBeenCalledWith('trial:ws-urgent:1');
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
