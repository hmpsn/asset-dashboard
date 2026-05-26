import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  initEmailQueue: vi.fn(),
  startThrottleCleanup: vi.fn(),
  startScheduler: vi.fn(),
  startApprovalReminders: vi.fn(),
  startMonthlyReports: vi.fn(),
  startBackupScheduler: vi.fn(),
  clearTestModeCustomerIds: vi.fn(),
  startTrialReminders: vi.fn(),
  startChurnSignalScheduler: vi.fn(),
  startAnomalyDetection: vi.fn(),
  startOutcomeCrons: vi.fn(),
  startDataRetentionCrons: vi.fn(),
  startIntelligenceCrons: vi.fn(),
  startCompetitorMonitoringCron: vi.fn(),
  startRankTrackingScheduler: vi.fn(),
  startBriefingCron: vi.fn(),
}));

vi.mock('../../server/email.js', () => ({ initEmailQueue: mocks.initEmailQueue }));
vi.mock('../../server/email-throttle.js', () => ({ startThrottleCleanup: mocks.startThrottleCleanup }));
vi.mock('../../server/scheduled-audits.js', () => ({ startScheduler: mocks.startScheduler }));
vi.mock('../../server/approval-reminders.js', () => ({ startApprovalReminders: mocks.startApprovalReminders }));
vi.mock('../../server/monthly-report.js', () => ({ startMonthlyReports: mocks.startMonthlyReports }));
vi.mock('../../server/backup.js', () => ({ startBackupScheduler: mocks.startBackupScheduler }));
vi.mock('../../server/stripe.js', () => ({ clearTestModeCustomerIds: mocks.clearTestModeCustomerIds }));
vi.mock('../../server/trial-reminders.js', () => ({ startTrialReminders: mocks.startTrialReminders }));
vi.mock('../../server/churn-signals.js', () => ({ startChurnSignalScheduler: mocks.startChurnSignalScheduler }));
vi.mock('../../server/anomaly-detection.js', () => ({ startAnomalyDetection: mocks.startAnomalyDetection }));
vi.mock('../../server/outcome-crons.js', () => ({ startOutcomeCrons: mocks.startOutcomeCrons }));
vi.mock('../../server/data-retention.js', () => ({ startDataRetentionCrons: mocks.startDataRetentionCrons }));
vi.mock('../../server/intelligence-crons.js', () => ({
  startIntelligenceCrons: mocks.startIntelligenceCrons,
  startCompetitorMonitoringCron: mocks.startCompetitorMonitoringCron,
}));
vi.mock('../../server/rank-tracking-scheduler.js', () => ({
  startRankTrackingScheduler: mocks.startRankTrackingScheduler,
}));
vi.mock('../../server/briefing-cron.js', () => ({ startBriefingCron: mocks.startBriefingCron }));

describe('startup.startSchedulers', () => {
  it('starts all scheduler subsystems exactly once even if called twice', async () => {
    vi.resetModules();
    const { startSchedulers } = await import('../../server/startup.js');

    startSchedulers();
    startSchedulers();

    expect(mocks.initEmailQueue).toHaveBeenCalledTimes(1);
    expect(mocks.startThrottleCleanup).toHaveBeenCalledTimes(1);
    expect(mocks.startScheduler).toHaveBeenCalledTimes(1);
    expect(mocks.startApprovalReminders).toHaveBeenCalledTimes(1);
    expect(mocks.startMonthlyReports).toHaveBeenCalledTimes(1);
    expect(mocks.startBackupScheduler).toHaveBeenCalledTimes(1);
    expect(mocks.clearTestModeCustomerIds).toHaveBeenCalledTimes(1);
    expect(mocks.startTrialReminders).toHaveBeenCalledTimes(1);
    expect(mocks.startChurnSignalScheduler).toHaveBeenCalledTimes(1);
    expect(mocks.startAnomalyDetection).toHaveBeenCalledTimes(1);
    expect(mocks.startOutcomeCrons).toHaveBeenCalledTimes(1);
    expect(mocks.startDataRetentionCrons).toHaveBeenCalledTimes(1);
    expect(mocks.startIntelligenceCrons).toHaveBeenCalledTimes(1);
    expect(mocks.startCompetitorMonitoringCron).toHaveBeenCalledTimes(1);
    expect(mocks.startRankTrackingScheduler).toHaveBeenCalledTimes(1);
    expect(mocks.startBriefingCron).toHaveBeenCalledTimes(1);
  });
});
