import { describe, it, expect, beforeEach } from 'vitest';
import db from '../../server/db/index.js';
import {
  completeDiagnosticReport,
  createDiagnosticReport,
  deleteDiagnosticReportsByWorkspace,
  getDiagnosticReport,
  getReportForInsight,
  listDiagnosticReports,
  markDiagnosticFailed,
  recoverStuckDiagnosticReports,
} from '../../server/diagnostic-store.js';
import type { DiagnosticContext } from '../../shared/types/diagnostics.js';

const WS_ID = 'diagnostic-store-ws';
const OTHER_WS_ID = 'diagnostic-store-other-ws';

const diagnosticContext: DiagnosticContext = {
  anomaly: {
    type: 'traffic_drop',
    severity: 'critical',
    metric: 'clicks',
    currentValue: 100,
    expectedValue: 500,
    deviationPercent: -80,
    firstDetected: '2026-05-05T00:00:00.000Z',
  },
  positionHistory: [],
  queryBreakdown: [],
  redirectProbe: { chain: [], finalStatus: 200, canonical: null, isSoftFourOhFour: false },
  internalLinks: { count: 4, siteMedian: 8, topLinkingPages: ['/'], deficit: 4 },
  backlinks: { totalBacklinks: 12, referringDomains: 3, topDomains: [], recentlyLost: 1 },
  siteBaselines: { avgInternalLinks: 8, medianPosition: 12, totalBacklinks: 12 },
  recentActivity: [],
  concurrentAnomalies: [],
  existingInsights: [],
  periodComparison: {
    current: { clicks: 100, impressions: 1000, ctr: 10, position: 8 },
    previous: { clicks: 500, impressions: 2000, ctr: 25, position: 4 },
    changePercent: { clicks: -80, impressions: -50, ctr: -60, position: 100 },
  },
  unavailableSources: [],
};

describe('diagnostic-store', () => {
  beforeEach(() => {
    db.prepare("DELETE FROM diagnostic_reports WHERE workspace_id LIKE 'diagnostic-store-%'").run();
  });

  it('creates, retrieves, lists, and finds reports by insight', () => {
    const report = createDiagnosticReport(WS_ID, 'insight-1', 'traffic_drop', ['/services']);

    expect(report.status).toBe('running');
    expect(report.affectedPages).toEqual(['/services']);
    expect(getDiagnosticReport(report.id)?.workspaceId).toBe(WS_ID);
    expect(getReportForInsight(WS_ID, 'insight-1')?.id).toBe(report.id);
    expect(listDiagnosticReports(WS_ID)).toHaveLength(1);
    expect(getReportForInsight(WS_ID, 'missing')).toBeNull();
  });

  it('marks a report failed with an error message', () => {
    const report = createDiagnosticReport(WS_ID, 'insight-fail', 'traffic_drop', []);
    markDiagnosticFailed(report.id, 'Probe failed');

    expect(getDiagnosticReport(report.id)).toMatchObject({ status: 'failed', errorMessage: 'Probe failed' });
  });

  it('completes a report with diagnostic details', () => {
    const report = createDiagnosticReport(WS_ID, 'insight-complete', 'traffic_drop', ['/blog']);
    const completed = completeDiagnosticReport(report.id, {
      diagnosticContext,
      rootCauses: [{ rank: 1, title: 'Ranking loss', confidence: 'high', explanation: 'Positions dropped.', evidence: ['GSC'] }],
      remediationActions: [{ priority: 'P1', title: 'Refresh page', description: 'Update the content.', effort: 'medium', impact: 'high', owner: 'content', pageUrls: ['/blog'] }],
      adminReport: 'Admin details',
      clientSummary: 'Client-safe summary',
    });

    expect(completed?.status).toBe('completed');
    expect(completed?.rootCauses[0].title).toBe('Ranking loss');
    expect(completed?.remediationActions[0].owner).toBe('content');
    expect(completed?.adminReport).toBe('Admin details');
    expect(completed?.completedAt).toBeTruthy();
  });

  it('deletes reports by workspace without touching other workspaces', () => {
    createDiagnosticReport(WS_ID, 'insight-delete', 'traffic_drop', []);
    createDiagnosticReport(OTHER_WS_ID, 'insight-other', 'traffic_drop', []);

    deleteDiagnosticReportsByWorkspace(WS_ID);

    expect(listDiagnosticReports(WS_ID)).toEqual([]);
    expect(listDiagnosticReports(OTHER_WS_ID)).toHaveLength(1);
  });

  it('recovers stuck running reports after restart', () => {
    const report = createDiagnosticReport(WS_ID, 'insight-stuck', 'traffic_drop', []);
    recoverStuckDiagnosticReports();

    expect(getDiagnosticReport(report.id)).toMatchObject({
      status: 'failed',
    });
    expect(getDiagnosticReport(report.id)?.errorMessage).toContain('diagnostic interrupted');
  });
});
