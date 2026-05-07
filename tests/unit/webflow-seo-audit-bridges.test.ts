import { beforeEach, describe, expect, it, vi } from 'vitest';

type BridgeCallback = () => Promise<{ modified: number } | void> | { modified: number } | void;

const mocks = vi.hoisted(() => ({
  callbacks: [] as Array<{ flag: string; workspaceId: string; callback: BridgeCallback }>,
  fireBridge: vi.fn((flag: string, workspaceId: string, callback: BridgeCallback) => {
    mocks.callbacks.push({ flag, workspaceId, callback });
  }),
  updatePageState: vi.fn(),
  applySuppressionsToAudit: vi.fn((audit: unknown) => audit),
  toAuditFindingPageId: vi.fn((page: { pageId: string; slug?: string; url?: string }) => page.pageId),
  getInsights: vi.fn(() => []),
  resolveInsight: vi.fn(),
  upsertInsight: vi.fn(),
  getInsight: vi.fn(() => null),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../server/bridge-infrastructure.js', () => ({ fireBridge: mocks.fireBridge }));
vi.mock('../../server/helpers.js', () => ({
  applySuppressionsToAudit: mocks.applySuppressionsToAudit,
  toAuditFindingPageId: mocks.toAuditFindingPageId,
}));
vi.mock('../../server/logger.js', () => ({ createLogger: vi.fn(() => mocks.logger) }));
vi.mock('../../server/workspaces.js', () => ({ updatePageState: mocks.updatePageState }));
vi.mock('../../server/analytics-insights-store.js', () => ({
  getInsights: mocks.getInsights,
  getInsight: mocks.getInsight,
  resolveInsight: mocks.resolveInsight,
  upsertInsight: mocks.upsertInsight,
}));

const { handleOnDemandSeoAuditResult } = await import('../../server/webflow-seo-audit-bridges.js');

const workspace = {
  id: 'ws_1',
  name: 'Workspace',
  webflowSiteId: 'site_1',
};

const audit = {
  siteScore: 55,
  totalPages: 2,
  errors: 1,
  warnings: 1,
  infos: 0,
  pages: [
    {
      pageId: 'page_1',
      page: 'Services',
      slug: 'services',
      url: 'https://example.com/services',
      issues: [{ check: 'title', severity: 'error', message: 'Missing title' }],
    },
    {
      pageId: 'page_2',
      page: 'About',
      slug: 'about',
      url: 'https://example.com/about',
      issues: [],
    },
  ],
  siteWideIssues: [],
};

describe('webflow SEO audit bridge handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.callbacks.length = 0;
    mocks.applySuppressionsToAudit.mockImplementation((value: unknown) => value);
    mocks.toAuditFindingPageId.mockImplementation((page: { pageId: string; slug?: string; url?: string }) => page.pageId);
    mocks.getInsights.mockReturnValue([]);
    mocks.getInsight.mockReturnValue(null);
  });

  it('marks pages with audit issues and registers audit bridges', () => {
    handleOnDemandSeoAuditResult(workspace, audit);

    expect(mocks.updatePageState).toHaveBeenCalledWith('ws_1', 'page_1', {
      status: 'issue-detected',
      source: 'audit',
      slug: 'services',
      auditIssues: ['title'],
      updatedBy: 'system',
    });
    expect(mocks.updatePageState).toHaveBeenCalledTimes(1);
    expect(mocks.callbacks.map(c => c.flag)).toEqual([
      'bridge-audit-auto-resolve',
      'bridge-audit-page-health',
      'bridge-audit-site-health',
    ]);
    expect(mocks.callbacks.length > 0 && mocks.callbacks.every(c => c.workspaceId === 'ws_1')).toBe(true);
  });

  it('creates page-level audit findings while preserving existing score adjustments', async () => {
    mocks.getInsight.mockReturnValue({
      resolutionStatus: 'open',
      data: { _scoreAdjustments: { anomaly: 7 } },
    });

    handleOnDemandSeoAuditResult(workspace, audit);
    const pageBridge = mocks.callbacks.find(c => c.flag === 'bridge-audit-page-health');
    expect(pageBridge).toBeDefined();

    const result = await pageBridge!.callback();

    expect(result).toEqual({ modified: 1 });
    expect(mocks.upsertInsight).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws_1',
      insightType: 'audit_finding',
      pageId: 'page_1',
      pageTitle: 'Services',
      severity: 'critical',
      impactScore: 87,
      bridgeSource: 'bridge-audit-page-health',
      data: expect.objectContaining({
        scope: 'page',
        issueCount: 1,
        issueMessages: 'Missing title',
        _originalBaseScore: 80,
        _scoreAdjustments: { anomaly: 7 },
      }),
    }));
  });

  it('creates site-level audit findings below the healthy threshold', async () => {
    handleOnDemandSeoAuditResult(workspace, audit);
    const siteBridge = mocks.callbacks.find(c => c.flag === 'bridge-audit-site-health');
    expect(siteBridge).toBeDefined();

    const result = await siteBridge!.callback();

    expect(result).toEqual({ modified: 1 });
    expect(mocks.upsertInsight).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws_1',
      insightType: 'audit_finding',
      pageId: null,
      severity: 'warning',
      impactScore: 45,
      bridgeSource: 'bridge-audit-site-health',
      data: expect.objectContaining({
        scope: 'site',
        issueCount: 2,
        siteScore: 55,
      }),
    }));
  });

  it('does not create site-level audit findings for healthy scores', async () => {
    handleOnDemandSeoAuditResult(workspace, {
      ...audit,
      siteScore: 74,
    });
    const siteBridge = mocks.callbacks.find(c => c.flag === 'bridge-audit-site-health');
    expect(siteBridge).toBeDefined();

    const result = await siteBridge!.callback();

    expect(result).toEqual({ modified: 0 });
    expect(mocks.upsertInsight).not.toHaveBeenCalled();
  });

  it('applies audit suppressions before registering bridge callbacks', () => {
    const suppressedAudit = {
      ...audit,
      siteScore: 91,
      errors: 0,
      warnings: 0,
      pages: [],
    };
    mocks.applySuppressionsToAudit.mockReturnValueOnce(suppressedAudit);

    handleOnDemandSeoAuditResult({
      ...workspace,
      auditSuppressions: [{
        check: 'title',
        pageSlug: 'services',
        reason: 'Known exception',
        createdAt: '2026-05-05T00:00:00.000Z',
      }],
    }, audit);

    expect(mocks.applySuppressionsToAudit).toHaveBeenCalledWith(audit, [{
      check: 'title',
      pageSlug: 'services',
      reason: 'Known exception',
      createdAt: '2026-05-05T00:00:00.000Z',
    }]);
  });

  it('auto-resolves stale audit findings for now-clean pages', async () => {
    mocks.getInsights.mockReturnValue([
      {
        id: 'insight_1',
        insightType: 'audit_finding',
        resolutionStatus: 'open',
        bridgeSource: 'bridge-audit-page-health',
        pageId: 'page_2',
        data: { scope: 'page' },
      },
    ]);

    handleOnDemandSeoAuditResult(workspace, audit);
    const autoResolveBridge = mocks.callbacks.find(c => c.flag === 'bridge-audit-auto-resolve');
    expect(autoResolveBridge).toBeDefined();

    const result = await autoResolveBridge!.callback();

    expect(result).toEqual({ modified: 1 });
    expect(mocks.resolveInsight).toHaveBeenCalledWith(
      'insight_1',
      'ws_1',
      'resolved',
      'Auto-resolved: page passed audit with no critical/warning issues',
      'bridge-audit-auto-resolve',
    );
  });
});
