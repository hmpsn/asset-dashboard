import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
  getUploadRoot: vi.fn(),
  applySuppressionsToAudit: vi.fn((audit: unknown) => audit),
  getLatestSnapshot: vi.fn(),
  listActivity: vi.fn(),
  listRequests: vi.fn(),
  listBatches: vi.fn(),
  isEmailConfigured: vi.fn(),
  sendEmail: vi.fn(),
  recordSend: vi.fn(),
  renderMonthlyReport: vi.fn(),
  getSearchPeriodComparison: vi.fn(),
  getGA4PeriodComparison: vi.fn(),
  listSessions: vi.fn(),
  getDataDir: vi.fn(),
}));

vi.mock('../../server/workspaces.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/workspaces.js')>();
  return {
    ...actual,
    listWorkspaces: mocks.listWorkspaces,
    getUploadRoot: mocks.getUploadRoot,
    // Source now resolves by indexed getWorkspace(id) instead of listWorkspaces().find;
    // delegate to the same mock data each test sets via listWorkspaces.
    getWorkspace: vi.fn((id: string) => mocks.listWorkspaces().find((w: { id: string }) => w.id === id)),
  };
});
vi.mock('../../server/helpers.js', () => ({
  applySuppressionsToAudit: mocks.applySuppressionsToAudit,
}));
vi.mock('../../server/reports.js', () => ({
  getLatestSnapshot: mocks.getLatestSnapshot,
}));
vi.mock('../../server/activity-log.js', () => ({
  listActivity: mocks.listActivity,
}));
vi.mock('../../server/requests.js', () => ({
  listRequests: mocks.listRequests,
}));
vi.mock('../../server/approvals.js', () => ({
  listBatches: mocks.listBatches,
}));
vi.mock('../../server/email.js', () => ({
  isEmailConfigured: mocks.isEmailConfigured,
  sendEmail: mocks.sendEmail,
}));
vi.mock('../../server/email-throttle.js', () => ({
  recordSend: mocks.recordSend,
}));
vi.mock('../../server/email-templates.js', () => ({
  renderMonthlyReport: mocks.renderMonthlyReport,
}));
vi.mock('../../server/search-console.js', () => ({
  getSearchPeriodComparison: mocks.getSearchPeriodComparison,
}));
vi.mock('../../server/google-analytics.js', () => ({
  getGA4PeriodComparison: mocks.getGA4PeriodComparison,
}));
vi.mock('../../server/chat-memory.js', () => ({
  listSessions: mocks.listSessions,
}));
vi.mock('../../server/data-dir.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/data-dir.js')>();
  return {
    ...actual,
    getDataDir: mocks.getDataDir,
  };
});
vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

describe('monthly-report trigger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUploadRoot.mockReturnValue('/tmp');
    mocks.getDataDir.mockReturnValue('/tmp/monthly-reports');
    mocks.listWorkspaces.mockReturnValue([
      {
        id: 'ws-1',
        name: 'Workspace One',
        clientEmail: 'client@example.com',
        autoReports: true,
        autoReportFrequency: 'monthly',
      },
    ]);
    mocks.getLatestSnapshot.mockReturnValue(null);
    mocks.listActivity.mockReturnValue([]);
    mocks.listRequests.mockReturnValue([]);
    mocks.listBatches.mockReturnValue([]);
    mocks.listSessions.mockReturnValue([]);
    mocks.isEmailConfigured.mockReturnValue(true);
    mocks.renderMonthlyReport.mockReturnValue({
      subject: 'Monthly Report',
      html: '<html><body>Monthly report</body></html>',
    });
    mocks.sendEmail.mockResolvedValue(undefined);
  });

  it('records send exactly once when triggerMonthlyReport sends an email', async () => {
    const { triggerMonthlyReport } = await import('../../server/monthly-report.js');
    const result = await triggerMonthlyReport('ws-1');

    expect(result.sent).toBe(true);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(mocks.recordSend).toHaveBeenCalledTimes(1);
    expect(mocks.recordSend).toHaveBeenCalledWith(
      'client@example.com',
      'report',
      'monthly_report',
      'ws-1',
      1,
    );
  });
});
